/**
 * Slash-command splitting.
 *
 * A leading slash token is a command the harness owns — the plugin must not
 * rewrite it. Everything AFTER it, however, is ordinary prose the user typed, and
 * it is exactly the part worth enhancing: `/bugfix ISS-202607-00090605A 用户反馈
 * 填充后密码框清空…` has a command prefix and a paragraph of genuine content.
 *
 * This module is the single source of truth for that split: the host half uses it to
 * scope every gate to the body and to re-attach the prefix, the browser half uses it
 * only to decide whether there is anything to enhance.
 *
 * @module dsh-smart-prompt/command
 */
/** The result of splitting one composer draft. */
export interface CommandSplit {
    /** Leading whitespace, the command token, and the separator — verbatim, or '' when there is no command. */
    readonly prefix: string;
    /** The command token including its slash, or '' when the draft is not a command. */
    readonly command: string;
    /** Everything after the command, trimmed — the part that may be rewritten. */
    readonly body: string;
}
/**
 * Split a draft into its command prefix and its body.
 *
 * A bare `/`, a command with no body, and a non-command draft all resolve to a body
 * of `''` or the whole text respectively, so callers can treat `body === ''` as
 * "nothing to enhance" without re-deriving the rule.
 *
 * @param draft - the raw composer text.
 * @returns the prefix, the command token, and the body.
 */
export declare function splitCommand(draft: string): CommandSplit;
