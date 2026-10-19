/**
 * Session-history collection for the smart-context path.
 *
 * Only human messages (with the images the user attached to them) and assistant prose
 * are ever carried: tool results (file contents, command output) and plugin-injected
 * context are excluded by design, so enabling context never leaks project data the user
 * did not provide.
 *
 * @module dsh-smart-prompt/history
 */
/** One question/answer pair from the session. */
export interface HistoryTurn {
    readonly user: string;
    readonly assistant: string;
    /**
     * Image blocks the user attached to this turn's message, ready to send to the model.
     * Present only when there are any, so turns without images keep their old shape.
     */
    readonly images?: readonly ImageBlock[];
}
/** A model-request image block over one durable attachment reference. */
export interface ImageBlock {
    readonly type: 'image';
    readonly attachment: unknown;
}
/** Live session face used for context (feature-detected). */
export interface SessionsFace {
    get(id: string): {
        deriveMessages?: () => unknown;
    } | undefined;
}
/**
 * The live session's current messages.
 *
 * @param sessions - the host sessions service, when present.
 * @param sessionId - the session to read.
 * @returns `deriveMessages()` output, or [] when the host or session cannot say.
 */
export declare function liveMessages(sessions: SessionsFace | undefined, sessionId: string): unknown;
interface LooseMessage {
    role?: unknown;
    content?: unknown;
    source?: {
        kind?: unknown;
    } | undefined;
}
/**
 * The visible text of one message: its text blocks only (no reasoning, tool calls or
 * attachments).
 *
 * @param message - a derived or logged message, or anything else.
 * @returns the joined text, trimmed; '' when there is none.
 */
export declare function textOf(message: LooseMessage): string;
/**
 * Whether a message is one the user typed or a reply the model wrote: the only two
 * kinds this plugin ever reads from a session. Injected user-role context (file
 * notices, skills, compaction summaries) and tool results are neither.
 *
 * @param message - a derived or logged message, or anything else.
 * @returns 'user', 'assistant', or null for every other message.
 */
export declare function speakerOf(message: unknown): 'user' | 'assistant' | null;
/**
 * Collect the last N question/answer pairs from a session's derived messages.
 *
 * Feature-detected throughout: a host without the sessions service, an old session
 * object without `deriveMessages`, or any throw all degrade to an empty list —
 * context is an optimization, never a precondition.
 *
 * @param messages - `session.deriveMessages()` output, or anything else.
 * @param turns - how many pairs to keep (0 disables).
 * @param totalChars - hard character ceiling across all kept turns.
 * @returns the turns in chronological order.
 */
export declare function collectTurns(messages: unknown, turns: number, totalChars: number): HistoryTurn[];
/**
 * Render turns as one reference block placed before the draft.
 *
 * @param turns - collected turns.
 * @returns the block, or '' when there is nothing to carry.
 */
export declare function formatHistoryBlock(turns: readonly HistoryTurn[]): string;
export {};
