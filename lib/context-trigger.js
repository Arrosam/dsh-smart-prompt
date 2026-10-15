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
/** Chinese anaphora / continuation markers — matched as plain substrings. */
const ZH_MARKERS = [
    '这个', '那个', '这些', '那些', '上述', '上面', '刚刚', '刚才', '之前', '前面',
    '同样', '照旧', '继续', '接着', '还是', '就这样', '按这个', '按那个', '该方法', '这个方案',
    '它', '他俩', '它们', '此处', '那里', '这边',
];
/** English markers — word-boundary matched so "item"/"wait" never fire. */
const EN_MARKERS = [
    'it', 'its', 'this', 'that', 'these', 'those', 'above', 'previous', 'the same',
    'same way', 'continue', 'as before', 'again', 'there',
];
/** Drafts at or below this codepoint count with no concrete fact are treated as too thin to stand alone. */
const SHORT_DRAFT_CHARS = 12;
/** A draft containing one of these is self-sufficient no matter how short. */
const CONCRETE_HINT = /[A-Za-z0-9_].[A-Za-z0-9]{1,8}\b|[/\\]|\bhttps?:|\u0060|\d/;
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
export function contextTrigger(draft) {
    const text = typeof draft === 'string' ? draft : '';
    const trimmed = text.trim();
    if (trimmed === '')
        return { needed: false, reason: 'none' };
    for (const marker of ZH_MARKERS) {
        if (trimmed.includes(marker))
            return { needed: true, reason: 'anaphora' };
    }
    for (const marker of EN_MARKERS) {
        const re = new RegExp('\\b' + marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (re.test(trimmed))
            return { needed: true, reason: 'anaphora' };
    }
    let count = 0;
    for (const _ of trimmed)
        count += 1;
    if (count <= SHORT_DRAFT_CHARS && !CONCRETE_HINT.test(trimmed)) {
        return { needed: true, reason: 'short-vague' };
    }
    return { needed: false, reason: 'none' };
}
//# sourceMappingURL=context-trigger.js.map