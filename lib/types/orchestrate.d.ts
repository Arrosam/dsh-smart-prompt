/**
 * The enhancement orchestrator: generate, gate, repair once, report.
 *
 * Kept free of cordis so the whole reply pipeline can be driven by a stub model in
 * tests — the gates are the product, so they are verified deterministically rather
 * than by hoping a real model misbehaves.
 *
 * @module dsh-smart-prompt/orchestrate
 */
import { type Mode, type ResolvedConfig } from './config.js';
import { type LlmFace, type Route } from './llm-call.js';
/** Stable error codes the client maps to localized copy. */
export declare const ERR: {
    readonly EMPTY: "EMPTY";
    readonly COMMAND: "COMMAND";
    readonly TOO_LONG: "TOO_LONG";
    readonly NO_ROUTE: "NO_ROUTE";
    readonly TIMEOUT: "TIMEOUT";
    readonly ABORTED: "ABORTED";
    readonly EMPTY_OUTPUT: "EMPTY_OUTPUT";
    readonly TOOL_CALL: "TOOL_CALL";
    readonly LENGTH_EXCEEDED: "LENGTH_EXCEEDED";
    readonly UPSTREAM: "UPSTREAM";
    readonly UNKNOWN: "UNKNOWN";
};
/** Quality certificate returned on success. */
export interface ImproveMeta {
    mode: Mode;
    model: string;
    ratio: number;
    ratioLabel: string;
    elapsedMs: number;
    anchors: {
        total: number;
        kept: number;
        reinjected: number;
    };
    note: string;
    contextUsed: string;
}
/** Success payload. */
export interface ImproveOk {
    ok: true;
    text: string;
    meta: ImproveMeta;
}
/** Failure payload — the draft is never touched. */
export interface ImproveErr {
    ok: false;
    code: string;
    message: string;
}
/** What the route returns. */
export type ImproveOutcome = ImproveOk | ImproveErr;
/** Live session face used for context (feature-detected). */
export interface SessionsFace {
    get(id: string): {
        deriveMessages?: () => unknown;
    } | undefined;
}
/** Everything the orchestrator needs from the host. */
export interface ImproveDeps {
    readonly llm: LlmFace | undefined;
    /** `agentDefaultModel.currentSelection()` output, when the service exists. */
    readonly selection?: {
        provider?: unknown;
        model?: unknown;
    } | undefined;
    /** The settings-page dedicated model, present only when that source is selected. */
    readonly dedicated?: {
        provider?: unknown;
        model?: unknown;
        reasoningEffort?: unknown;
    } | undefined;
    /** Model picked in the request's conversation, when the host can say. */
    readonly conversationModel?: (sessionId: string) => {
        provider?: unknown;
        model?: unknown;
    } | undefined;
    /** Route captured from the live `llm/stream` waterfall, when one has been seen. */
    readonly lastRoute?: Route | null;
    readonly sessions?: SessionsFace | undefined;
}
/** One request. */
export interface ImproveInput {
    readonly draft: string;
    readonly sessionId: string;
    readonly mode: Mode;
    readonly signal: AbortSignal;
}
/**
 * Run one enhancement end to end.
 *
 * Call budget: one generation call, plus at most ONE repair call when a gate
 * complains. Never a pipeline.
 *
 * @param deps - host faces (model, route sources, sessions).
 * @param cfg - resolved configuration.
 * @param input - the draft, session, mode, and caller signal.
 * @returns the success payload with its certificate, or a typed failure.
 */
export declare function improveDraft(deps: ImproveDeps, cfg: ResolvedConfig, input: ImproveInput): Promise<ImproveOutcome>;
