/**
 * Per-session enhancement state shared between the composer button and the status
 * bar. Both live in the same client module instance, so a module-level map plus a
 * listener set is the whole mechanism — and the bar needs no slot props at all.
 *
 * @module dsh-smart-prompt/client/store
 */

import type { Mode } from '../settings-fields.js'

/** Minimal composer action face the plugin uses. */
export interface InputActionsFace {
  setDraft(text: string): void
}

/** Serializes the composer's draft attachments (by id) to their wire form. */
export type AttachmentSerializer = (ids: readonly string[]) => Promise<readonly unknown[]>

/** Quality certificate returned by the host. */
export interface Meta {
  mode: Mode
  model: string
  ratio: number
  ratioLabel: string
  elapsedMs: number
  anchors: { total: number; kept: number; reinjected: number }
  note: string
  contextUsed: string
  /** Follow-up questions; absent from hosts older than this client. */
  questions?: { asked: number; answered: number }
  /** Session lookup rounds used; absent from hosts older than this client. */
  lookups?: number
  /**
   * Token use summed over every model call of the refine (Stardea calls included):
   * cache-miss input, cache-hit input, output. Absent when no call reported usage.
   */
  usage?: { input: number; cached: number; output: number }
}

/**
 * One Stardea candidate answer. `source` is 'web' | 'conversation' | 'proposal' today; kept
 * as a string so an idea from a newer host still shows (just without a source tag).
 */
export interface Idea {
  id: string
  text: string
  source: string
}

/** Inline note under a question: a failed Stardea click, or one that found nothing new. */
export interface AskNotice {
  kind: 'error' | 'info'
  text: string
}

/** One follow-up question and the user's answer draft for it. */
export interface AskQuestion {
  readonly id: string
  readonly question: string
  /** Stardea ideas in arrival order; every click appends. */
  readonly ideas: Idea[]
  /** Ids of the ticked ideas. */
  readonly selected: Set<string>
  /** The user's own words. */
  custom: string
  /** A Stardea request for this question is in flight. */
  pending: boolean
  /** Note left by the last Stardea click; cleared when the next one starts. */
  notice: AskNotice | null
}

/**
 * Follow-up questions the host is waiting on. The panel's drafts (ideas, ticks, own words)
 * live here rather than in the panel component: switching sessions unmounts the panel, and
 * Stardea ideas cost model calls, so a remount must find them again.
 */
export interface AskRun {
  readonly runId: string
  readonly questions: readonly AskQuestion[]
  /** The composer face the refine writes its result with (the one it started with). */
  readonly actions: InputActionsFace
  /**
   * Aborts this run's Stardea requests when the panel closes: their ideas would have nowhere
   * to show, and the host should not keep extending the refine's conversation for them.
   */
  readonly stardea: AbortController
  /** Withdraws the panel from the composer seat; set once it is published, safe to call twice. */
  unpublish: () => void
}

/** Per-session state. */
export interface SessionState {
  phase: 'idle' | 'busy' | 'done' | 'error'
  /** Draft as it was before the successful replacement. */
  backup: string
  /** The text we wrote into the composer. */
  enhanced: string
  meta: Meta | null
  error: string | null
  /** Set while a request is in flight so the button can cancel it. */
  controller: AbortController | null
  /** Captured from the button's slot props; Revert/Retry reuse it to write the draft. */
  actions: InputActionsFace | null
  /**
   * The composer's attachment ids and their serializer, captured like `actions` so every
   * refine (button, capsule Retry, error-bubble Retry) sends the attachments in the
   * composer at that moment. Refining never changes them.
   */
  attachmentIds: readonly string[]
  serialize: AttachmentSerializer | null
  /**
   * The status-bar instance that showed this refine's success bubble, or null before any has.
   * Kept here, not in the component, because navigating away unmounts the bar and a fresh
   * instance must know the bubble was already shown (it showed again on every return).
   */
  doneBubbleOwner: object | null
  /**
   * The open follow-up questions, or null. Only set while `phase` is 'busy' (the refine waits
   * for the answers); the draft they are about is `backup`.
   */
  ask: AskRun | null
}

const states = new Map<string, SessionState>()
const listeners = new Map<string, Set<() => void>>()

function fresh(): SessionState {
  return { phase: 'idle', backup: '', enhanced: '', meta: null, error: null, controller: null, actions: null, attachmentIds: [], serialize: null, doneBubbleOwner: null, ask: null }
}

/** State for one session, created on first use. */
export function storeFor(sessionId: string): SessionState {
  let state = states.get(sessionId)
  if (state === undefined) { state = fresh(); states.set(sessionId, state) }
  return state
}

/** Subscribe to changes for one session. */
export function subscribe(sessionId: string, listener: () => void): () => void {
  let set = listeners.get(sessionId)
  if (set === undefined) { set = new Set(); listeners.set(sessionId, set) }
  set.add(listener)
  return () => { set?.delete(listener) }
}

/** Publish a change for one session. */
export function notify(sessionId: string): void {
  const set = listeners.get(sessionId)
  if (set === undefined) return
  for (const listener of set) {
    try { listener() } catch { /* one bad subscriber must not stop the rest */ }
  }
}

/**
 * Withdraw one session's follow-up panel, if open. Does not notify: every caller settles the
 * phase right after and notifies once for both changes.
 *
 * @param sessionId - the session whose panel goes.
 */
export function closeAsk(sessionId: string): void {
  const state = storeFor(sessionId)
  if (state.ask === null) return
  state.ask.unpublish()
  state.ask.stardea.abort()
  state.ask = null
}

/**
 * Reset one session to idle, dropping any stale Revert/Retry information.
 *
 * @param sessionId - the session to reset.
 * @param phase - the phase to land on.
 * @param error - message for the error phase.
 */
export function clear(sessionId: string, phase: 'idle' | 'error' = 'idle', error: string | null = null): void {
  // The composer faces (actions, attachments) survive a reset; only the refine result goes.
  const state = storeFor(sessionId)
  state.phase = phase
  state.error = error
  state.backup = ''
  state.enhanced = ''
  state.meta = null
  state.controller = null
  state.doneBubbleOwner = null
  notify(sessionId)
}
