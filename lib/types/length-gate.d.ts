/**
 * Length gate — the deterministic answer to the industry's most common failure:
 * a one-line request that comes back as a thirty-line specification.
 *
 * The instrument is a RATIO with an ABSOLUTE FLOOR, because a pure ratio is wrong
 * at both ends: a 2.5x ceiling would let a 2000-character draft grow by 3000 more,
 * while the same 2.5x would refuse a nine-character draft the three-line rewrite it
 * most needs. Below {@link MIN_BUDGET_CHARS} characters the floor governs; above it
 * the mode's ratio governs. WorkBuddy's own positioning ("less filler, fewer
 * tokens", a flat ~800-character budget) is the same instinct.
 *
 * @module dsh-smart-prompt/length-gate
 */
/**
 * Absolute character budget below which the ratio does not apply.
 *
 * Sized so a terse draft can still come back as a short structured prompt
 * (deliverable + constraints + acceptance) rather than being refused its own
 * improvement.
 */
export declare const MIN_BUDGET_CHARS = 600;
/** Verdict of one length measurement. */
export type LengthVerdict = {
    readonly kind: 'ok';
    readonly ratio: number;
} | {
    readonly kind: 'converge';
    readonly ratio: number;
    readonly charBudget: number;
};
/** Codepoint length — matches what the user sees and counts, not UTF-16 units. */
export declare function charLength(text: string): number;
/**
 * Ratio of the rewrite to the draft.
 *
 * An empty draft has no meaningful ratio; report 0 so callers never divide by zero.
 *
 * @param original - the user's draft.
 * @param enhanced - the rewrite.
 * @returns enhanced length divided by original length.
 */
export declare function ratioOf(original: string, enhanced: string): number;
/**
 * The character budget a rewrite of this draft is allowed.
 *
 * @param original - the user's draft.
 * @param maxRatio - ceiling for the active mode; 0 (or less) means uncapped.
 * @returns max({@link MIN_BUDGET_CHARS}, draft length x ratio), or Infinity when uncapped.
 */
export declare function budgetFor(original: string, maxRatio: number): number;
/**
 * Is this rewrite over budget?
 *
 * @param original - the user's draft.
 * @param enhanced - the rewrite.
 * @param maxRatio - ceiling for the active mode.
 * @returns whether the rewrite exceeds {@link budgetFor}.
 */
export declare function overBudget(original: string, enhanced: string, maxRatio: number): boolean;
/**
 * Judge a rewrite against the mode's ceiling.
 *
 * @param original - the user's draft.
 * @param enhanced - the rewrite.
 * @param maxRatio - ceiling for the active mode.
 * @returns `ok`, or `converge` carrying the character budget for one repair attempt.
 */
export declare function lengthVerdict(original: string, enhanced: string, maxRatio: number): LengthVerdict;
/** Round for display: 1.44 -> "1.4x". */
export declare function formatRatio(ratio: number): string;
