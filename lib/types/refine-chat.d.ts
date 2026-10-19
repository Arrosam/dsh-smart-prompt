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
import type { ResolvedConfig } from './config.js';
import { type CallResult, type LlmFace, type Route, type TokenUsage } from './llm-call.js';
import { Lookups, type RoundBudget } from './lookups.js';
/** Token use of a whole refinement, in the plugin's report format. */
export interface UsageReport {
    /** Input tokens that missed the cache: uncached input plus input written to the cache. */
    readonly input: number;
    /** Input tokens read from the cache. */
    readonly cached: number;
    readonly output: number;
}
/** Sums the usage of every call; a call whose adapter reported none adds nothing. */
export declare class UsageTally {
    private input;
    private cached;
    private output;
    private reported;
    add(usage: TokenUsage | undefined): void;
    /** The totals, or undefined when no call reported usage. */
    report(): UsageReport | undefined;
}
/** One user turn: its text and any content blocks after it (images, attached files). */
export interface Turn {
    readonly text: string;
    readonly content?: readonly unknown[];
}
/** What a refinement's conversation is fixed to when it starts. */
export interface ChatSetup {
    readonly llm: LlmFace;
    readonly route: Route;
    readonly config: ResolvedConfig;
    /** The system prompt, given whether the conversation offers tools. */
    readonly system: (withTools: boolean) => string;
    /** Every lookup the conversation offers; their tools are declared on every call. */
    readonly lookups: Lookups;
}
/** The append-only conversation of one refinement. */
export declare class RefineChat {
    private readonly setup;
    readonly usage: UsageTally;
    private readonly steps;
    private withTools;
    /** Steps run one at a time: a step must find the conversation as the previous one left it. */
    private queue;
    constructor(setup: ChatSetup);
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
    step(turn: Turn, budget: RoundBudget, allowed: ReadonlySet<string>, signal: AbortSignal): Promise<CallResult>;
    private run;
    private record;
    /** One call over the conversation so far. */
    private call;
    /** The conversation with its tool calls and results, exactly as earlier calls sent it. */
    private nativeMessages;
    /**
     * The conversation for a route that takes no tools: each step's lookup results inlined
     * into its user turn, and a reply that called tools as plain text. Each part is built once
     * (no tool exchange can be added once tools are off), so later calls repeat it unchanged.
     */
    private plainMessages;
    /** A step's user turn with the results of its lookups appended as a reference block. */
    private inlineLookups;
}
