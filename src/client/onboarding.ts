/**
 * The first-use window's state: whether it is open, and this browser's record that it was shown.
 *
 * It opens once: the first time the composer star appears while its slide can switch modes (a
 * window teaching a gesture that cannot work would mislead). Showing it is recorded in
 * `localStorage` at once, so no later page load opens it again, even when it was never dismissed.
 * Without storage it never opens: the showing could not be recorded, and it would return on
 * every load.
 *
 * @module dsh-smart-prompt/client/onboarding
 */

import React from 'react'

/** `localStorage` key recording that the window was shown; only its presence counts. */
export const ONBOARDING_SHOWN_KEY = 'dsh-smart-prompt.onboarding-shown'
/** Value written under {@link ONBOARDING_SHOWN_KEY}. */
const SHOWN_VALUE = '1'

/** `undecided` until the star first appears with the slide available; then open or closed for this page load. */
type Phase = 'undecided' | 'open' | 'closed'

let phase: Phase = 'undecided'
const listeners = new Set<() => void>()

function setPhase(next: Phase): void {
  phase = next
  for (const listener of listeners) {
    try { listener() } catch { /* one bad subscriber must not stop the rest */ }
  }
}

/** Record the first showing; false when it was recorded before or cannot be recorded. */
function recordFirstShowing(): boolean {
  try {
    const storage = window.localStorage
    if (storage.getItem(ONBOARDING_SHOWN_KEY) !== null) return false
    storage.setItem(ONBOARDING_SHOWN_KEY, SHOWN_VALUE)
    return true
  } catch {
    return false
  }
}

/** Open the window if this browser never showed it. Call once the slide can switch modes; later calls do nothing. */
export function claimOnboarding(): void {
  if (phase === 'undecided') setPhase(recordFirstShowing() ? 'open' : 'closed')
}

/** Close the window for the rest of this page load. */
export function dismissOnboarding(): void {
  if (phase === 'open') setPhase('closed')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function isOpen(): boolean {
  return phase === 'open'
}

/** Whether the window is open; re-renders when that changes. */
export function useOnboardingOpen(): boolean {
  return React.useSyncExternalStore(subscribe, isOpen, isOpen)
}
