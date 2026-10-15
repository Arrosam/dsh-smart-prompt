/**
 * One streaming model call: route resolution, cancellation, timeout, and text
 * assembly. Deliberately NOT a pipeline — a single call, optionally followed by at
 * most one repair call driven by the deterministic gates.
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
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    reasoningEffort?: string;
}
/** One streamed chunk: only the discriminants this plugin reads are named. */
export type StreamChunk = {
    readonly type: 'text-delta';
    readonly text: string;
} | {
    readonly type: 'tool-call-delta';
} | {
    readonly type: 'finish';
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
/** Outcome of one call. */
export type CallResult = {
    readonly ok: true;
    readonly text: string;
} | {
    readonly ok: false;
    readonly failure: CallFailure;
};
/** What to ask the model for. */
export interface CallRequest {
    readonly route: Route;
    readonly system: string;
    readonly userMessage: string;
    readonly config: ResolvedConfig;
    readonly signal: AbortSignal;
}
/** Reason a route could not be resolved. */
export declare class NoRouteError extends Error {
    constructor();
}
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
 * Run one model call and assemble its text.
 *
 * Cancellation and timeout both abort the underlying stream, and an aborted call
 * yields no text at all — so a cancelled enhancement can never half-replace the
 * user's draft.
 *
 * @param llm - the llm service.
 * @param request - route, prompts, config, and caller signal.
 * @returns the assembled text or a typed failure.
 */
export declare function callModel(llm: LlmFace, request: CallRequest): Promise<CallResult>;
export {};
