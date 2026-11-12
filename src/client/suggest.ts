/**
 * Next-step suggestions for an empty composer, as store transitions (the popover, the composer
 * star and the automatic run drive them through these functions only).
 *
 * Behaviour (user decisions):
 * - A click on the star with an empty composer opens the popover. It shows the suggestions
 *   already made for this point of the conversation without asking the model again; only when
 *   none exist yet are they requested.
 * - A click while the popover is open asks for two more, added as a new row below the others.
 * - Picking a suggestion writes it into the composer and keeps the popover open, so another can
 *   replace it. Closing the popover keeps the suggestions for the next click.
 * - With auto-suggest on, suggestions are generated after every agent reply, whether or not the
 *   user is looking, and the popover opens on its own while the composer is empty, unless the
 *   user already closed it for this point.
 *
 * @module dsh-smart-prompt/client/suggest
 */

import type { TFn } from './components.js'
import { ENDPOINT, postJson, type ApiResponse } from './api.js'
import { failureText, transportFailureText } from './refine.js'
import { notify, storeFor, type InputActionsFace, type SuggestState } from './store.js'

/** What a `/suggest` request asks for; must match the host's `SUGGEST_REQUESTS`. */
const SUGGEST_REQUEST = Object.freeze({
  /** The ones made for this point of the conversation, generating them only when there are none. */
  get: 'get',
  /** New suggestions, beyond the ones made. */
  more: 'more',
})
type SuggestRequest = typeof SUGGEST_REQUEST[keyof typeof SUGGEST_REQUEST]

/** The well-formed suggestions of a reply, or null when it carries none. */
function parseReply(data: ApiResponse): { key: string; suggestions: string[] } | null {
  if (data.ok !== true || !Array.isArray(data.suggestions)) return null
  const suggestions = data.suggestions.filter((item): item is string => typeof item === 'string' && item !== '')
  return { key: typeof data.key === 'string' ? data.key : '', suggestions }
}

/**
 * Send one `/suggest` request and apply its reply. A reply naming a new point of the
 * conversation replaces the suggestions; a failure keeps them and leaves a note.
 *
 * @param sessionId - the session.
 * @param request - what to ask for.
 * @param t - localized copy lookup.
 */
async function send(sessionId: string, request: SuggestRequest, t: TFn): Promise<void> {
  const state = storeFor(sessionId).suggest
  state.controller?.abort()
  const controller = new AbortController()
  state.controller = controller
  state.generating = request === SUGGEST_REQUEST.more || state.suggestions.length === 0
  state.error = null
  notify(sessionId)
  let error: string | null = null
  try {
    const data = await postJson(ENDPOINT.suggest, { sessionId, request }, controller.signal)
    const reply = parseReply(data)
    if (reply === null) error = failureText(data, t)
    else apply(state, reply.key, reply.suggestions)
  } catch (failure) {
    if (controller.signal.aborted) return
    error = transportFailureText(failure, t)
  }
  if (state.controller !== controller) return
  state.controller = null
  state.generating = false
  state.error = error
  notify(sessionId)
}

function apply(state: SuggestState, key: string, suggestions: readonly string[]): void {
  if (key !== state.key) {
    state.key = key
    state.dismissedKey = ''
  }
  state.suggestions = suggestions
}

/**
 * The star was clicked with an empty composer. Opens the popover with the suggestions already
 * made; asks for some only when there are none. With the popover open, asks for more.
 *
 * @param sessionId - the session.
 * @param t - localized copy lookup.
 */
export function clickSuggest(sessionId: string, t: TFn): void {
  const state = storeFor(sessionId).suggest
  if (state.controller !== null && state.open) return
  if (state.open) {
    void send(sessionId, SUGGEST_REQUEST.more, t)
    return
  }
  state.open = true
  state.error = null
  notify(sessionId)
  // The host answers with the made ones at once, or generates them; either way the reply also
  // tells whether the conversation moved on since they were made.
  void send(sessionId, SUGGEST_REQUEST.get, t)
}

/** Close the popover; the suggestions stay for the next click. */
export function dismissSuggest(sessionId: string): void {
  const state = storeFor(sessionId).suggest
  if (!state.open) return
  state.open = false
  state.dismissedKey = state.key
  state.controller?.abort()
  state.controller = null
  state.generating = false
  state.error = null
  notify(sessionId)
}

/**
 * Put one suggestion into the composer. The popover stays open (user decision) and closes on its
 * own once the composer is no longer one of the suggestions (see {@link closeOnEdit}).
 *
 * @param text - the suggestion.
 * @param actions - the composer face.
 */
export function pickSuggestion(text: string, actions: InputActionsFace | null): void {
  if (actions === null) return
  actions.setDraft(text)
}

/**
 * Keep the popover in step with the composer: it belongs to an empty composer, so typing (or
 * sending) closes it, while a draft that is one of the suggestions (just picked) keeps it open.
 *
 * @param sessionId - the session.
 * @param draft - the composer's current text.
 */
export function closeOnEdit(sessionId: string, draft: string): void {
  const state = storeFor(sessionId).suggest
  if (!state.open || draft.trim() === '' || state.suggestions.includes(draft.trim())) return
  dismissSuggest(sessionId)
}

/**
 * Show suggestions made after an agent reply (call only while the auto-suggest default is on): ask the host for
 * them (it generates them once per reply, see the host's NextStepBook) and open the popover for
 * an empty composer, unless the user closed it for this point. Failures stay silent: nobody asked.
 *
 * @param sessionId - the session.
 * @param draft - the composer's current text.
 * @param t - localized copy lookup.
 */
export async function autoSuggest(sessionId: string, draft: string, t: TFn): Promise<void> {
  if (draft.trim() !== '') return
  const state = storeFor(sessionId).suggest
  if (state.controller !== null) return
  await send(sessionId, SUGGEST_REQUEST.get, t)
  const latest = storeFor(sessionId).suggest
  if (!latest.open) latest.error = null
  if (latest.suggestions.length > 0 && latest.dismissedKey !== latest.key && !latest.open) {
    latest.open = true
    notify(sessionId)
  }
}
