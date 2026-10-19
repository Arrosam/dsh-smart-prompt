/**
 * Lookups the refinement model may run while it works: the conversation's earlier messages
 * (session-lookup.ts) and, for Stardea ideas, the web through DSH's configured search
 * service (`ctx.web`, the same seam the agent's own `web_search` tool uses).
 *
 * A round is one model response that calls tools; every call in it runs and its output
 * goes back to the model as a tool result in the refinement's conversation (refine-chat.ts).
 *
 * @module dsh-smart-prompt/lookups
 */
import type { ToolCall, ToolSchema } from './llm-call.js';
/** One kind of lookup: the tools it offers and how it runs one call of them. */
export interface LookupSource {
    readonly tools: readonly ToolSchema[];
    /**
     * Run one call of one of this source's tools.
     * @returns the tool output; a failure is reported as text, never thrown.
     */
    run(call: ToolCall, signal: AbortSignal): Promise<string>;
}
/** One tool call's output, keyed by the call it answers. */
export interface LookupResult {
    readonly callId: string;
    readonly output: string;
}
/**
 * Lookup rounds one budget may still use. The rewrite steps of a refinement share one
 * budget; every Stardea request gets its own.
 */
export declare class RoundBudget {
    private readonly max;
    private used;
    constructor(max: number);
    /** Rounds left. */
    left(): number;
    /** Rounds taken so far. */
    spent(): number;
    /** Take one round. */
    spend(): void;
}
/** Every lookup source of one refinement, behind one tool list. */
export declare class Lookups {
    private readonly sources;
    /** Lookup output kept so far, in characters. */
    private size;
    constructor(sources: readonly LookupSource[]);
    /** The tools of every source, in source order. */
    tools(): readonly ToolSchema[];
    /** Names of the tools offered by the given sources. */
    static namesOf(sources: readonly LookupSource[]): ReadonlySet<string>;
    /**
     * Run one round: every call the model made in one response, in order. A call to a tool
     * the step does not allow, or beyond the per-round limit, is answered without running.
     *
     * @param calls - the model's tool calls.
     * @param allowed - names of the tools this step may run.
     * @param signal - cancels the lookups in flight.
     * @returns one result per call, in call order.
     */
    runRound(calls: readonly ToolCall[], allowed: ReadonlySet<string>, signal: AbortSignal): Promise<LookupResult[]>;
    /** Charge one output to the refinement's limit, cut to what room is left. */
    private keep;
    /**
     * Answer every call of a response that came after the step's rounds ran out.
     *
     * @param calls - the model's tool calls.
     * @returns one refusal per call.
     */
    static refuseAll(calls: readonly ToolCall[]): LookupResult[];
    private runOne;
}
/** Parse a tool-call argument object; anything else reads as no arguments. */
export declare function argsOf(raw: string): Record<string, unknown>;
/** One source of a search result (`@deepseek-ai/dsh-web` `WebSearchSource`). */
interface WebSource {
    readonly url?: unknown;
    readonly title?: unknown;
    readonly snippet?: unknown;
    readonly publishedAt?: unknown;
}
/** The slice of `ctx.web` (`@deepseek-ai/dsh-web`) this plugin uses. */
export interface WebFace {
    search(request: {
        readonly query: string;
        readonly maxResults?: number;
    }, signal?: AbortSignal): Promise<{
        readonly content?: unknown;
        readonly sources?: readonly WebSource[];
    }>;
}
/** Tool name, as the model sees it. */
export declare const WEB_TOOL = "web_search";
/** Web search through DSH's configured search provider. */
export declare class WebLookup implements LookupSource {
    private readonly web;
    readonly tools: readonly ToolSchema[];
    constructor(web: WebFace);
    run(call: ToolCall, signal: AbortSignal): Promise<string>;
}
export {};
