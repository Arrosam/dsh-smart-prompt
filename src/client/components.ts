/**
 * The visible pieces: the composer button (star, or Revert | Retry after a refine), the
 * status bar, and the follow-up panel that takes the composer seat while questions are open.
 *
 * @module dsh-smart-prompt/client/components
 */

import React from 'react'
import { splitCommand } from '../command.js'
import { cancelRefine, runImprove } from './refine.js'
import { clear, storeFor, subscribe, type AttachmentSerializer, type InputActionsFace, type Meta } from './store.js'

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
  /** Serializes draft attachments; absent on hosts without the conversation service. */
  serializeAttachments?: AttachmentSerializer
  t: TFn
}

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

/**
 * Stroke paths (12x12 grid) for the small line glyphs: a back-arrow for Revert, a circular
 * arrow for Retry, a cross for closing the follow-up panel.
 */
const STROKE_ICON_PATH = {
  revert: 'M4.6 2.2L1.8 5L4.6 7.8M1.8 5H7.4A3 3 0 0 1 7.4 11H5.2',
  retry: 'M10.2 6A4.2 4.2 0 1 1 8.6 2.7M8.9 0.9L9.2 3.2L6.9 3.6',
  close: 'M3 3L9 9M9 3L3 9',
} as const

/** Small stroke glyph that inherits the label colour (capsule halves, panel close). */
export function StrokeIcon(className: string, kind: keyof typeof STROKE_ICON_PATH): React.ReactElement {
  return React.createElement('svg', { className, viewBox: '0 0 12 12', width: '12', height: '12', 'aria-hidden': 'true', focusable: 'false' },
    React.createElement('path', { d: STROKE_ICON_PATH[kind], fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

/**
 * One labelled capsule button (Revert, Retry, or the failure bubble's Retry). Every one
 * keeps the composer's focus on press.
 */
function capsuleButton(className: string, icon: keyof typeof STROKE_ICON_PATH, title: string, label: string, onClick: (event: React.MouseEvent) => void): React.ReactElement {
  return React.createElement('button', { type: 'button', className, title, onMouseDown: keepComposerFocus, onClick }, StrokeIcon('dip-capsule-icon', icon), label)
}

/** Four-point sparkle outline on a 16x16 grid, centred on (8, 8); the Stardea glyph reuses it. */
export const SPARKLE_PATH = 'M8 1.2l1.35 3.9a2 2 0 001.25 1.25l3.9 1.35-3.9 1.35a2 2 0 00-1.25 1.25L8 14.8l-1.35-3.9a2 2 0 00-1.25-1.25L1.5 8.3l3.9-1.35A2 2 0 006.65 5.7L8 1.2z'

/** Four-point sparkle, filled with the text colour so it follows the host theme. */
function Sparkle(): React.ReactElement {
  return React.createElement('svg', { className: 'dip-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
    React.createElement('path', { d: SPARKLE_PATH, fill: 'currentColor' }),
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

/** Stable empty list: a selector must not return a fresh array on every read. */
const NO_ATTACHMENTS: readonly string[] = Object.freeze([])

/** Read the composer's ordered attachment ids (empty on hosts whose input state has none). */
function readAttachmentIds(props: SeatProps): readonly string[] {
  if (typeof props.useInput !== 'function') return NO_ATTACHMENTS
  const value = props.useInput((state: unknown) => {
    const ids = (state as { attachmentIds?: unknown } | null)?.attachmentIds
    return Array.isArray(ids) ? ids : NO_ATTACHMENTS
  })
  return Array.isArray(value) ? value as readonly string[] : NO_ATTACHMENTS
}

/** Force a re-render whenever this session's store entry changes. */
export function useSessionState(sessionId: string | undefined): number {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    if (sessionId === undefined) return undefined
    return subscribe(sessionId, () => { setVersion((v: number) => v + 1) })
  }, [sessionId])
  return version
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
  const attachmentIds = readAttachmentIds(props)
  // A leading slash token belongs to the harness; only the text after it is ours.
  // A command with no body therefore has nothing to enhance — but a command WITH a
  // body is exactly the case worth enhancing.
  const split = splitCommand(draft)
  const commandOnly = split.command !== '' && split.body === ''
  const blocked = split.body === ''
  const state = sessionId !== undefined ? storeFor(sessionId) : null
  const busy = state !== null && state.phase === 'busy'
  const actions = props.inputActions !== undefined ? props.inputActions : (state !== null ? state.actions : null)

  // Keep the store's composer faces fresh so Revert/Retry can write the draft and every
  // refine sends the attachments the composer holds now.
  if (state !== null) {
    if (props.inputActions !== undefined && state.actions !== props.inputActions) state.actions = props.inputActions
    state.attachmentIds = attachmentIds
    if (props.serializeAttachments !== undefined) state.serialize = props.serializeAttachments
  }

  const onClick = React.useCallback(() => {
    if (sessionId === undefined || actions === null) return
    if (storeFor(sessionId).phase === 'busy') {
      cancelRefine(sessionId, t)
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
      capsuleButton('dip-revert', 'revert', t('revertTitle'), t('revert'), onRevert),
      React.createElement('span', { className: 'dip-divider', 'aria-hidden': 'true' }),
      capsuleButton('dip-retry', 'retry', t('retryTitle'), t('retry'), onRetry),
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

/** Token use as `input(cached) - output`, e.g. `1200(3400) - 560`, in plain integers. */
function tokenReport(usage: NonNullable<Meta['usage']>): string {
  return String(usage.input) + '(' + String(usage.cached) + ') - ' + String(usage.output)
}

/** Human-readable certificate: "保真 12/12 · 1.4x · 2.1s · tokens 1200(3400) - 560". */
function certificate(meta: Meta, t: TFn): string {
  const parts: string[] = []
  if (meta.anchors.total > 0) {
    parts.push(t('fidelity') + ' ' + String(meta.anchors.kept) + '/' + String(meta.anchors.total))
  }
  parts.push(meta.ratioLabel)
  parts.push((Math.round(meta.elapsedMs / 100) / 10).toFixed(1) + 's')
  if (meta.contextUsed !== 'none') parts.push(t('contextTag'))
  if (meta.questions !== undefined && meta.questions.answered > 0) {
    parts.push(t('answeredTag') + ' ' + String(meta.questions.answered) + '/' + String(meta.questions.asked))
  }
  if (meta.usage !== undefined) parts.push(t('tokens') + ' ' + tokenReport(meta.usage))
  return parts.join(' \u00b7 ')
}

/** Exit duration of the status bubble; must match `dip-bar-out` in styles.ts. */
const BUBBLE_EXIT_MS = 160
/** How long a success bubble stays before it hides. */
const BUBBLE_DONE_MS = 8000
/** How long a failure bubble stays before the session returns to idle. */
const BUBBLE_ERROR_MS = 12000

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
    const ms = phase === 'done' ? BUBBLE_DONE_MS : BUBBLE_ERROR_MS
    // A finished refine only hides the bar: clearing the store would drop the backup the
    // composer capsule needs for Revert/Retry until the draft is edited or sent.
    const timer = window.setTimeout(() => {
      if (phase === 'done') setHiddenToken(token)
      else clear(sessionId)
    }, ms)
    return () => { window.clearTimeout(timer) }
  }, [sessionId, phase, token])

  // Each refine's success bubble shows once. The bar that first displays it claims it in the
  // store; a bar that later finds it claimed by someone else stays hidden. That covers both
  // ways the host can bring a session back: remounting the bar, or re-rendering the same bar
  // with another session id and then this one — hence a claim token per (instance, session).
  const claim = React.useRef<{ sessionId: string | undefined; token: object }>({ sessionId, token: {} })
  if (claim.current.sessionId !== sessionId) claim.current = { sessionId, token: {} }
  const self = claim.current.token
  const claimable = state !== null && phase === 'done' && state.doneBubbleOwner === null
  React.useEffect(() => {
    // Claimed after commit so a discarded render (StrictMode) cannot claim it unseen.
    if (claimable && state !== null) state.doneBubbleOwner = self
  }, [claimable, state, self])
  const doneHidden = hiddenToken === token || (state !== null && state.doneBubbleOwner !== null && state.doneBubbleOwner !== self)
  const bubble = bubbleFor(state, phase, phase === 'done' && doneHidden, t)

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

  // Retry resends the draft the failed request started from (kept as `backup`); the host
  // still holds any follow-up answers given for it, so the follow-up panel is not shown again.
  // The overlay anchor sits inside the composer card, whose own click handler (workspace
  // trigger) must not also fire.
  const onRetry = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (sessionId === undefined) return
    const current = storeFor(sessionId)
    if (current.phase !== 'error' || current.actions === null) return
    runImprove(sessionId, current.backup, current.actions, t)
  }, [sessionId, t])

  const visible = bubble ?? leaving
  if (visible === null) return null
  const canRetry = visible.kind === 'error' && state !== null && state.actions !== null && splitCommand(state.backup).body !== ''
  return React.createElement('div', {
    className: 'dip-bar',
    'data-kind': visible.kind,
    'data-state': bubble === null ? 'leaving' : 'entering',
  },
  React.createElement('span', { className: 'dip-bar-text' }, visible.text),
  canRetry
    ? capsuleButton('dip-bar-retry', 'retry', t('retryFailedTitle'), t('retry'), onRetry)
    : null,
  )
}

