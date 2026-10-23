/**
 * The composer star's mode switch: the active improvement mode, and the press-and-slide on the
 * star that picks it.
 *
 * The mode has one store: the host Config field `defaultMode` of this plugin's entry, the field
 * the settings page edits. The star reads and writes it through the shared `configForms` entry
 * form the settings section is built over, so a slide and a settings-page Save change the same
 * document, and each side sees the other's change through that form's snapshot. The one extra
 * value kept here is the mode a slide has just written and the host has not confirmed yet: the
 * star shows it at once, and the next slide starts from it. It goes when that write settles.
 *
 * @module dsh-smart-prompt/client/mode
 */

import React from 'react'
import { DEFAULT_MODE, MODE_VALUES, isOneOf, type Mode } from '../settings-fields.js'
import { asRecord } from '../values.js'
import { FIELD } from './settings.js'

/**
 * The modes as the star lays them out, left to right (user decision). Not MODE_VALUES, which is
 * the settings page's display order with the default first.
 */
export const MODE_ORDER: readonly Mode[] = Object.freeze<Mode[]>(['detailed', 'standard', 'light'])

/**
 * The press-and-slide on the star, and the mode bar it opens. The bar's geometry is shared with
 * styles.ts, so where the bar is placed and how far a slide moves the selection match what is drawn.
 */
export const SLIDE = Object.freeze({
  /** How long a still press on the star takes to open the mode bar, in ms (user decision). */
  holdMs: 300,
  /**
   * Sideways travel, in CSS pixels, that opens the bar without waiting for the hold: well above
   * the jitter of an ordinary click, so a click never opens it.
   */
  startPx: 16,
  /**
   * Width of one mode's segment on the bar, in CSS pixels, and so the slide that moves the
   * selection by one mode: room for the longest mode name, and a comfortable slide per mode.
   */
  segmentPx: 88,
  /** Height of the bar, in CSS pixels. */
  heightPx: 40,
  /** The bar's frame around its segments (its border included), in CSS pixels. */
  insetPx: 4,
  /** The bar's border width, in CSS pixels; part of {@link SLIDE}.insetPx. */
  borderPx: 1,
  /** Least gap between the bar and the left or right edge of the window, in CSS pixels. */
  edgePx: 8,
  /** Gap between the bar's bottom edge and the star's top edge, in CSS pixels. */
  gapPx: 8,
})

/** The bar's full width, in CSS pixels: the segments and the padding on both sides. */
export const SLIDE_BAR_WIDTH_PX = MODE_ORDER.length * SLIDE.segmentPx + 2 * SLIDE.insetPx

/** `PointerEvent.button` of the main button (left mouse button, touch or pen contact). */
const MAIN_BUTTON = 0

/** `KeyboardEvent.key` that closes the open bar without changing the mode. */
const CANCEL_KEY = 'Escape'

/** `ConfigFormSnapshot.status` of an entry form that holds an accepted value. */
const FORM_READY = 'ready'

/**
 * Whether a press has travelled far enough sideways to be a slide rather than a click.
 *
 * @param dx - horizontal travel since the press, in CSS pixels (negative = left).
 * @param dy - vertical travel since the press, in CSS pixels.
 * @returns true from {@link SLIDE}.startPx across, when that is more than the travel up or down.
 */
function isSlide(dx: number, dy: number): boolean {
  const across = Math.abs(dx)
  return across >= SLIDE.startPx && across > Math.abs(dy)
}

/**
 * The mode a slide selects. The bar opens with the starting mode's segment under the press, so
 * the selection moves one mode for each segment of travel, from half a segment on, the same
 * distance either way (`Math.round` would round -0.5 and 0.5 differently).
 *
 * @param start - the mode the star showed when the press began.
 * @param dx - horizontal travel since the press, in CSS pixels (negative = left).
 * @returns the selected mode; travel past either end selects that end (no wrap-around).
 */
