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
  readonly prefix: string
  /** The command token including its slash, or '' when the draft is not a command. */
  readonly command: string
  /** Everything after the command, trimmed — the part that may be rewritten. */
  readonly body: string
}

/** `/name` — letters, digits, underscore, hyphen; the shape the composer claims. */
const COMMAND_RE = /^(\s*)\/([A-Za-z0-9_][A-Za-z0-9_-]*)([ \t]*)([\s\S]*)$/

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
export function splitCommand(draft: string): CommandSplit {
  const text = typeof draft === 'string' ? draft : ''
  const match = COMMAND_RE.exec(text)
  if (match === null) {
    // A bare run of slashes (the user is still typing the command): a command with
    // no name and no body — nothing to rewrite.
    const bare = text.trim()
    if (/^\/+$/.test(bare)) return { prefix: bare, command: bare, body: '' }
    return { prefix: '', command: '', body: bare }
  }

  const lead = match[1] ?? ''
  const name = match[2] ?? ''
  const gap = match[3] ?? ''
  const rest = match[4] ?? ''
  // Keep the user's own line break/indent between command and body.
  const restLead = /^\s*/.exec(rest)?.[0] ?? ''
  const body = rest.trim()

  // `/name` alone, or a stray run of slashes: a command with nothing to rewrite.
  if (body === '' || /^\/+$/.test(body)) {
    return { prefix: lead + '/' + name, command: '/' + name, body: '' }
  }
  // A command glued to its own name (`/bugfix/foo`) is not this shape at all.
  const separator = gap + restLead === '' ? ' ' : gap + restLead
  return { prefix: lead + '/' + name + separator, command: '/' + name, body }
}
