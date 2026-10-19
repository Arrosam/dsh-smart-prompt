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
export const MIN_BUDGET_CHARS = 600

/** Verdict of one length measurement. */
export type LengthVerdict =
  | { readonly kind: 'ok'; readonly ratio: number }
  | { readonly kind: 'converge'; readonly ratio: number; readonly charBudget: number }

/** Codepoint length — matches what the user sees and counts, not UTF-16 units. */
export function charLength(text: string): number {
  let count = 0
  for (const _ of text) count += 1
  return count
}

/**
 * Ratio of the rewrite to the draft.
 *
 * An empty draft has no meaningful ratio; report 0 so callers never divide by zero.
 *
 * @param original - the user's draft.
 * @param enhanced - the rewrite.
 * @returns enhanced length divided by original length.
 */
export function ratioOf(original: string, enhanced: string): number {
  const base = charLength(original)
  if (base === 0) return 0
  return charLength(enhanced) / base
}

/**
 * The character budget a rewrite of this draft is allowed.
 *
 * @param original - the user's draft.
 * @param maxRatio - ceiling for the active mode; 0 (or less) means uncapped.
 * @returns max({@link MIN_BUDGET_CHARS}, draft length x ratio), or Infinity when uncapped.
 */
export function budgetFor(original: string, maxRatio: number): number {
  if (!(maxRatio > 0)) return Number.POSITIVE_INFINITY
  return Math.max(MIN_BUDGET_CHARS, Math.floor(charLength(original) * maxRatio))
}

/**
 * Is this rewrite over budget?
 *
 * @param original - the user's draft.
 * @param enhanced - the rewrite.
 * @param maxRatio - ceiling for the active mode.
 * @returns whether the rewrite exceeds {@link budgetFor}.
 */
export function overBudget(original: string, enhanced: string, maxRatio: number): boolean {
  return charLength(enhanced) > budgetFor(original, maxRatio)
}

/**
 * Judge a rewrite against the mode's ceiling.
 *
 * @param original - the user's draft.
 * @param enhanced - the rewrite.
 * @param maxRatio - ceiling for the active mode.
 * @returns `ok`, or `converge` carrying the character budget for one repair attempt.
 */
export function lengthVerdict(original: string, enhanced: string, maxRatio: number): LengthVerdict {
  const ratio = ratioOf(original, enhanced)
  const budget = budgetFor(original, maxRatio)
  if (charLength(enhanced) <= budget) return { kind: 'ok', ratio }
  return { kind: 'converge', ratio, charBudget: budget }
}

/**
 * The repair instruction for a rewrite over its budget, appended to the user message of
 * the single repair call.
 *
 * @param actualChars - the rewrite's length.
 * @param charBudget - the budget it exceeded.
 * @returns the instruction text.
 */
export function lengthRepairClause(actualChars: number, charBudget: number): string {
  return '\nYour previous rewrite was too long: ' + String(actualChars)
    + ' characters against a budget of ' + String(charBudget)
    + '. Rewrite it again, shorter, without dropping any content.'
}

/** Round for display: 1.44 -> "1.4x". */
export function formatRatio(ratio: number): string {
  return (Math.round(ratio * 10) / 10).toFixed(1) + 'x'
}
