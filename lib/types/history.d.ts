/**
 * Session-history collection for the smart-context path.
 *
 * Only human messages and assistant prose are ever carried: tool results (file
 * contents, command output) and plugin-injected context are excluded by design, so
 * enabling context never leaks project data the user did not type.
 *
 * @module dsh-smart-prompt/history
 */
/** One question/answer pair from the session. */
export interface HistoryTurn {
    readonly user: string;
    readonly assistant: string;
}
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
