/**
 * The two visible pieces: the composer button (star, or Revert | Retry after a refine)
 * and the status bar.
 *
 * @module dsh-smart-prompt/client/components
 */

import React from 'react'
import { splitCommand } from '../command.js'
import { clear, notify, storeFor, subscribe, type InputActionsFace, type Meta } from './store.js'

/** Localized copy lookup bound to the plugin namespace. */
export type TFn = (key: string) => string

/** Props the conversation renderer injects into a session-scoped slot entry. */
export interface SeatProps {
  sessionId?: string
  /** Snapshot selector hook over the Session input machine (current renderers). */
  useInput?: (selector: (state: unknown) => unknown) => unknown
  /** Stable public input actions for this session. */
  inputActions?: InputActionsFace
  /** Older-host fallback: a point-in-time input snapshot. */
  input?: { draft?: unknown; phase?: unknown }
  t: TFn
}

const API = '/dsh-smart-prompt/api/improve'

/**
 * Keep a press on the chip from taking focus out of the composer.
 *
 * The host's Lexical setDraft() puts the caret at the end of the new text, but Lexical
 * only applies a selection to the DOM while its contenteditable has focus. A plain
 * button press moved focus onto the chip (and the refine then swaps the star for the
 * Revert | Retry capsule, unmounting the focused button), so the caret ended up outside
 * the input. The host's own toolbar buttons use the same mousedown preventDefault
 * (keepDraftFocus in dsh-client-ui-conversation); click and keyboard activation still work.
 */
const keepComposerFocus = (event: React.MouseEvent): void => { event.preventDefault() }

/** Stroke paths (12x12 grid) for the capsule glyphs: a back-arrow for Revert, a circular arrow for Retry. */
const CAPSULE_ICON_PATH = {
  revert: 'M4.6 2.2L1.8 5L4.6 7.8M1.8 5H7.4A3 3 0 0 1 7.4 11H5.2',
  retry: 'M10.2 6A4.2 4.2 0 1 1 8.6 2.7M8.9 0.9L9.2 3.2L6.9 3.6',
} as const

