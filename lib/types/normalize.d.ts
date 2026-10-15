/**
 * Output normalization: turn whatever the model returned into the exact text that
 * belongs back in the composer.
 *
 * @module dsh-smart-prompt/normalize
 */
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
export declare function normalizeOutput(raw: string): string;