export function slideMode(start: Mode, dx: number): Mode {
  const steps = Math.sign(dx) * Math.floor(Math.abs(dx) / SLIDE.segmentPx + 0.5)
  const index = Math.min(Math.max(MODE_ORDER.indexOf(start) + steps, 0), MODE_ORDER.length - 1)
  return MODE_ORDER[index] ?? start
}

/** The slice of a host `ConfigForm` (`configForms.get(entryId)`, ui-settings) the switch uses. */
interface ModeForm {
  getSnapshot(): { readonly status?: unknown; readonly value?: unknown; readonly writable?: unknown }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}

function isModeForm(value: unknown): value is ModeForm {
  const form = value as Partial<Record<keyof ModeForm, unknown>> | null | undefined
  return typeof form?.getSnapshot === 'function' && typeof form.subscribe === 'function' && typeof form.set === 'function'
}

/** What the star shows, and whether a slide may change it. */
export interface ModeState {
  readonly mode: Mode
  /** The host serves this plugin's settings and accepts writes; otherwise a slide changes nothing. */
  readonly switchable: boolean
}

/** Without the host form the star shows the default mode and cannot switch. */
const NO_FORM: ModeState = Object.freeze({ mode: DEFAULT_MODE, switchable: false })

let form: ModeForm | null = null
/** The mode the latest slide wrote, until that write settles; `token` tells that write apart. */
let pending: { readonly mode: Mode; readonly token: object } | null = null
let state: ModeState = NO_FORM
const listeners = new Set<() => void>()

/** Recompute {@link state} from the form and the pending write; notify only when it changed. */
function refresh(): void {
  let next = NO_FORM
  if (form !== null) {
    const snapshot = form.getSnapshot()
    const saved = asRecord(snapshot.value)[FIELD.mode]
    next = {
      mode: pending !== null ? pending.mode : isOneOf(saved, MODE_VALUES) ? saved : DEFAULT_MODE,
      switchable: snapshot.status === FORM_READY && snapshot.writable === true,
    }
  }
  if (next.mode === state.mode && next.switchable === state.switchable) return
  state = next
  for (const listener of listeners) {
    try { listener() } catch { /* one bad subscriber must not stop the rest */ }
  }
}

/**
 * Hand the switch this plugin's host entry form.
 *
 * @param candidate - `configForms.get(ENTRY_ID)`; anything without the form's methods is ignored.
 * @returns undoes it: the star falls back to the default mode and stops switching.
 */
export function provideModeForm(candidate: unknown): () => void {
  if (!isModeForm(candidate)) return () => {}
  const own = candidate
  form = own
  pending = null
  const off = own.subscribe(refresh)
  refresh()
  return () => {
    off()
    if (form !== own) return
    form = null
    pending = null
    refresh()
  }
}

/**
 * Save a mode the slide selected; the star shows it at once. Nothing happens while switching is
 * unavailable or when it is the mode shown already.
 *
 * @param next - the mode to save.
 */