/** Small stroke glyph for one half of the Revert | Retry capsule; inherits the label colour. */
function CapsuleIcon(kind: keyof typeof CAPSULE_ICON_PATH): React.ReactElement {
  return React.createElement('svg', { className: 'dip-capsule-icon', viewBox: '0 0 12 12', width: '12', height: '12', 'aria-hidden': 'true', focusable: 'false' },
    React.createElement('path', { d: CAPSULE_ICON_PATH[kind], fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

/** Four-point sparkle, filled with the text colour so it follows the host theme. */
function Sparkle(): React.ReactElement {
  return React.createElement('svg', { className: 'dip-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
    React.createElement('path', {
      d: 'M8 1.2l1.35 3.9a2 2 0 001.25 1.25l3.9 1.35-3.9 1.35a2 2 0 00-1.25 1.25L8 14.8l-1.35-3.9a2 2 0 00-1.25-1.25L1.5 8.3l3.9-1.35A2 2 0 006.65 5.7L8 1.2z',
      fill: 'currentColor',
    }),
  )
}

/** Read the live draft, preferring the injected hook and falling back to a snapshot prop. */
function readDraft(props: SeatProps): string {
  if (typeof props.useInput === 'function') {
    const value = props.useInput((state: unknown) => {
      const s = state as { draft?: unknown } | null
      return s !== null && s !== undefined && typeof s.draft === 'string' ? s.draft : ''
    })
    if (typeof value === 'string') return value
  }
  const fallback = props.input !== undefined ? props.input.draft : undefined
  return typeof fallback === 'string' ? fallback : ''
}

/** Force a re-render whenever this session's store entry changes. */
function useSessionState(sessionId: string | undefined): number {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    if (sessionId === undefined) return undefined
    return subscribe(sessionId, () => { setVersion((v: number) => v + 1) })
  }, [sessionId])
  return version
}

/**
 * Send one draft to the host and write the result into the composer.
 *
 * Shared by the composer button and the status bar's Retry, so both follow the same
 * state transitions: busy -> done (draft replaced, `backup` keeps `text`) or
 * busy -> error (draft untouched). A slash-command draft with no body is ignored.
 *
 * @param sessionId - the session whose composer is rewritten.
 * @param text - the draft to enhance; becomes the Revert target.
 * @param actions - composer actions used to write the result.
 * @param t - localized copy lookup for failure messages.
 */
function runImprove(sessionId: string, text: string, actions: InputActionsFace, t: TFn): void {
  if (splitCommand(text).body === '') return
  const current = storeFor(sessionId)
  const controller = new AbortController()
  current.controller = controller
  current.phase = 'busy'
  current.error = null
  current.backup = text
  current.meta = null
  current.enhanced = ''
  notify(sessionId)

  void (async () => {
    try {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No mode: the host reads it from the plugin settings page.
        body: JSON.stringify({ sessionId, text }),
        signal: controller.signal,
      })
      const data = (await response.json()) as {
        ok?: boolean; code?: string; message?: string; text?: string; meta?: Meta
      }
      const latest = storeFor(sessionId)
      if (data.ok === true && typeof data.text === 'string' && data.text !== '') {
        latest.enhanced = data.text
        latest.meta = data.meta !== undefined ? data.meta : null
        latest.phase = 'done'
        latest.controller = null
        actions.setDraft(data.text)
        notify(sessionId)
        return
      }
      const code = typeof data.code === 'string' ? data.code : 'UNKNOWN'
      const key = 'err_' + code
      const localized = t(key)
      latest.phase = 'error'
      latest.error = localized !== key ? localized : (typeof data.message === 'string' && data.message !== '' ? data.message : t('err_UNKNOWN'))
      latest.controller = null
      notify(sessionId)
    } catch (error) {
      const latest = storeFor(sessionId)
      latest.controller = null
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      latest.phase = 'error'
      latest.error = aborted ? t('err_ABORTED') : t('err_UPSTREAM')
      notify(sessionId)
    }
  })()
}

/**
 * Composer button: one click replaces the draft in place; a second click while
 * busy cancels. Disabled on an empty composer or a slash command. While the composer
 * still holds the refined text it renders as the Revert | Retry capsule instead.
 */
export function ImproveButton(props: SeatProps): React.ReactElement | null {
  const t = props.t
  const sessionId = props.sessionId
  useSessionState(sessionId)
  const draft = readDraft(props)
  // A leading slash token belongs to the harness; only the text after it is ours.
  // A command with no body therefore has nothing to enhance — but a command WITH a
  // body is exactly the case worth enhancing.
  const split = splitCommand(draft)
  const commandOnly = split.command !== '' && split.body === ''
  const blocked = split.body === ''
  const state = sessionId !== undefined ? storeFor(sessionId) : null
  const busy = state !== null && state.phase === 'busy'
  const actions = props.inputActions !== undefined ? props.inputActions : (state !== null ? state.actions : null)

  // Keep the store's action face fresh so Revert/Retry can write the draft.
  if (state !== null && props.inputActions !== undefined && state.actions !== props.inputActions) {
    state.actions = props.inputActions
  }

  const onClick = React.useCallback(() => {
    if (sessionId === undefined || actions === null) return
    const current = storeFor(sessionId)
    if (current.phase === 'busy') {
      if (current.controller !== null) current.controller.abort()
      return
    }
    runImprove(sessionId, draft, actions, t)
  }, [sessionId, actions, draft, t])

  const title = busy
    ? t('buttonTitleBusy')
    : commandOnly ? t('commandOnlyTitle') : split.command !== '' ? t('buttonTitleCommand') : t('buttonTitle')

  const isDisabled = !busy && (blocked || actions === null)

  // Refined = the composer still holds exactly the text we wrote. Editing or sending
  // the draft changes it, which returns the chip to the star with no extra bookkeeping.
  const refined = state !== null && !busy && state.phase === 'done' && state.enhanced !== '' && draft === state.enhanced

  const onRevert = React.useCallback(() => {
    if (sessionId === undefined) return
    const current = storeFor(sessionId)
    const backup = current.backup
    clear(sessionId)
    if (actions !== null) actions.setDraft(backup)
  }, [sessionId, actions])

  // Retry regenerates from the ORIGINAL draft (the Revert target), not from the
  // current refined text, so repeated retries never compound rewrites.
  const onRetry = React.useCallback(() => {
    if (sessionId === undefined || actions === null) return
    runImprove(sessionId, storeFor(sessionId).backup, actions, t)
  }, [sessionId, actions, t])

  if (refined) {
    // After a refine the button itself becomes the Revert | Retry capsule: the same
    // plate, two halves split by the hairline divider.
    return React.createElement('div', { className: 'dip-root', 'data-refined': 'true', role: 'group' },
      React.createElement('button', { type: 'button', className: 'dip-revert', title: t('revertTitle'), onMouseDown: keepComposerFocus, onClick: onRevert }, CapsuleIcon('revert'), t('revert')),
      React.createElement('span', { className: 'dip-divider', 'aria-hidden': 'true' }),
      React.createElement('button', { type: 'button', className: 'dip-retry', title: t('retryTitle'), onMouseDown: keepComposerFocus, onClick: onRetry }, CapsuleIcon('retry'), t('retry')),
    )
  }

  // Single purpose: click improves (or cancels while busy). The improvement mode is not
  // switched here; it is to move to the settings page (user decision).
  return React.createElement('div', {
    className: 'dip-root',
    'data-busy': busy ? 'true' : 'false',
  },
  React.createElement('button', {
    type: 'button',
    className: 'dip-btn',
    onMouseDown: keepComposerFocus,
    disabled: isDisabled,
    'aria-label': t('buttonAria'),
    title,
    onClick,
  },
  Sparkle(),
  ),
  )
}

/** Human-readable certificate: "保真 12/12 · 1.4x · 2.1s". */
function certificate(meta: Meta, t: TFn): string {
  const parts: string[] = []
  if (meta.anchors.total > 0) {
    parts.push(t('fidelity') + ' ' + String(meta.anchors.kept) + '/' + String(meta.anchors.total))
  }
  parts.push(meta.ratioLabel)
  parts.push((Math.round(meta.elapsedMs / 100) / 10).toFixed(1) + 's')
  if (meta.contextUsed !== 'none') parts.push(t('contextTag'))
  return parts.join(' \u00b7 ')
}

/** Exit duration of the status bubble; must match `dip-bar-out` in styles.ts. */
const BUBBLE_EXIT_MS = 160

/** What the status bubble shows; null when it should be hidden. */
interface Bubble { kind: 'done' | 'error'; text: string }

function sameBubble(a: Bubble | null, b: Bubble | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.text === b.text)
}

