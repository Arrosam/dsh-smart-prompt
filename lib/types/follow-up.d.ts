/**
 * Refinements waiting for the user's answers to their follow-up questions.
 *
 * A refinement that asks questions spans several HTTP requests: `/improve` starts it and
 * returns the questions, `/stardea` asks for ideas while they are open, and `/answer`
 * hands over the answers and returns the final result (`/cancel` ends it instead). The
 * refinement itself keeps running in between, awaiting the answers, so its conversation
 * (refine-chat.ts) and everything it looked up stay in memory for the later requests.
 *
 * Kept free of HTTP: index.ts maps requests onto these calls.
 *
 * @module dsh-smart-prompt/follow-up
 */
import { type AskUser, type FollowUpQuestion, type ImproveOutcome } from './orchestrate.js';
import type { SeamAnswer } from './questions.js';
import type { StardeaOutcome } from './stardea.js';
/** What one request of a refinement gets back: its questions, or its final outcome. */
export type Exchange = {
    readonly kind: 'ask';
    readonly runId: string;
    readonly questions: readonly FollowUpQuestion[];
} | {
    readonly kind: 'done';
    readonly outcome: ImproveOutcome;
};
/** A request naming no open refinement. */
export declare const NO_RUN: StardeaOutcome;
/** Runs one refinement; `ask` presents its questions, `signal` cancels it. */
export type Refine = (ask: AskUser, signal: AbortSignal) => Promise<ImproveOutcome>;
/** Every refinement of this plugin instance whose questions are open. */
export declare class FollowUpDesk {
    private readonly runs;
    /**
     * Start a refinement.
     *
     * At most one refinement per session waits for answers: the session's composer shows one
     * panel, so a new start (e.g. after a page reload lost the panel) cancels the old one.
     * Open runs are otherwise kept until they are answered or cancelled.
     *
     * @param sessionId - the session it refines for.
     * @param signal - the starting request; it cancels the refinement until the questions are out.
     * @param refine - the refinement.
     * @returns the questions, or the outcome when it asked none.
     */
    start(sessionId: string, signal: AbortSignal, refine: Refine): Promise<Exchange>;
    /**
     * Ask for ideas for one open question.
     *
     * @param runId - the refinement.
     * @param questionId - the question.
     * @param signal - cancels this request only.
     */
    stardea(runId: string, questionId: string, signal: AbortSignal): Promise<StardeaOutcome>;
    /**
     * Hand over the answers.
     *
     * @param runId - the refinement.
     * @param reply - the answers; an empty batch skips every question.
     * @param signal - the answering request; it cancels the refinement while it waits.
     * @returns the final outcome, or undefined when no such refinement is open.
     */
    answer(runId: string, reply: SeamAnswer, signal: AbortSignal): Promise<Exchange> | undefined;
    /**
     * End a refinement whose questions are open; it finishes as cancelled.
     *
     * @returns whether one was open.
     */
    cancel(runId: string): boolean;
    /** End every open refinement (plugin teardown). */
    dispose(): void;
    private cancelSession;
}
