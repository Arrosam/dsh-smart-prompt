/**
 * Next-step suggestions: short prompts the user could send the agent next, read from the latest
 * turns of the conversation. Offered while the composer is empty, in every mode.
 *
 * One model call per request, with no tools: the latest turns and the workspace knowledge are the
 * whole context. Suggestions belong to one point of the conversation (its {@link conversationKey}):
 * asking again for the same point returns the ones already made, asking for more avoids all of
 * them, and a new agent reply starts afresh. {@link NextStepBook} keeps them per session, so the
 * automatic run after an agent reply and the user's click share one result.
 *
 * @module dsh-smart-prompt/next-steps
 */
import { createHash } from 'node:crypto';
import { collectTurns, formatTurns, speakerOf, textOf } from './history.js';
import { callModel, userMessage } from './llm-call.js';
import { ERR, failureOf, refuse } from './orchestrate.js';
import { escapeClosingTag, nextStepsPrompt, referenceBlock } from './prompts.js';
import { knowledgeBlock } from './workspace-knowledge.js';
/** Suggestions per request (user decision: two, one row of the popover's cards). */
export const SUGGESTION_COUNT = 2;
/** Sessions whose suggestions are kept; the least recently used goes first beyond this. */
const MAX_SESSIONS = 50;
/** Tag wrapping the suggestions, and one suggestion inside it. */
const BLOCK_RE = /<suggestions>([\s\S]*?)<\/suggestions>/gi;
const ITEM_RE = /<suggestion>([\s\S]*?)<\/suggestion>/gi;
/** Frames of the request's user turn. */
const FRAME = Object.freeze({
    conversation: { tag: 'recent_conversation', description: 'The latest turns of the user\'s conversation with their agent, oldest first.' },
    avoid: 'already_suggested',
    ask: (count) => 'Suggest ' + String(count) + ' next prompts the user could send the agent.',
});
/** Host-side failure copy (the client shows its own text per code). */
const MESSAGE = Object.freeze({
    NO_CONTEXT: 'the conversation has no finished exchange to suggest from yet',
    NO_SUGGESTIONS: 'the model gave no suggestions',
});
/**
 * Identity of the conversation's latest point: how many messages the user and the agent have
 * exchanged, and the last of them. A new agent reply changes it; tool traffic does not.
 *
 * @param messages - the session's messages, any shape `speakerOf` understands.
 * @returns the key, or '' when the user and the agent have not exchanged anything yet.
 */
export function conversationKey(messages) {
    if (!Array.isArray(messages))
        return '';
    const texts = messages.flatMap((message) => {
        const speaker = speakerOf(message);
        const text = speaker !== null ? textOf(message) : '';
        return text !== '' ? [speaker + ':' + text] : [];
    });
    if (texts.length === 0)
        return '';
    return createHash('sha256').update(String(texts.length) + '\n' + (texts[texts.length - 1] ?? '')).digest('hex').slice(0, 16);
}
/**
 * Read the suggestions out of a model reply.
 *
 * @param raw - the model reply.
 * @param avoid - suggestions already made; a repeat (ignoring case and spacing) is dropped.
 * @param max - most suggestions to keep.
 * @returns new, distinct, single-line suggestions in reply order.
 */
export function parseSuggestions(raw, avoid, max) {
    const seen = new Set(avoid.map(sameKey));
    const found = [];
    for (const block of raw.matchAll(BLOCK_RE)) {
        for (const item of (block[1] ?? '').matchAll(ITEM_RE)) {
            const text = (item[1] ?? '').replace(/\s+/gu, ' ').trim();
            const key = sameKey(text);
            if (text === '' || seen.has(key) || found.length >= max)
                continue;
            seen.add(key);
            found.push(text);
        }
    }
    return found;
}
function sameKey(text) {
    return text.toLowerCase().replace(/\s+/gu, ' ').trim();
}
/**
 * Ask the model for new suggestions.
 *
 * @param context - model, route, conversation and knowledge.
 * @param turns - the turns the model reads.
 * @param avoid - suggestions already made for this point.
 * @param signal - cancels the call.
 * @returns the new suggestions, or why there are none.
 */
