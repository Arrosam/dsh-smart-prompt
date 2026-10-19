/**
 * Session lookups: two small tools the refinement model may call when the draft depends
 * on something said earlier in the conversation that the attached context does not hold,
 * or while it looks for ideas to answer a follow-up question (Stardea).
 *
 * Only what the user typed and what the assistant replied is searchable, through the same
 * message filter as the smart-context path (`speakerOf` in history.ts): tool results and
 * injected context never reach the refinement model (user decision).
 *
 * The results go back to the model as tool results in the refinement's own conversation
 * (refine-chat.ts), where every later call of the refinement still sees them.
 *
 * @module dsh-smart-prompt/session-lookup
 */
import type { ToolCall, ToolSchema } from './llm-call.js';
import { type LookupSource } from './lookups.js';
/** Tool names, as the model sees them. */
export declare const SEARCH_TOOL = "search_session";
export declare const READ_TOOL = "read_session_messages";
/** The tool schemas offered while lookup rounds remain. */
export declare const LOOKUP_TOOLS: readonly ToolSchema[];
/** Loads the conversation's messages (any message shape `speakerOf` understands). */
export type MessageLoader = () => Promise<unknown>;
/**
 * The conversation's earlier messages as a lookup source. The transcript is loaded once
 * per refinement, on the first lookup.
 */
export declare class SessionLookup implements LookupSource {
    private readonly load;
    readonly tools: readonly ToolSchema[];
    private transcript;
    /** @param load - reads the conversation; called at most once, on the first lookup. */
    constructor(load: MessageLoader);
    /** Run one search or read call. */
    run(call: ToolCall): Promise<string>;
    private entries;
}
/**
 * The messages of a raw session log (`sessionQuery.readSession().events`), oldest first.
 * The log keeps messages a compaction has since summarized away, which the live derived
 * surface no longer holds; `speakerOf` later drops everything but the user's and the
 * model's own messages.
 *
 * @param events - logged session events, or anything else.
 * @returns the message of every user and assistant message event.
 */
export declare function messagesOfLog(events: unknown): unknown[];
