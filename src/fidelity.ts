/**
 * Fidelity gate — the plugin's core differentiator.
 *
 * Every other prompt enhancer in the ecosystem asks the model, in its system
 * prompt, to "preserve the original details". None of them checks whether it did.
 * This module checks, deterministically, and then repairs.
 *
 * @module dsh-smart-prompt/fidelity
 */

import { anchorSurvives, normalizeForMatch, stripWhitespace, type Anchor } from './anchors.js'

/** Result of one fidelity check. */
export interface FidelityOutcome {
  /** How many hard facts the draft carried. */
  readonly total: number
  /** How many survived the rewrite. */
  readonly kept: number
  /** The facts that did not survive, in draft order. */
  readonly missing: Anchor[]
}

/**
 * Verify that every hard fact in the draft survived the rewrite.
 *
 * @param anchors - facts extracted from the draft.
 * @param enhanced - the rewrite.
 * @returns counts plus the exact list of dropped facts.
 */
export function checkFidelity(anchors: readonly Anchor[], enhanced: string): FidelityOutcome {
  const raw = typeof enhanced === 'string' ? enhanced : ''
  const normalized = normalizeForMatch(raw)
  const stripped = stripWhitespace(raw)
  const missing: Anchor[] = []
  for (const anchor of anchors) {
    if (!anchorSurvives(anchor, normalized, raw, stripped)) missing.push(anchor)
  }
  return { total: anchors.length, kept: anchors.length - missing.length, missing }
}

/**
 * One repair instruction appended to the user message for the single retry that
 * a failed gate is allowed. Lists the exact strings so the model can place them
 * naturally instead of guessing.
 *
 * @param missing - facts the first pass dropped.
 * @returns the instruction text.
 */
export function repairClause(missing: readonly Anchor[]): string {
  if (missing.length === 0) return ''
  const listed = missing.map((a) => '- ' + a.text).join('\n')
  return [
    '',
    'Your previous rewrite DROPPED content that must be preserved. Produce the rewrite again,',
    'keeping everything you already had, and place each of these EXACT strings back into it',
    'naturally (do not append them as a list at the end, and do not translate or reformat them):',
    listed,
  ].join('\n')
}

/**
 * Deterministic last resort: a block appended to the rewrite so no fact is ever
 * silently lost, even when the model refuses to re-include it.
 *
 * Only reached after the repair pass failed. Kept visually separate and explicitly
 * labelled so it reads as a preserved-details note rather than as prose the user wrote.
 *
 * @param missing - facts still absent.
 * @returns the block to append, or '' when nothing is missing.
 */
export function reinjectionBlock(missing: readonly Anchor[]): string {
  if (missing.length === 0) return ''
  const labels: Record<string, string> = { zh: '保留原始细节', en: 'Preserved original details' }
  return '\n\n' + labels.zh + ' / ' + labels.en + ':\n' + missing.map((a) => '- ' + a.text).join('\n')
}

/** How many dropped facts are worth naming in the user-facing report. */
const REPORT_LIMIT = 5

/**
 * Human-readable account of a partial result, shown in the composer status bar.
 *
 * @param missing - facts that had to be re-appended.
 * @returns one short line, or '' when nothing is missing.
 */
export function fidelityNote(missing: readonly Anchor[]): string {
  if (missing.length === 0) return ''
  const named = missing.slice(0, REPORT_LIMIT).map((a) => a.text).join('、')
  const more = missing.length > REPORT_LIMIT ? ' 等 ' + String(missing.length) + ' 处' : ''
  return named + more
}
