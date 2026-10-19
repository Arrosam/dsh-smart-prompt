/**
 * Stardea (星念): ideas for answering a follow-up question.
 *
 * The user may ask for ideas on any question the refinement asked. The model answers in
 * the refinement's own conversation with an `<ideas>` block (see `prompts/stardea.md`);
 * this module parses it and keeps every idea proposed so far, so a later request for the
 * same question returns only ideas that are new. Kept pure: parsing and bookkeeping only.
 *
 * @module dsh-smart-prompt/stardea
 */

/** Where an idea came from, as the model declared it. */
export const IDEA_SOURCES = ['web', 'conversation', 'proposal'] as const
export type IdeaSource = typeof IDEA_SOURCES[number]
/** The source of an idea whose declared source is missing or unknown: the model's own proposal. */
const DEFAULT_SOURCE: IdeaSource = 'proposal'

/** One idea offered to the user. */
export interface Idea { readonly id: string; readonly text: string; readonly source: IdeaSource }

/** What a Stardea request returns: the new ideas, or why there are none. */
export type StardeaOutcome =
  | { readonly ok: true; readonly ideas: readonly Idea[] }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** Asks for ideas for one question; `signal` cancels this request only. */
export type Stardea = (questionId: string, signal: AbortSignal) => Promise<StardeaOutcome>

/** Tag wrapping the ideas, and one idea inside it (its `source` attribute optional). */
const BLOCK_RE = /<ideas>([\s\S]*?)<\/ideas>/gi
const IDEA_RE = /<idea(?:\s+source\s*=\s*["']?([a-z]+)["']?)?\s*>([\s\S]*?)<\/idea>/gi

/** Infix of an idea id: `<questionId>-i<n>`. */
const IDEA_ID_INFIX = '-i'

/** One parsed idea, before it is given an id. */
export interface ParsedIdea { readonly text: string; readonly source: IdeaSource }

/**
 * Read the ideas out of a model reply.
 *
 * @param raw - the model reply.
 * @returns the non-empty ideas in reply order; [] when the reply holds no `<ideas>` block.
 */
export function parseIdeas(raw: string): ParsedIdea[] {
  const ideas: ParsedIdea[] = []
  for (const block of raw.matchAll(BLOCK_RE)) {
    for (const item of (block[1] ?? '').matchAll(IDEA_RE)) {
      const text = (item[2] ?? '').trim()
      const declared = (item[1] ?? '').toLowerCase()
      if (text !== '') ideas.push({ text, source: (IDEA_SOURCES as readonly string[]).includes(declared) ? declared as IdeaSource : DEFAULT_SOURCE })
    }
  }
  return ideas
}

/** Comparison form of an idea: case and whitespace do not make an idea new. */
function sameIdeaKey(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, ' ').trim()
}

/** Every idea proposed in one refinement, per question. */
export class IdeaBook {
  private readonly byQuestion = new Map<string, Idea[]>()

  /** Whether ideas were already proposed for a question. */
  has(questionId: string): boolean {
    return (this.byQuestion.get(questionId)?.length ?? 0) > 0
  }

  /**
   * Keep the ideas that are new for a question, up to `max`.
   *
   * @param questionId - the question the ideas answer.
   * @param parsed - ideas read from one reply.
   * @param max - most ideas to keep from this reply.
   * @returns the new ideas with their ids, possibly none.
   */
  add(questionId: string, parsed: readonly ParsedIdea[], max: number): Idea[] {
    const kept = this.byQuestion.get(questionId) ?? []
    const seen = new Set(kept.map((idea) => sameIdeaKey(idea.text)))
    const fresh: Idea[] = []
    for (const idea of parsed) {
      if (fresh.length >= max) break
      const key = sameIdeaKey(idea.text)
      if (seen.has(key)) continue
      seen.add(key)
      fresh.push({ id: questionId + IDEA_ID_INFIX + String(kept.length + fresh.length + 1), text: idea.text, source: idea.source })
    }
    this.byQuestion.set(questionId, [...kept, ...fresh])
    return fresh
  }
}
