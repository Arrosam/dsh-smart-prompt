/**
 * How each mode runs its follow-up questions.
 *
 * Light asks once: every question in one panel, then one rewrite with the answers;
 * skipping keeps the first rewrite. Standard and Detailed ask one question per round until
 * nothing is missing or the question cap is reached (user requirement), and when the user
 * skips, or the cap is reached, the gaps are filled with guesses listed under the rewrite.
 *
 * Pure data, so the orchestrator's loop has one implementation for every mode.
 *
 * @module dsh-smart-prompt/follow-up-policy
 */
import type { Mode } from './settings-fields.js';
/** One mode's follow-up behaviour. */
export interface FollowUpPolicy {
    /** Most questions one reply may ask; the refinement's cap still bounds the total. */
    readonly questionsPerReply: number;
    /** Whether a rewrite that folds in answers may ask again while the cap allows. */
    readonly askAgain: boolean;
    /** Whether skipping the questions rewrites once more, filling the gaps with listed guesses. */
    readonly guessOnSkip: boolean;
    /** Whether every user turn ends with the follow-up status note the round rules of the mode template follow. */
    readonly roundRules: boolean;
}
/** The policy of each mode. */
export declare const FOLLOW_UP_POLICY: Readonly<Record<Mode, FollowUpPolicy>>;
/**
 * Most questions the next reply may ask.
 *
 * @param policy - the mode's policy.
 * @param questionsLeft - questions the refinement's cap still allows.
 * @returns a whole number, 0 when no question may be asked.
 */
export declare function questionsForReply(policy: FollowUpPolicy, questionsLeft: number): number;