function bubbleFor(state: ReturnType<typeof storeFor> | null, phase: string, hidden: boolean, t: TFn): Bubble | null {
  if (state === null || phase === 'idle' || phase === 'busy' || hidden) return null
  if (phase === 'error') return { kind: 'error', text: state.error !== null ? state.error : t('err_UNKNOWN') }
  const meta = state.meta
  const note = meta !== null && meta.note !== '' ? t('preserved') + ' ' + meta.note : ''
  return { kind: 'done', text: t('done') + (meta !== null ? ' \u00b7 ' + certificate(meta, t) : '') + (note !== '' ? ' \u00b7 ' + note : '') }
}

/**
 * Status bar, rendered above the composer card. Reads the store directly,
 * so it needs no slot props beyond the session id.
 */
export function StatusBar(props: { sessionId?: string; t: TFn }): React.ReactElement | null {
  const { sessionId, t } = props
  useSessionState(sessionId)
  const state = sessionId !== undefined ? storeFor(sessionId) : null
  const phase = state !== null ? state.phase : 'idle'
  const token = state !== null ? [state.enhanced.length, state.error ?? '', state.meta !== null ? state.meta.elapsedMs : 0].join(':') : ''
  const [hiddenToken, setHiddenToken] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (sessionId === undefined) return undefined
    if (phase !== 'done' && phase !== 'error') return undefined
    const ms = phase === 'done' ? 8000 : 12000
    // A finished refine only hides the bar: clearing the store would drop the backup the
    // composer capsule needs for Revert/Retry until the draft is edited or sent.
    const timer = window.setTimeout(() => {
      if (phase === 'done') setHiddenToken(token)
      else clear(sessionId)
    }, ms)
    return () => { window.clearTimeout(timer) }
  }, [sessionId, phase, token])

  const bubble = bubbleFor(state, phase, phase === 'done' && hiddenToken === token, t)

  // Keep the last bubble mounted briefly after it is hidden so it can slide down and fade
  // out; React would otherwise remove it at once. Adjusting state during render is React's
  // documented way to react to a prop/store change without an extra committed frame.
  const [shown, setShown] = React.useState<Bubble | null>(null)
  const [leaving, setLeaving] = React.useState<Bubble | null>(null)
  if (!sameBubble(bubble, shown)) {
    setLeaving(bubble === null ? shown : null)
    setShown(bubble)
  }

  React.useEffect(() => {
    if (leaving === null) return undefined
    // A timer rather than animationend: with reduced motion the animation never runs.
    const timer = window.setTimeout(() => { setLeaving(null) }, BUBBLE_EXIT_MS)
    return () => { window.clearTimeout(timer) }
  }, [leaving])

  const visible = bubble ?? leaving
  if (visible === null) return null
  return React.createElement('div', {
    className: 'dip-bar',
    'data-kind': visible.kind,
    'data-state': bubble === null ? 'leaving' : 'entering',
  }, React.createElement('span', { className: 'dip-bar-text' }, visible.text))

}

