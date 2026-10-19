/**
 * The enhancement orchestrator: generate, ask, gate, repair once, report.
 *
 * Kept free of cordis so the whole reply pipeline can be driven by a stub model in
 * tests — the gates are the product, so they are verified deterministically rather
 * than by hoping a real model misbehaves.
 *
 * Every model call of one refinement goes through one {@link RefineChat}, so each call
 * repeats the previous one's request as its prefix (prompt-cache friendly) and lookups
 * found in one step stay visible to every later step.
 *
 * @module dsh-smart-prompt/orchestrate
 */
import { type Mode, type ResolvedConfig } from './config.js';
import { type SessionsFace } from './history.js';
import { type LlmFace, type Route } from './llm-call.js';
import { type WebFace } from './lookups.js';
import { type SeamAnswer } from './questions.js';
import { type UsageReport } from './refine-chat.js';
import { type Stardea } from './stardea.js';
import type { AnswerMemory } from './answer-memory.js';
import { type KnowledgeStore } from './workspace-knowledge.js';
/** Stable error codes the client maps to localized copy. */
export declare const ERR: {
    readonly EMPTY: "EMPTY";
    readonly COMMAND: "COMMAND";
    readonly TOO_LONG: "TOO_LONG";
    readonly BAD_BODY: "BAD_BODY";
    readonly NO_ROUTE: "NO_ROUTE";
    readonly TIMEOUT: "TIMEOUT";
    readonly ABORTED: "ABORTED";
    readonly EMPTY_OUTPUT: "EMPTY_OUTPUT";
    readonly TOOL_CALL: "TOOL_CALL";
    readonly LENGTH_EXCEEDED: "LENGTH_EXCEEDED";
    readonly UPSTREAM: "UPSTREAM";
    /** A follow-up request (Stardea, answers, cancel) names a refinement or question that is not open. */
    readonly NO_RUN: "NO_RUN";
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
    /** Why session context was used: the smart-context trigger, 'last-turn', 'lookup', or 'none'. */
    contextUsed: string;
    /** Follow-up questions asked about missing information, and how many the user answered. */
    questions: {
        asked: number;
        answered: number;
    };
    /** Lookup rounds the model used for the rewrite (Stardea rounds not included). */
    lookups: number;
    /** Tokens of every model call of the refinement, Stardea included; absent when no call reported any. */
    usage?: UsageReport;
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
export type { SessionsFace };
/** One follow-up question. */
export interface FollowUpQuestion {
    readonly id: string;
    readonly question: string;
    readonly header: string;
}
/**
 * Asks the user; rejects when the questions are dismissed. `stardea` finds ideas for
 * answering one of the questions while they are open.
 */
export type AskUser = (questions: readonly FollowUpQuestion[], signal: AbortSignal, stardea: Stardea) => Promise<SeamAnswer>;
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
    /**
     * The follow-up panel of the request's conversation, or undefined when the user cannot
     * be asked there. Without it the model is not asked for questions at all.
     */
    readonly askUser?: ((sessionId: string) => AskUser | undefined) | undefined;
    /** DSH's web search service, for Stardea ideas; undefined when the host has none. */
    readonly web?: WebFace | undefined;
    /** Answers kept across a failed refinement, so retrying the same draft does not ask again. */
    readonly answers?: AnswerMemory | undefined;
    /**
     * Reads the draft's attachments into model content blocks; undefined on hosts without
     * attachment storage, where attachments are left out.
     */
    readonly readAttachments?: ((sessionId: string, wire: readonly unknown[], signal: AbortSignal) => Promise<readonly unknown[]>) | undefined;
    /** Loads a session's messages for lookups; undefined when the host cannot. */
    readonly sessionMessages?: ((sessionId: string) => Promise<unknown>) | undefined;
    /** The workspace knowledge file of a session's workspace; undefined when it has none. */
    readonly knowledge?: ((sessionId: string) => KnowledgeStore | undefined) | undefined;
    /**
     * Runs work that outlives the request (the knowledge update), after the outcome is
     * returned; absent means the work is simply not awaited.
     */
    readonly background?: ((task: () => Promise<void>) => void) | undefined;
}
/** One request. */
export interface ImproveInput {
    readonly draft: string;
    readonly sessionId: string;
    readonly mode: Mode;
    readonly signal: AbortSignal;
    /** Most follow-up questions to ask; 0 asks none. */
    readonly maxQuestions?: number;
    /** The draft's attachments, as the composer serialized them. */
    readonly attachments?: readonly unknown[];
    /** Most lookup rounds the rewrite steps may use together; 0 (the default) runs none. */
    readonly lookupRounds?: number;
    /** Most new ideas one Stardea request returns; absent means {@link DEFAULT_STARDEA_IDEAS}. */
    readonly stardeaIdeas?: number;
    /** Most lookup rounds each Stardea request may use; 0 (the default) runs none. */
    readonly stardeaRounds?: number;
    /** Whether Stardea requests may search the web; off by default. */
    readonly stardeaWebSearch?: boolean;
}
/**
 * Run one enhancement end to end.
 *
 * Call budget: one generation call; one more when the user answered follow-up
 * questions about missing information; plus at most ONE repair call when a gate
 * complains. Each lookup round the model uses adds one call: the rewrite steps share the
 * rewrite's round limit, and every Stardea request has its own Stardea limit (plus one plain
 * retry if the route refuses tools). Each Stardea request is one more step of the same
 * conversation.
 *
 * @param deps - host faces (model, route sources, sessions).
 * @param cfg - resolved configuration.
 * @param input - the draft, session, mode, and caller signal.
 * @returns the success payload with its certificate, or a typed failure.
 */
export declare function improveDraft(deps: ImproveDeps, cfg: ResolvedConfig, input: ImproveInput): Promise<ImproveOutcome>;
