/**
 * Hard-fact extraction — the input side of the fidelity gate.
 *
 * An "anchor" is a piece of the user's draft that carries information the rewrite
 * has no licence to drop or paraphrase: paths, identifiers, numbers, URLs, inline
 * code, @references. The gate is deliberately DETERMINISTIC (no model call): it
 * extracts anchors from the draft, then verifies each one literally survives.
 *
 * @module dsh-smart-prompt/anchors
 */
/** What kind of hard fact an anchor is. */
export type AnchorKind = 'code' | 'url' | 'path' | 'ref' | 'version' | 'number' | 'identifier';
/** One extracted hard fact. */
export interface Anchor {
    /** Exact text as it appeared in the draft (minus markup such as backticks). */
    readonly text: string;
    readonly kind: AnchorKind;
}
/**
 * Extract every hard fact from one draft.
 *
 * Overlapping matchers are resolved first-wins on the text range, so a path inside
 * backticks is recorded once as \`code\` — the stronger requirement, since the rewrite
 * must then reproduce the backticked span exactly.
 *
 * @param draft - the user's raw composer text.
 * @param limit - maximum anchors to return.
 * @returns anchors in first-appearance order, de-duplicated.
 */
export declare function extractAnchors(draft: string, limit?: number): Anchor[];
/** Collapse whitespace so a fact that merely moved onto another line still matches. */
export declare function normalizeForMatch(text: string): string;
/** Remove whitespace entirely: catches a token the model wrapped across a line break. */
export declare function stripWhitespace(text: string): string;
/**
 * Decide whether one anchor survives in the rewrite.
 *
 * Three passes, cheapest first: exact substring, whitespace-collapsed, then
 * whitespace-stripped. The bias is deliberate — reporting a kept fact as missing
 * would cost a needless repair call, while reporting a dropped fact as kept only
 * costs a repair the deterministic re-append still guarantees. Case stays
 * significant: \`Foo\` and \`foo\` are different identifiers in most languages.
 *
 * @param anchor - the extracted hard fact.
 * @param normalizedEnhanced - the rewrite through {@link normalizeForMatch}.
 * @param rawEnhanced - the rewrite as produced.
 * @param strippedEnhanced - the rewrite through {@link stripWhitespace}.
 * @returns whether the fact survived.
 */
export declare function anchorSurvives(anchor: Anchor, normalizedEnhanced: string, rawEnhanced: string, strippedEnhanced?: string): boolean;
