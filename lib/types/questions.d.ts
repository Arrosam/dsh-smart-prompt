/**
 * Follow-up questions about missing information.
 *
 * The first rewrite call may end with a `<missing_info>` block listing what the draft
 * lacks (see `prompts/questions.md`). The orchestrator asks those questions through the
 * host's ask-user seam, then rewrites once more with the answers. Kept pure: parsing and
 * formatting only, no host access.
 *
 * @module dsh-smart-prompt/questions
 */
/** A rewrite with any missing-information block taken out. */
export interface ParsedRewrite {
    /** The rewrite without the block. */
    readonly text: string;
    /** Questions the model asked, trimmed, empty ones dropped, capped at `max`. */
    readonly questions: readonly string[];
}
/**
 * Split a model reply into the rewrite and its follow-up questions.
 *
 * Every block is removed from the text, so a block the model emits where none was
 * asked for never reaches the composer.
 *
 * @param raw - the model reply.
 * @param max - most questions to keep.
 * @returns the rewrite text and the questions.
 */
export declare function parseRewrite(raw: string, max: number): ParsedRewrite;
/** Id of the question at one position. */
export declare function questionId(index: number): string;
/** One answered question. */
export interface AnsweredQuestion {
    readonly question: string;
    readonly answer: string;
}
/** The ask-user seam's answer shape (`@deepseek-ai/dsh-user-questions`). */
export interface SeamAnswer {
    readonly answers?: readonly {
        readonly id?: unknown;
        readonly selected?: unknown;
        readonly custom?: unknown;
    }[];
}
/**
 * Pair the asked questions with the user's answers, dropping skipped ones.
 *
 * @param questions - questions in ask order.
 * @param answer - the seam's reply.
 * @returns the answered questions, in ask order.
 */
export declare function answeredQuestions(questions: readonly string[], answer: SeamAnswer): AnsweredQuestion[];
/**
 * Render the answers for the rewrite call's user message.
 *
 * @param answered - answered questions.
 * @returns the `<user_answers>` block, or '' when there are none.
 */
export declare function formatAnswers(answered: readonly AnsweredQuestion[]): string;
