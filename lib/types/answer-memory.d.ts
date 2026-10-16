/**
 * Follow-up answers kept across a failed refinement, so a retry does not ask again.
 *
 * Answering the question card is the costly part of a refinement for the user; a
 * later failure (timeout, upstream error, length refusal, cancel) used to throw those
 * answers away. The orchestrator records them here once given and drops them when a
 * refinement for that session succeeds.
 *
 * @module dsh-smart-prompt/answer-memory
 */
import type { AnsweredQuestion } from './questions.js';
/** What one refinement learned from the user. */
export interface AnswerMemo {
    /** Questions the model asked (reported back in the certificate). */
    readonly asked: number;
    /** The answered ones, in ask order; never empty. */
    readonly answered: readonly AnsweredQuestion[];
}
/**
 * Per-session memo keyed by the exact draft body it answers.
 *
 * One entry per session: only the latest draft can be retried from the composer, and
 * answers to an earlier, different draft do not apply to a new one.
 */
export declare class AnswerMemory {
    private readonly entries;
    /** Answers given for exactly this draft in this session, if any. */
    recall(sessionId: string, draft: string): AnswerMemo | undefined;
    /** Record answers for this draft, replacing the session's previous entry. */
    remember(sessionId: string, draft: string, memo: AnswerMemo): void;
    /** Drop the session's answers (after a successful refinement). */
    forget(sessionId: string): void;
}
