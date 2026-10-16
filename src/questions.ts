/**
 * Follow-up questions about missing information.
 *
 * The first rewrite call may end with a `<missing_info>` block listing what the draft
 * lacks (see `prompts/questions.md`). The orchestrator asks those questions through the
 * host's ask-user seam, then rewrites once more with the answers. Kept pure: parsing and
 * formatting only, no host access.
 *
 * @module dsh-smart-prompt/questions
 */

import { escapeClosingTag } from './prompts.js'

/** Tag wrapping the model's list of missing information. */
const BLOCK_RE = /<missing_info>([\s\S]*?)<\/missing_info>/gi
/** One question inside the block. */
const QUESTION_RE = /<question>([\s\S]*?)<\/question>/gi

/** Prefix of the question ids sent to the ask-user seam (`q1`, `q2`, …). */
const QUESTION_ID_PREFIX = 'q'

/** A rewrite with any missing-information block taken out. */
export interface ParsedRewrite {
  /** The rewrite without the block. */
  readonly text: string
  /** Questions the model asked, trimmed, empty ones dropped, capped at `max`. */
  readonly questions: readonly string[]
}

/**
 * Split a model reply into the rewrite and its follow-up questions.
 *
 * Every block is removed from the text, so a block the model emits where none was
 * asked for never reaches the composer.
 *
 * @param raw - the model reply.
 * @param max - most questions to keep.
 * @returns the rewrite text and the questions.
 */
export function parseRewrite(raw: string, max: number): ParsedRewrite {
  const questions: string[] = []
  for (const block of raw.matchAll(BLOCK_RE)) {
    for (const item of (block[1] ?? '').matchAll(QUESTION_RE)) {
      const question = (item[1] ?? '').trim()
      if (question !== '') questions.push(question)
    }
  }
  return { text: raw.replace(BLOCK_RE, '').trim(), questions: questions.slice(0, Math.max(0, max)) }
}

/** Id of the question at one position. */
export function questionId(index: number): string {
  return QUESTION_ID_PREFIX + String(index + 1)
}

/** One answered question. */
export interface AnsweredQuestion {
  readonly question: string
  readonly answer: string
}

/** The ask-user seam's answer shape (`@deepseek-ai/dsh-user-questions`). */
export interface SeamAnswer {
  readonly answers?: readonly { readonly id?: unknown; readonly selected?: unknown; readonly custom?: unknown }[]
}

/**
 * Pair the asked questions with the user's answers, dropping skipped ones.
 *
 * @param questions - questions in ask order.
 * @param answer - the seam's reply.
 * @returns the answered questions, in ask order.
 */
export function answeredQuestions(questions: readonly string[], answer: SeamAnswer): AnsweredQuestion[] {
  const out: AnsweredQuestion[] = []
  questions.forEach((question, index) => {
    const item = answer.answers?.find((entry) => entry.id === questionId(index))
    if (item === undefined) return
    const custom = typeof item.custom === 'string' ? item.custom.trim() : ''
    const selected = Array.isArray(item.selected) ? item.selected.filter((s): s is string => typeof s === 'string' && s !== '') : []
    const text = custom !== '' ? custom : selected.join(', ')
    if (text !== '') out.push({ question, answer: text })
  })
  return out
}

/**
 * Render the answers for the rewrite call's user message.
 *
 * @param answered - answered questions.
 * @returns the `<user_answers>` block, or '' when there are none.
 */
export function formatAnswers(answered: readonly AnsweredQuestion[]): string {
  if (answered.length === 0) return ''
  // The answers are user text inside a frame: they must not be able to close it.
  const lines = answered.map((a) => 'Q: ' + escapeClosingTag(a.question) + '\nA: ' + escapeClosingTag(a.answer))
  return '<user_answers>\n' + lines.join('\n\n') + '\n</user_answers>'
}
