/**
 * One streaming model call: route resolution, cancellation, timeout, and reply
 * assembly. A call sends a whole conversation and returns the model's reply as an
 * assistant message the caller appends to that conversation (see refine-chat.ts), plus
 * the reply's text, its tool calls, and the token usage the adapter reported.
 *
 * The llm service is addressed STRUCTURALLY (type-only import + an inline message
 * object) rather than through a runtime import of `@deepseek-ai/dsh-llm`. A plugin
 * installed with its own copy of that package would otherwise resolve a different
 * version than the running host, and the two copies need not agree on the message
 * object. Type-only imports are erased at emit, so the built plugin carries no
 * runtime dependency on the harness at all.
 *
 * @module dsh-smart-prompt/llm-call
 */
import type { ResolvedConfig } from './config.js';
/**
 * The model-request shape this plugin builds, declared structurally.
 *
 * Deliberately not imported from `@deepseek-ai/dsh-llm`: a plugin that resolves
 * its own copy of that package would type-check against a different version than
 * the running host. Only the fields the harness contract documents are used.
 */
export interface GenerateOptions {
    provider: string;
    model: string;
    system?: string;
    messages: readonly unknown[];
    /** Tools the model may call; omitted on every call that offers none. */
    tools?: readonly ToolSchema[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    reasoningEffort?: string;
}
/** JSON-schema description of one tool, as the harness sends it to the model. */
export interface ToolSchema {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
}
/** One tool invocation the model asked for; `arguments` is the raw JSON string it wrote. */
export interface ToolCall {
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
}
/** One finished content block as an adapter reports it. */
interface StreamBlock {
    readonly type?: string;
    readonly text?: string;
    readonly id?: string;
    readonly name?: string;
    readonly arguments?: string;
}
/** Token accounting of one call, as `@deepseek-ai/dsh-llm` defines it (disjoint counts). */
export interface TokenUsage {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
}
/** One streamed chunk: only the discriminants this plugin reads are named. */
export type StreamChunk = {
    readonly type: 'text-delta';
    readonly index?: number;
    readonly text: string;
} | {
    readonly type: 'reasoning-delta';
    readonly index?: number;
    readonly text: string;
} | {
    readonly type: 'tool-call-delta';
    readonly index?: number;
    readonly id?: string;
    readonly name?: string;
    readonly argumentsDelta?: string;
} | {
    readonly type: 'block-end';
    readonly index?: number;
    readonly block?: StreamBlock;
} | {
    readonly type: 'usage';
    readonly usage?: TokenUsage;
} | {
    readonly type: 'finish';
    readonly reason?: {
        readonly kind?: string;
        readonly failure?: {
            readonly message?: string;
        };
    };
    readonly replayState?: unknown;
} | {
    readonly type: string;
};
/** The slice of `ctx.llm` this plugin uses. */
export interface LlmFace {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/**
 * One resolved provider/model route. `reasoningEffort`, when present, overrides the
 * plugin-wide effort (the dedicated model carries its own; empty means adapter default).
 */
export interface Route {
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort?: string;
}
/** Why a call produced no usable text. */
export type CallFailure = {
    readonly code: 'ABORTED';
} | {
    readonly code: 'TIMEOUT';
} | {
    readonly code: 'EMPTY';
} | {
    readonly code: 'TOOL_CALL';
} | {
    readonly code: 'UPSTREAM';
    readonly message: string;
};
/**
 * Outcome of one call. `toolCalls` is non-empty only when the request offered tools and
 * the model used them; `text` may then be empty. `reply` is the model's whole response as
 * an assistant message, ready to be appended to the conversation it answered. `usage` is
 * what the adapter reported for the call, failed calls included.
 */
export type CallResult = {
    readonly ok: true;
    readonly text: string;
    readonly toolCalls: readonly ToolCall[];
    readonly reply: unknown;
    readonly usage: TokenUsage | undefined;
} | {
    readonly ok: false;
    readonly failure: CallFailure;
    readonly usage: TokenUsage | undefined;
};
/** What to ask the model for. */
export interface CallRequest {
    readonly route: Route;
    readonly system: string;
    /** The whole conversation, oldest first (see {@link userMessage}, {@link toolResultMessage}). */
    readonly messages: readonly unknown[];
    /** Tools the model may call. */
    readonly tools?: readonly ToolSchema[];
    readonly config: ResolvedConfig;
    readonly signal: AbortSignal;
}
/** Reason a route could not be resolved. */
export declare class NoRouteError extends Error {
    constructor();
}
/**
 * Build one user message, shape-complete for the host's `Message` contract without
 * importing the constructor.
 *
 * @param text - the full user-message body.
 * @param extra - content blocks that follow the text (images, attached files).
 * @returns a frozen user message.
 */
export declare function userMessage(text: string, extra?: readonly unknown[]): unknown;
/**
 * Build an assistant message holding only text: a reply re-sent without its tool calls
 * or reasoning, to a route that takes no tools.
 *
 * @param route - the route that produced the reply.
 * @param text - the reply's visible text.
 * @returns a frozen assistant message.
 */
export declare function assistantTextMessage(route: Route, text: string): unknown;
/**
 * Build the tool-role message answering one tool call of the previous assistant reply.
 *
 * @param callId - id of the call it answers.
 * @param text - the tool output.
 * @returns a frozen tool-result message.
 */
export declare function toolResultMessage(callId: string, text: string): unknown;
/** A provider/model pair from any host source; anything else counts as absent. */
type RouteLike = {
    provider?: unknown;
    model?: unknown;
} | null | undefined;
/** Where a route may come from, in the order {@link resolveRoute} tries them. */
export interface RouteSources {
    /** Dedicated model from the settings page; used only when the source is `dedicated`. */
    readonly dedicated?: (RouteLike & {
        reasoningEffort?: unknown;
    }) | undefined;
    /** Model picked in this conversation (next request, else last used). */
    readonly conversation?: RouteLike;
    /** The harness default-model selection. */
    readonly defaults?: RouteLike;
    /** Route captured from the most recent real model call. */
    readonly lastSeen?: Route | null;
}
/**
 * Resolve the route for one call, in precedence order: the dedicated model (when the
 * user chose one), the conversation's own model, the harness default selection, then
 * the last route seen on the live `llm/stream` waterfall.
 *
 * @param sources - the candidate routes.
 * @returns the route to use.
 * @throws {NoRouteError} when nothing is available.
 */
export declare function resolveRoute(sources: RouteSources): Route;
/**
 * Run one model call and assemble its reply.
 *
 * Cancellation and timeout both abort the underlying stream, and an aborted call
 * yields no text at all — so a cancelled enhancement can never half-replace the
 * user's draft.
 *
 * @param llm - the llm service.
 * @param request - route, conversation, config, and caller signal.
 * @returns the assembled reply or a typed failure, each with the call's token usage.
 */
export declare function callModel(llm: LlmFace, request: CallRequest): Promise<CallResult>;
export {};
