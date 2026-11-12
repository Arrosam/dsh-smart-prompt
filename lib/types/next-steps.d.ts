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
import type { ResolvedConfig } from './config.js';
import { type LlmFace, type Route } from './llm-call.js';
import { type ImproveErr } from './orchestrate.js';
/** Suggestions per request (user decision: two, one row of the popover's cards). */
export declare const SUGGESTION_COUNT = 2;
/** Suggestions for one point of a conversation. */
export interface NextSteps {
    /** The conversation point they were made for. */
    readonly key: string;
    /** Every suggestion made for it, oldest first. */
    readonly suggestions: readonly string[];
}
/** What a request returns. */
export type NextStepsOutcome = {
    readonly ok: true;
} & NextSteps | ImproveErr;
/** Everything one generation needs from the host. */
export interface NextStepContext {
    readonly llm: LlmFace;
    readonly route: Route;
    readonly config: ResolvedConfig;
    /** The session's messages (derived), oldest first. */
    readonly messages: unknown;
    /** The workspace knowledge text, '' for none. */
    readonly knowledge: string;
}
/**
 * Identity of the conversation's latest point: how many messages the user and the agent have
 * exchanged, and the last of them. A new agent reply changes it; tool traffic does not.
 *
 * @param messages - the session's messages, any shape `speakerOf` understands.
 * @returns the key, or '' when the user and the agent have not exchanged anything yet.
 */
export declare function conversationKey(messages: unknown): string;
/**
 * Read the suggestions out of a model reply.
 *
 * @param raw - the model reply.
 * @param avoid - suggestions already made; a repeat (ignoring case and spacing) is dropped.
 * @param max - most suggestions to keep.
 * @returns new, distinct, single-line suggestions in reply order.
 */
export declare function parseSuggestions(raw: string, avoid: readonly string[], max: number): string[];
/** Next-step suggestions per session, for one plugin instance. */
export declare class NextStepBook {
    private readonly entries;
    private readonly stop;
    /**
     * The suggestions made for the conversation's current point, or none.
     *
     * @param sessionId - the session.
     * @param key - its current {@link conversationKey}.
     * @returns them, waiting for a generation still running; undefined when none were made.
     */
    peek(sessionId: string, key: string): Promise<NextStepsOutcome | undefined>;
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
    request(sessionId: string, context: NextStepContext, more: boolean, signal: AbortSignal): Promise<NextStepsOutcome>;
    /** Abort every generation; the book is unusable afterwards. */
    dispose(): void;
    private run;
    /** The session's entry if it belongs to `key`; refreshed as the most recently used. */
    private current;
    private remember;
}