function selectMode(next: Mode): void {
  const target = form
  if (target === null || !state.switchable || next === state.mode) return
  const token = {}
  pending = { mode: next, token }
  refresh()
  // Only the latest write may end the pending mode: an earlier one can settle before the host has
  // confirmed the newer value. A refused or failed write leaves the snapshot as it was, so the
  // star shows the saved mode again.
  const settle = (): void => {
    if (pending?.token !== token) return
    pending = null
    refresh()
  }
  try {
    // The settings page's field, entry form and host write path: the host folds the write into the
    // shared settings mirror, so the settings page shows the new mode as well.
    void target.set(FIELD.mode, next).then(settle, settle)
  } catch {
    settle()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function currentState(): ModeState {
  return state
}

/** The active mode and whether a slide can switch it; re-renders when either changes. */
export function useModeState(): ModeState {
  return React.useSyncExternalStore(subscribe, currentState, currentState)
}

/** The open mode bar: what it selects, and where it floats in the window. */
export interface SlideBarView {
  /** The mode the star showed when the press began; the bar opens with it selected. */
  readonly start: Mode
  readonly selected: Mode
  /** Distance of the bar's left edge from the window's left edge, in CSS pixels. */
  readonly left: number
  /** Distance of the bar's bottom edge from the window's bottom edge, in CSS pixels. */
  readonly bottom: number
  /** The press point's distance from the bar's left edge, in CSS pixels: the bar grows out of it. */
  readonly originX: number
}

/**
 * Where the bar floats: just above the star, with the starting mode's segment centred under the
 * press, and kept inside the window. It is positioned in the window rather than in the composer,
 * so it covers the page without moving anything.
 *
 * @param start - the mode the star showed when the press began.
 * @param pressX - the press point's distance from the window's left edge, in CSS pixels.
 * @param starTop - the star's top edge, from the window's top edge, in CSS pixels.
 */
function placeBar(start: Mode, pressX: number, starTop: number): Pick<SlideBarView, 'left' | 'bottom' | 'originX'> {
  const width = typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 0
  const height = typeof window !== 'undefined' && typeof window.innerHeight === 'number' ? window.innerHeight : 0
  const centred = pressX - SLIDE.insetPx - (MODE_ORDER.indexOf(start) + 0.5) * SLIDE.segmentPx
  // In a window narrower than the bar, the left edge wins: the bar starts at the left margin.
  const left = Math.max(SLIDE.edgePx, Math.min(centred, width - SLIDE_BAR_WIDTH_PX - SLIDE.edgePx))
  return { left, bottom: height - starTop + SLIDE.gapPx, originX: pressX - left }
}

/** A press on the star that may become a slide. */
interface Press {
  readonly pointerId: number
  readonly x: number
  readonly y: number
  readonly start: Mode
  readonly starTop: number
  /** The star's capsule, which takes the pointer once the bar opens. */
  readonly element: HTMLElement
}

/** Pointer handlers of the star's capsule, the click filter that goes with them, and the open bar. */
export interface ModeSlide {
  readonly handlers: {
    readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
    readonly onPointerMove: (event: React.PointerEvent<HTMLElement>) => void
    readonly onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void
    readonly onPointerUp: (event: React.PointerEvent<HTMLElement>) => void
    readonly onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void
    readonly onContextMenu: (event: React.MouseEvent<HTMLElement>) => void
  }
  /**
   * Whether a click on the star is the tail of a slide and must not improve. True at most once per
   * slide, and only for a pointer click: a keyboard click (`detail` 0) always improves.
   */
  readonly endsSlide: (event: React.MouseEvent) => boolean
  /** The open bar; null while it is closed. */
  readonly bar: SlideBarView | null
}

/**
 * The star's press-and-slide. A press with the main button opens the mode bar once it is held for
 * {@link SLIDE}.holdMs or slides {@link SLIDE}.startPx sideways; sliding then moves the selection
 * one mode per segment, and letting go saves the selected mode. Escape or a cancelled pointer
 * closes the bar and keeps the mode. A short press without a slide stays an ordinary click.
 *
 * While switching is unavailable nothing opens, so the star behaves exactly as it did before it
 * could switch: nothing on screen mentions the slide then, and a slide on it must not silently
 * swallow the click.
 */
export function useModeSlide(): ModeSlide {
  const press = React.useRef<Press | null>(null)
  /** Horizontal travel of the press at its latest move: where a hold opens the selection. */
  const travel = React.useRef(0)
  const holdTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Mirrors `bar !== null` for the handlers, which are made once and must not read stale state. */
  const opened = React.useRef(false)
  const swallow = React.useRef(false)
  const [bar, setBar] = React.useState<SlideBarView | null>(null)

  const fixed = React.useMemo(() => {
    const stopHold = (): void => {
      if (holdTimer.current === null) return
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    const close = (): void => {
      stopHold()
      opened.current = false
      setBar(null)
    }
    // The capsule keeps the pointer while the bar is open, so the slide goes on over the page and
    // its release still counts. Not at press time: a captured pointer moves the click to the
    // capsule, and an ordinary click would no longer reach the star.
    const capture = (element: HTMLElement, pointerId: number): void => {
      try { element.setPointerCapture(pointerId) } catch { /* the pointer is no longer pressed */ }
    }
    const open = (): void => {
      stopHold()
      const current = press.current
      if (current === null || opened.current || !state.switchable) return
      opened.current = true
      capture(current.element, current.pointerId)
      setBar({ start: current.start, selected: slideMode(current.start, travel.current), ...placeBar(current.start, current.x, current.starTop) })
    }
    const ownPointer = (event: React.PointerEvent<HTMLElement>): Press | null => {
      const current = press.current
      return current !== null && event.pointerId === current.pointerId ? current : null
    }
    return {
      handlers: {
        onPointerDown: (event: React.PointerEvent<HTMLElement>): void => {
          swallow.current = false
          close()
          if (!event.isPrimary || event.button !== MAIN_BUTTON) {
            press.current = null
            return
          }
          const element = event.currentTarget
          const top = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect().top : event.clientY
          press.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: state.mode, starTop: top, element }
          travel.current = 0
          if (state.switchable) holdTimer.current = setTimeout(open, SLIDE.holdMs)
        },
        onPointerMove: (event: React.PointerEvent<HTMLElement>): void => {
          const current = ownPointer(event)
          if (current === null) return
          const dx = event.clientX - current.x
          travel.current = dx
          if (!opened.current) {
            if (isSlide(dx, event.clientY - current.y)) open()
            return
          }
          const selected = slideMode(current.start, dx)
          setBar((view) => view === null || view.selected === selected ? view : { ...view, selected })
        },
        // A press that leaves the star before it slides far enough to open the bar keeps its moves.
        onPointerLeave: (event: React.PointerEvent<HTMLElement>): void => {
          const current = ownPointer(event)
          if (current !== null && state.switchable) capture(current.element, current.pointerId)
        },
        onPointerUp: (event: React.PointerEvent<HTMLElement>): void => {
          const current = ownPointer(event)
          if (current === null) return
          press.current = null
          const wasOpen = opened.current
          close()
          const dx = event.clientX - current.x
          // A quick slide can end before any move opened the bar: the release still selects.
          if (!wasOpen && !(state.switchable && isSlide(dx, event.clientY - current.y))) return
          swallow.current = true
          const selected = slideMode(current.start, dx)
          if (selected !== current.start) selectMode(selected)
        },
        onPointerCancel: (event: React.PointerEvent<HTMLElement>): void => {
          if (ownPointer(event) === null) return
          press.current = null
          close()
        },
        // A long press would otherwise open the browser's context menu (or the touch callout).
        onContextMenu: (event: React.MouseEvent<HTMLElement>): void => {
          if (press.current !== null) event.preventDefault()
        },
      },
      endsSlide: (event: React.MouseEvent): boolean => {
        if (!swallow.current || event.detail === 0) return false
        swallow.current = false
        return true
      },
      /** Escape: close the bar, keep the mode; the release that follows does nothing. */
      cancel: (): void => {
        press.current = null
        swallow.current = true
        close()
      },
      stopHold,
    }
  }, [])

  const isOpen = bar !== null
  React.useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    // Capture phase, and stopped there: the composer must not also act on this Escape.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== CANCEL_KEY) return
      event.preventDefault()
      event.stopPropagation()
      fixed.cancel()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [isOpen, fixed])
  React.useEffect(() => fixed.stopHold, [fixed])

  return { handlers: fixed.handlers, endsSlide: fixed.endsSlide, bar }
}
