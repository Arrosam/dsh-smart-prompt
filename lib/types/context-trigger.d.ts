/**
 * Smart session-context trigger (design option C).
 *
 * Session history is only worth carrying when the draft cannot stand alone.
 * Rather than paying for context on every click (or never paying for it), this
 * module answers one deterministic question: does THIS draft need the conversation
 * to be understood?
 *
 * @module dsh-smart-prompt/context-trigger
 */
/** Why the trigger fired. */
export type ContextReason = 'anaphora' | 'short-vague' | 'none';
/**
 * Does this draft need the session history to be understood?
 *
 * Two deterministic signals:
 * - **anaphora** — a pronoun or continuation marker that points outside the draft.
 * - **short-vague** — a very short draft carrying no concrete fact (no path, URL,
 *   code, number, or file extension), e.g. "修一下" / "make it better".
 *
 * @param draft - the user's raw composer text.
 * @returns whether to attach context, and which signal fired.
 */
export declare function contextTrigger(draft: string): {
    needed: boolean;
    reason: ContextReason;
};
