/**
 * How each mode runs its follow-up questions.
 *
 * Standard and Light ask once: every question in one panel, then one rewrite with the
 * answers; skipping keeps the first rewrite. Detailed asks one question per round until
 * nothing is missing or the question cap is reached (user requirement), and when the user
 * skips, or the cap is reached, the gaps are filled with guesses listed under the rewrite.
 *
 * Pure data, so the orchestrator's loop has one implementation for every mode.
 *
 * @module dsh-smart-prompt/follow-up-policy
 */
/** Every question at once, one round, skip keeps the first rewrite: the behaviour before detailed mode. */
const SINGLE_ROUND = Object.freeze({
    questionsPerReply: Number.POSITIVE_INFINITY,
    askAgain: false,
    guessOnSkip: false,
    roundRules: false,
});
/** One question per round until nothing is missing or the cap is reached (user requirement). */
const ONE_AT_A_TIME = Object.freeze({
    questionsPerReply: 1,
    askAgain: true,
    guessOnSkip: true,
    roundRules: true,
});
/** The policy of each mode. */
export const FOLLOW_UP_POLICY = Object.freeze({
    standard: SINGLE_ROUND,
    light: SINGLE_ROUND,
    detailed: ONE_AT_A_TIME,
});
/**
 * Most questions the next reply may ask.
 *
 * @param policy - the mode's policy.
 * @param questionsLeft - questions the refinement's cap still allows.
 * @returns a whole number, 0 when no question may be asked.
 */
export function questionsForReply(policy, questionsLeft) {
    return Math.max(0, Math.min(policy.questionsPerReply, questionsLeft));
}
//# sourceMappingURL=follow-up-policy.js.map