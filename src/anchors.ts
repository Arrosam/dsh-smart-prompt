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
export type AnchorKind = 'code' | 'url' | 'path' | 'ref' | 'version' | 'number' | 'identifier'

/** One extracted hard fact. */
export interface Anchor {
  /** Exact text as it appeared in the draft (minus markup such as backticks). */
  readonly text: string
  readonly kind: AnchorKind
}

/** Maximum anchors tracked; beyond this the gate reports honestly rather than growing unbounded. */
const MAX_ANCHORS = 200
/** Anchors shorter than this are noise (single letters, one-digit numbers). */
const MIN_LENGTH = 2
/** Cap for one kept span. */
const MAX_CODE_LENGTH = 120

const FILE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'd', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'swift', 'm', 'mm', 'scala', 'sh', 'bash', 'zsh',
  'ps1', 'bat', 'sql', 'md', 'mdx', 'txt', 'log', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini',
  'cfg', 'conf', 'env', 'lock', 'gradle', 'properties', 'xml', 'html', 'htm', 'css', 'scss',
  'less', 'vue', 'svelte', 'astro', 'proto', 'tf', 'dockerfile', 'makefile', 'ipynb', 'csv',
].join('|')

interface Matcher {
  readonly kind: AnchorKind
  readonly pattern: RegExp
  /** Claim the span without recording it: used for fenced blocks, which are payload, not a fact. */
  readonly claimOnly?: boolean
}

/**
 * Ordered matchers; earlier matchers claim their spans so later ones cannot re-read
 * them. A fenced code block is CLAIMED but not recorded — it is normally the payload
 * the user pasted, not a fact the surrounding prose must reproduce — while an inline
 * \`code\` span is short, specific, and always recorded.
 */
const MATCHERS: ReadonlyArray<Matcher> = [
  { kind: 'code', pattern: /```[\s\S]*?```/g, claimOnly: true },
  { kind: 'code', pattern: /`[^`\n]+`/g },
  { kind: 'url', pattern: /https?:\/\/[^\s<>()[\]"'`]+/g },
  { kind: 'ref', pattern: /(?:^|[\s(\[{,，。；;])@([A-Za-z0-9_][A-Za-z0-9_./-]{1,})/g },
  // any path with at least one separator: absolute, drive-lettered, ./-relative, or bare-relative
  { kind: 'path', pattern: /(?:[A-Za-z]:)?(?:\/|\.{1,2}\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@*-]+)+/g },
  // bare file names carrying a known extension
  { kind: 'path', pattern: new RegExp('\\b[A-Za-z0-9_@-][A-Za-z0-9_.@-]*\\.(?:' + FILE_EXTENSIONS + ')\\b', 'gi') },
  { kind: 'version', pattern: /\bv?\d+(?:\.\d+){1,3}(?:-rc\.?\d*)?\b/gi },
  { kind: 'number', pattern: /\b\d+(?:\.\d+)?\s?(?:%|px|em|rem|ms|s|m|h|kb|mb|gb|tb|k|w|次|个|秒|分钟|小时|天|行|条|页)\b/gi },
  // dotted paths first: they must claim the whole token before camelCase reads a segment
  { kind: 'identifier', pattern: /\b[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*){1,4}\b/g },
  { kind: 'identifier', pattern: /\b[a-z][a-zA-Z0-9]*(?:[A-Z][A-Za-z0-9]*)+\b/g },
  { kind: 'identifier', pattern: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g },
  { kind: 'identifier', pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g },
]

/** Strip the markup a matcher matched around the fact itself. */
function unwrap(kind: AnchorKind, raw: string): string {
  let text = raw
  if (kind === 'code') text = text.replace(/^`|`$/g, '')
  if (kind === 'ref') {
    const at = text.indexOf('@')
    text = at >= 0 ? text.slice(at) : text
  }
  return text.trim()
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
export function extractAnchors(draft: string, limit = MAX_ANCHORS): Anchor[] {
  const text = typeof draft === 'string' ? draft : ''
  if (text === '') return []
  const claimed = new Array<boolean>(text.length).fill(false)
  const seen = new Set<string>()
  const out: Anchor[] = []

  for (const { kind, pattern, claimOnly } of MATCHERS) {
    const re = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      if (match[0] === '') { re.lastIndex += 1; continue }
      const start = match.index
      const end = start + match[0].length
      let free = true
      for (let i = start; i < end; i += 1) {
        if (claimed[i] === true) { free = false; break }
      }
      if (!free) continue
      for (let i = start; i < end; i += 1) claimed[i] = true
      if (claimOnly === true) continue
      const value = unwrap(kind, match[0])
      if (value.length < MIN_LENGTH || value.length > MAX_CODE_LENGTH) continue
      const key = kind + '\u0000' + value
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text: value, kind })
      if (out.length >= limit) return out
    }
  }
  return out
}

/** Collapse whitespace so a fact that merely moved onto another line still matches. */
export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/** Remove whitespace entirely: catches a token the model wrapped across a line break. */
export function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '')
}

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
export function anchorSurvives(
  anchor: Anchor,
  normalizedEnhanced: string,
  rawEnhanced: string,
  strippedEnhanced?: string,
): boolean {
  if (rawEnhanced.includes(anchor.text)) return true
  if (normalizedEnhanced.includes(normalizeForMatch(anchor.text))) return true
  const stripped = strippedEnhanced !== undefined ? strippedEnhanced : stripWhitespace(rawEnhanced)
  return stripped.includes(stripWhitespace(anchor.text))
}
