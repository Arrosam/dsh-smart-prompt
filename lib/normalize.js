/**
 * Output normalization: turn whatever the model returned into the exact text that
 * belongs back in the composer.
 *
 * @module dsh-smart-prompt/normalize
 */
/** Openers a rewrite must never carry, checked case-insensitively against the first line. */
const PREAMBLE = /^(?:here(?:'s| is)[^\n]{0,40}:|sure[,!]|certainly[,!]|当然[，,]?|好的[，,]?|以下是[^\n]{0,60}[:：]|优化后[^\n]{0,60}[:：]|增强后[^\n]{0,60}[:：]|重写后[^\n]{0,60}[:：]|改写后[^\n]{0,60}[:：])\s*$/i;
/** A line that is only a divider, never part of a prompt. */
const DIVIDER = /^\s*([-*_=]{3,}|\u2014{2,})\s*$/;
/**
 * Strip the container the model sometimes wraps a rewrite in: a whole-text code
 * fence, matching surrounding quotes, a leading preamble line, and trailing dividers.
 *
 * Deliberately conservative — it only touches wrappers that enclose the ENTIRE
 * output, so a prompt that legitimately contains a code block keeps it.
 *
 * @param raw - the model's output.
 * @returns the text to place in the composer, or '' when nothing usable remains.
 */
export function normalizeOutput(raw) {
    let text = typeof raw === 'string' ? raw : '';
    text = text.replace(/^\uFEFF/, '').trim();
    if (text === '')
        return '';
    // Whole-text code fence: ```lang\n ... \n```
    const fence = /^```[a-zA-Z0-9_.+-]*\n([\s\S]*?)\n?```$/.exec(text);
    if (fence !== null && fence[1] !== undefined && fence[1].trim() !== '')
        text = fence[1].trim();
    // Matching surrounding quotes, only when they wrap the whole thing and the inner
    // text contains no unescaped copy of the same quote.
    const quote = /^(["'\u201c\u201d\u2018\u2019])([\s\S]*)\1$/.exec(text);
    if (quote !== null && quote[2] !== undefined && !quote[2].includes(quote[1]))
        text = quote[2].trim();
    // Leading preamble line(s): at most two, and only when a body follows.
    for (let i = 0; i < 2; i += 1) {
        const newline = text.indexOf('\n');
        if (newline <= 0)
            break;
        const first = text.slice(0, newline).trim();
        if (!PREAMBLE.test(first))
            break;
        const rest = text.slice(newline + 1).trim();
        if (rest === '')
            break;
        text = rest;
    }
    // Trailing divider / sign-off lines.
    const lines = text.split('\n');
    while (lines.length > 1) {
        const last = lines[lines.length - 1].trim();
        if (last === '' || DIVIDER.test(last)) {
            lines.pop();
            continue;
        }
        break;
    }
    text = lines.join('\n').trim();
    // A rewrite that is only a divider or a stray fence is not usable.
    if (text === '' || DIVIDER.test(text) || /^```/.test(text) && text.length < 4)
        return '';
    return text;
}
//# sourceMappingURL=normalize.js.map