/**
 * dsh-smart-prompt — host half.
 *
 * One loopback route that rewrites a composer draft into a sharper, agent-ready
 * prompt, wrapped in two deterministic gates that no other prompt enhancer in the
 * ecosystem has:
 *
 * - **fidelity gate** — extracts the draft's hard facts (paths, identifiers,
 *   numbers, URLs, code, @references) and verifies each one literally survived the
 *   rewrite; a dropped fact triggers exactly one repair call, then a deterministic
 *   re-append, so nothing is ever silently lost.
 * - **length gate** — refuses to let a one-line request become a specification,
 *   matching WorkBuddy's own "less filler, fewer tokens" positioning.
 *
 * When the rewrite finds information missing, the user is asked short follow-up
 * questions in the plugin's own composer panel and the draft is rewritten once more
 * with the answers. While the questions are open, Stardea (星念) proposes ideas for
 * answering one of them, from web search, the conversation, and the model's own proposals.
 * At most three model calls per click (generation, answers, repair), plus one per lookup
 * round the model uses (a settings-page limit, default 3) and one per Stardea request.
 * All of them are turns of one conversation, so each call reuses the last one's prompt cache.
 *
 * The draft's attachments, and the images of the earlier turns carried as context, are
 * sent to the refinement model with the draft.
 *
 * @module dsh-smart-prompt
 */
/**
 * The slice of the Cordis host context this plugin touches.
 *
 * Declared structurally rather than imported: the built plugin then type-checks
 * against nothing but TypeScript and @types/node, so a peer-package version skew
 * can never turn into a build failure. Every member is read defensively at call
 * time anyway (see `service()` below).
 */
export interface HostContext {
    effect(fn: () => unknown | (() => void), label?: string): unknown;
    on(event: string, listener: (...args: never[]) => unknown): unknown;
    get(name: string): unknown;
    logger?: {
        warn?: (message: string) => void;
    };
}
/** Cordis plugin name. */
export declare const name = "dsh-smart-prompt";
/** Required services: the model registry and the HTTP carrier. */
export declare const inject: string[];
export { Config } from './config.js';
/**
 * Attach the plugin.
 *
 * @param ctx - cordis context carrying `llm` and `webServer`.
 * @param rawConfig - loader-supplied configuration (all keys optional).
 */
export declare function apply(ctx: HostContext, rawConfig: unknown): void;
