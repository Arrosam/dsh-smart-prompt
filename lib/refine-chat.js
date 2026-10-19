/**
 * One refinement as one model conversation.
 *
 * Every model call of a refinement — the first rewrite, each Stardea idea request, the
 * rewrite with the user's answers, the repair — appends to the same conversation, and the
 * system prompt and tool list are fixed when the refinement starts. Each call therefore
 * sends the previous call's request unchanged as its prefix, which is what a provider's
 * prompt cache matches on: later calls pay full price only for what was appended. It also
 * means lookup results found in one step stay in front of the model in every later step.
 *
 * A step that fails or is cancelled is taken out again, so the conversation only ever holds
 * finished exchanges (a tool call without its result would make the next request invalid).
 *
 * @module dsh-smart-prompt/refine-chat
 */
import { assistantTextMessage, callModel, toolResultMessage, userMessage, } from './llm-call.js';
import { Lookups } from './lookups.js';
import { escapeClosingTag, referenceBlock } from './prompts.js';
/** Sums the usage of every call; a call whose adapter reported none adds nothing. */
export class UsageTally {
    input = 0;
    cached = 0;
    output = 0;
    reported = false;
    add(usage) {
        if (usage === undefined)
            return;
        this.reported = true;
        this.input += count(usage.inputTokens) + count(usage.cacheWriteTokens);
        this.cached += count(usage.cacheReadTokens);
        this.output += count(usage.outputTokens);
    }
    /** The totals, or undefined when no call reported usage. */
    report() {
        return this.reported ? { input: this.input, cached: this.cached, output: this.output } : undefined;
    }
}
function count(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
/** Framing of lookup results inlined into a conversation that can no longer carry tools. */
const INLINE_LOOKUPS = Object.freeze({
    tag: 'session_lookup',
    description: 'Results of the lookups you ran for this request.',
});
/** The append-only conversation of one refinement. */
export class RefineChat {
    setup;
    usage = new UsageTally();
    steps = [];
    withTools;
    /** Steps run one at a time: a step must find the conversation as the previous one left it. */
    queue = Promise.resolve();
    constructor(setup) {
        this.setup = setup;
        this.withTools = setup.lookups.tools().length > 0;
    }
    /**
     * Run one step: add the user turn and ask the model. While the model calls tools and the
     * budget has rounds left, run them, add the results and ask again; the step ends with the
     * first reply that calls no tool. The tools stay declared after the budget ran out (the
     * declaration is part of the cached prefix): a reply that then calls tools and also wrote
     * text ends the step with that text, its calls answered as not run; a reply with only
     * calls fails the step as a tool call.
     *
     * @param turn - the user turn that opens the step.
     * @param budget - lookup rounds this step may use.
     * @param allowed - names of the tools this step may run.
     * @param signal - cancels the step; the conversation is then left as it was before it.
     * @returns the final reply, or the failure.
     */
    step(turn, budget, allowed, signal) {
        const run = this.queue.then(() => this.run(turn, budget, allowed, signal));
        this.queue = run.catch(() => undefined);
        return run;
    }
    async run(turn, budget, allowed, signal) {
        const aborted = { ok: false, failure: { code: 'ABORTED' }, usage: undefined };
        if (signal.aborted)
            return aborted;
        const step = { turn, user: userMessage(turn.text, turn.content ?? []), exchanges: [] };
        this.steps.push(step);
        const fail = (result) => { this.steps.pop(); return result; };
        for (;;) {
            const result = await this.call(signal);
            if (!result.ok)
                return fail(result);
            if (result.toolCalls.length === 0) {
                step.final = { reply: result.reply, text: result.text };
                return result;
            }
            if (budget.left() > 0) {
                budget.spend();
                this.record(step, result, await this.setup.lookups.runRound(result.toolCalls, allowed, signal));
            }
            else {
                if (result.text.trim() === '')
                    return fail({ ok: false, failure: { code: 'TOOL_CALL' }, usage: undefined });
                // Every tool call in the conversation needs its result: a request with an unanswered
                // call is invalid on every provider.
                this.record(step, result, Lookups.refuseAll(result.toolCalls));
                step.final = { reply: null, text: result.text };
                return { ...result, toolCalls: [] };
            }
            if (signal.aborted)
                return fail(aborted);
        }
    }
    record(step, result, results) {
        step.exchanges.push({
            reply: result.reply, calls: result.toolCalls, results,
            resultMessages: results.map((entry) => toolResultMessage(entry.callId, entry.output)),
        });
    }
    /** One call over the conversation so far. */
    async call(signal) {
        for (;;) {
            const tools = this.withTools ? this.setup.lookups.tools() : [];
            const result = await callModel(this.setup.llm, {
                route: this.setup.route, config: this.setup.config, signal,
                system: this.setup.system(this.withTools),
                messages: this.withTools ? this.nativeMessages() : this.plainMessages(),
                ...(tools.length > 0 ? { tools } : {}),
            });
            this.usage.add(result.usage);
            // A route that refuses tools must not cost the user the refinement: ask again without
            // them, for the rest of the refinement. This one-time switch re-sends the conversation
            // in a tool-free form (plainMessages), giving up the cached prefix once.
            if (!result.ok && this.withTools && result.failure.code === 'UPSTREAM') {
                this.withTools = false;
                continue;
            }
            return result;
        }
    }
    /** The conversation with its tool calls and results, exactly as earlier calls sent it. */
    nativeMessages() {
        return this.steps.flatMap((step) => [
            step.user,
            ...step.exchanges.flatMap((exchange) => [exchange.reply, ...exchange.resultMessages]),
            ...(step.final !== undefined && step.final.reply !== null ? [step.final.reply] : []),
        ]);
    }
    /**
     * The conversation for a route that takes no tools: each step's lookup results inlined
     * into its user turn, and a reply that called tools as plain text. Each part is built once
     * (no tool exchange can be added once tools are off), so later calls repeat it unchanged.
     */
    plainMessages() {
        return this.steps.flatMap((step) => {
            step.plainUser ??= step.exchanges.length === 0 ? step.user : userMessage(this.inlineLookups(step), step.turn.content ?? []);
            if (step.final === undefined)
                return [step.plainUser];
            step.plainReply ??= step.exchanges.length === 0 && step.final.reply !== null
                ? step.final.reply
                : assistantTextMessage(this.setup.route, step.final.text);
            return [step.plainUser, step.plainReply];
        });
    }
    /** A step's user turn with the results of its lookups appended as a reference block. */
    inlineLookups(step) {
        const lookups = step.exchanges.flatMap((exchange) => exchange.calls.map((call, position) => escapeClosingTag(call.name + ' ' + call.arguments) + '\n' + (exchange.results[position]?.output ?? '')));
        return step.turn.text + '\n\n' + referenceBlock(INLINE_LOOKUPS.tag, INLINE_LOOKUPS.description, 'them', lookups.join('\n\n'));
    }
}
//# sourceMappingURL=refine-chat.js.map