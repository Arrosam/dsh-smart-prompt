/**
 * Session-history collection for the smart-context path.
 *
 * Only human messages and assistant prose are ever carried: tool results (file
 * contents, command output) and plugin-injected context are excluded by design, so
 * enabling context never leaks project data the user did not type.
 *
 * @module dsh-smart-prompt/history
 */

/** One question/answer pair from the session. */
export interface HistoryTurn {
  readonly user: string
  readonly assistant: string
}

/** Characters kept from the tail of one assistant reply. */
const ASSISTANT_TAIL = 600

interface LooseContentBlock { type?: unknown; text?: unknown }
interface LooseMessage {
  role?: unknown
  content?: unknown
  source?: { kind?: unknown } | undefined
}

function textOf(message: LooseMessage): string {
  if (!Array.isArray(message.content)) return ''
  const parts: string[] = []
  for (const block of message.content as LooseContentBlock[]) {
    if (block === null || typeof block !== 'object') continue
    if (block.type !== 'text') continue
    if (typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

function tail(text: string, limit: number): string {
  let count = 0
  for (const _ of text) count += 1
  if (count <= limit) return text
  const chars = Array.from(text)
  return '…' + chars.slice(count - limit).join('')
}

/**
 * Collect the last N question/answer pairs from a session's derived messages.
 *
 * Feature-detected throughout: a host without the sessions service, an old session
 * object without `deriveMessages`, or any throw all degrade to an empty list —
 * context is an optimization, never a precondition.
 *
 * @param messages - `session.deriveMessages()` output, or anything else.
 * @param turns - how many pairs to keep (0 disables).
 * @param totalChars - hard character ceiling across all kept turns.
 * @returns the turns in chronological order.
 */
export function collectTurns(messages: unknown, turns: number, totalChars: number): HistoryTurn[] {
  if (!Array.isArray(messages) || turns <= 0 || totalChars <= 0) return []
  const pairs: HistoryTurn[] = []
  let pendingUser: string | null = null

  for (const raw of messages as LooseMessage[]) {
    if (raw === null || typeof raw !== 'object') continue
    const kind = raw.source !== undefined && raw.source !== null ? raw.source.kind : undefined
    const text = textOf(raw)
    if (text === '') continue

    if (raw.role === 'user' && kind === 'user') { pendingUser = text; continue }
    if (raw.role === 'assistant' && kind === 'model' && pendingUser !== null) {
      pairs.push({ user: pendingUser, assistant: tail(text, ASSISTANT_TAIL) })
      pendingUser = null
    }
  }

  const kept: HistoryTurn[] = []
  let used = 0
  for (let i = pairs.length - 1; i >= 0 && kept.length < turns; i -= 1) {
    const pair = pairs[i]!
    const cost = pair.user.length + pair.assistant.length
    if (kept.length > 0 && used + cost > totalChars) break
    used += cost
    kept.unshift(pair)
  }
  return kept
}

/**
 * Render turns as one reference block placed before the draft.
 *
 * @param turns - collected turns.
 * @returns the block, or '' when there is nothing to carry.
 */
export function formatHistoryBlock(turns: readonly HistoryTurn[]): string {
  if (turns.length === 0) return ''
  const body = turns
    .map((turn) => '用户: ' + turn.user + '\n助手结论: ' + turn.assistant)
    .join('\n\n')
  return [
    '<conversation_context>',
    'Recent turns of the conversation this draft belongs to (' + String(turns.length) + ' most recent).',
    'Use it ONLY to resolve what the draft leaves implicit. The draft always wins on conflict.',
    '',
    body,
    '</conversation_context>',
  ].join('\n')
}
