/**
 * Per-session enhancement state shared between the composer button and the status
 * bar. Both live in the same client module instance, so a module-level map plus a
 * listener set is the whole mechanism — and the bar needs no slot props at all.
 *
 * @module dsh-smart-prompt/client/store
 */

/** Mode the user picked. */
export type Mode = 'light' | 'standard'

/** Minimal composer action face the plugin uses. */
export interface InputActionsFace {
  setDraft(text: string): void
}

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
}

const states = new Map<string, SessionState>()
const listeners = new Map<string, Set<() => void>>()

function fresh(): SessionState {
  return { phase: 'idle', backup: '', enhanced: '', meta: null, error: null, controller: null, actions: null }
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
 * Reset one session to idle, dropping any stale Revert/Retry information.
 *
 * @param sessionId - the session to reset.
 * @param phase - the phase to land on.
 * @param error - message for the error phase.
 */
export function clear(sessionId: string, phase: 'idle' | 'error' = 'idle', error: string | null = null): void {
  const state = storeFor(sessionId)
  const actions = state.actions
  state.phase = phase
  state.error = error
  state.backup = ''
  state.enhanced = ''
  state.meta = null
  state.controller = null
  state.actions = actions
  notify(sessionId)
}