async function generate(context, turns, avoid, signal) {
    const parts = [
        knowledgeBlock(context.knowledge),
        referenceBlock(FRAME.conversation.tag, FRAME.conversation.description, 'it', escapeClosingTag(formatTurns(turns))),
        avoid.length > 0 ? '<' + FRAME.avoid + '>\n' + avoid.map((text) => '- ' + escapeClosingTag(text)).join('\n') + '\n</' + FRAME.avoid + '>' : '',
        FRAME.ask(SUGGESTION_COUNT),
    ];
    const result = await callModel(context.llm, {
        route: context.route,
        config: context.config,
        signal,
        system: nextStepsPrompt(SUGGESTION_COUNT),
        messages: [userMessage(parts.filter((part) => part !== '').join('\n\n'))],
    });
    if (!result.ok)
        return failureOf(result.failure, context.config);
    const found = parseSuggestions(result.text, avoid, SUGGESTION_COUNT);
    return found.length > 0 ? found : refuse(ERR.EMPTY_OUTPUT, MESSAGE.NO_SUGGESTIONS);
}
/** Next-step suggestions per session, for one plugin instance. */
export class NextStepBook {
    entries = new Map();
    stop = new AbortController();
    /**
     * The suggestions made for the conversation's current point, or none.
     *
     * @param sessionId - the session.
     * @param key - its current {@link conversationKey}.
     * @returns them, waiting for a generation still running; undefined when none were made.
     */
    async peek(sessionId, key) {
        const entry = this.current(sessionId, key);
        if (entry === undefined)
            return undefined;
        if (entry.running !== null)
            return entry.running;
        return entry.suggestions.length > 0 ? { ok: true, key, suggestions: entry.suggestions } : undefined;
    }
    /**
     * The suggestions for the conversation's current point. With `more`, or when none were made
     * yet, the model is asked for new ones (avoiding every earlier one); otherwise the ones made
     * are returned as they are. Requests for one point share one generation.
     *
     * @param sessionId - the session.
     * @param context - what a generation needs; its messages decide the point.
     * @param more - ask for new suggestions even when some exist.
     * @param signal - the caller leaving; a shared generation keeps running for the others.
     * @returns every suggestion for the point, or why there are none (earlier ones are kept).
     */
    async request(sessionId, context, more, signal) {
        const key = conversationKey(context.messages);
        if (key === '')
            return refuse(ERR.NO_CONTEXT, MESSAGE.NO_CONTEXT);
        let entry = this.current(sessionId, key);
        if (entry === undefined) {
            entry = { key, suggestions: [], running: null };
            this.remember(sessionId, entry);
        }
        if (entry.running === null && (more || entry.suggestions.length === 0))
            entry.running = this.run(entry, context);
        if (entry.running === null)
            return { ok: true, key, suggestions: entry.suggestions };
        return race(entry.running, signal);
    }
    /** Abort every generation; the book is unusable afterwards. */
    dispose() {
        this.stop.abort();
        this.entries.clear();
    }
    async run(entry, context) {
        const turns = collectTurns(context.messages, Math.max(1, context.config.contextTurns), context.config.contextChars);
        try {
            const found = await generate(context, turns, entry.suggestions, this.stop.signal);
            if (!Array.isArray(found))
                return found;
            entry.suggestions = [...entry.suggestions, ...found];
            return { ok: true, key: entry.key, suggestions: entry.suggestions };
        }
        finally {
            entry.running = null;
        }
    }
    /** The session's entry if it belongs to `key`; refreshed as the most recently used. */
    current(sessionId, key) {
        const entry = this.entries.get(sessionId);
        if (entry === undefined || entry.key !== key)
            return undefined;
        this.remember(sessionId, entry);
        return entry;
    }
    remember(sessionId, entry) {
        this.entries.delete(sessionId);
        this.entries.set(sessionId, entry);
        if (this.entries.size > MAX_SESSIONS) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined)
                this.entries.delete(oldest);
        }
    }
}
/** The shared generation's outcome, or ABORTED as soon as this caller's signal fires. */
function race(running, signal) {
    if (signal.aborted)
        return Promise.resolve(refuse(ERR.ABORTED, ERR.ABORTED));
    return new Promise((resolve, reject) => {
        const onAbort = () => { resolve(refuse(ERR.ABORTED, ERR.ABORTED)); };
        signal.addEventListener('abort', onAbort, { once: true });
        running.then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort); });
    });
}
//# sourceMappingURL=next-steps.js.map