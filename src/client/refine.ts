/**
 * The refine flow, as store transitions. A draft goes to the host; the reply either rewrites
 * the composer, fails, or opens the follow-up panel, whose answers continue the same refine.
 * The composer button, the status bubble and the panel all drive refines through these
 * functions, so each step has one implementation.
 *
 * @module dsh-smart-prompt/client/refine
 */

import { splitCommand } from '../command.js'
import type { TFn } from './components.js'
import { ENDPOINT, isAbort, postJson, type AnswerBody, type ApiResponse, type Endpoint } from './api.js'
import { closeAsk, notify, storeFor, type AskNotice, type AskQuestion, type AskRun, type Idea, type InputActionsFace } from './store.js'

/** `kind` of the pending interaction the follow-up panel is published as. */
export const FOLLOW_UP_KIND = 'dsh-smart-prompt-follow-up'

/** The pending interaction that puts the follow-up panel into a session's composer seat. */
export interface FollowUpInteraction {
  readonly kind: typeof FOLLOW_UP_KIND
  /** The host's run id: a new refine gets a new key. */
  readonly key: string
  readonly sessionId: string
}

/** The host's publisher: shows one interaction, returns the function that withdraws it. */
export type FollowUpPublisher = (interaction: FollowUpInteraction, delegate: () => Promise<void>) => () => void

/**
 * Set once the uiSession mount ran. Refines ask for follow-up questions only while it is set:
 * without it the panel could not be shown, and the host would wait for answers forever.
 */
let publisher: FollowUpPublisher | null = null

/**
 * Make follow-up questions possible.
 *
 * @param publish - the host's pending-interaction publisher.
 * @returns undoes it (refines started after that ask no questions).
 */
export function providePublisher(publish: FollowUpPublisher): () => void {
  publisher = publish
  return () => { if (publisher === publish) publisher = null }
}

/**
 * The interaction if it is this plugin's follow-up panel, else null (the composer-chain
 * selector: another domain's interaction leaves the seat to its own entry).
 *
 * @param value - a session's current pending interaction (any domain's).
 */
export function asFollowUp(value: unknown): FollowUpInteraction | null {
  if (typeof value !== 'object' || value === null) return null
  const { kind, key, sessionId } = value as { kind?: unknown; key?: unknown; sessionId?: unknown }
  return kind === FOLLOW_UP_KIND && typeof key === 'string' && typeof sessionId === 'string' ? value as FollowUpInteraction : null
}

/**
 * Localized copy for a failure reply: the copy for its code, else the host's own message,
 * else the generic failure.
 */
function failureText(data: ApiResponse, t: TFn): string {
  const key = 'err_' + (typeof data.code === 'string' ? data.code : 'UNKNOWN')
  const localized = t(key)
  if (localized !== key) return localized
  return typeof data.message === 'string' && data.message !== '' ? data.message : t('err_UNKNOWN')
}

/** Localized copy for a request that never got a reply. */
function transportFailureText(error: unknown, t: TFn): string {
  return isAbort(error) ? t('err_ABORTED') : t('err_UPSTREAM')
}

/** End the refine as failed. The draft is untouched; `backup` keeps the request's draft for Retry. */
function fail(sessionId: string, message: string): void {
  closeAsk(sessionId)
  const latest = storeFor(sessionId)
  latest.phase = 'error'
  latest.error = message
  latest.controller = null
  notify(sessionId)
}

/** The follow-up questions of a reply, or null when it carries none (or a malformed set). */
function parseAsk(value: unknown): { runId: string; questions: { id: string; question: string }[] } | null {
  if (typeof value !== 'object' || value === null) return null
  const { runId, questions } = value as { runId?: unknown; questions?: unknown }
  if (typeof runId !== 'string' || runId === '' || !Array.isArray(questions)) return null
  const valid = questions.flatMap((item) => {
    const question = item as { id?: unknown; question?: unknown } | null
    return typeof question === 'object' && question !== null && typeof question.id === 'string' && typeof question.question === 'string'
      ? [{ id: question.id, question: question.question }]
      : []
  })
  return valid.length > 0 ? { runId, questions: valid } : null
}

/** The well-formed ideas of a `/stardea` reply. */
function parseIdeas(value: readonly unknown[]): Idea[] {
  return value.flatMap((item) => {
    const idea = item as { id?: unknown; text?: unknown; source?: unknown } | null
    return typeof idea === 'object' && idea !== null && typeof idea.id === 'string' && typeof idea.text === 'string' && idea.text !== ''
      ? [{ id: idea.id, text: idea.text, source: typeof idea.source === 'string' ? idea.source : '' }]
      : []
  })
}

/** Tell the host to drop a waiting refine. The panel is gone either way, so the reply is not needed. */
function postCancel(runId: string): Promise<void> {
  return postJson(ENDPOINT.cancel, { runId }).then(() => undefined, () => undefined)
}

/** Cancel the refine whose panel is open: the refine ends as cancelled, the draft untouched. */
function cancelAsk(sessionId: string, t: TFn): Promise<void> {
  const run = storeFor(sessionId).ask
  if (run === null) return Promise.resolve()
  fail(sessionId, t('err_ABORTED'))
  return postCancel(run.runId)
}

/** Show the follow-up panel for a refine the host keeps waiting until it is answered. */
function openAsk(sessionId: string, reply: { runId: string; questions: { id: string; question: string }[] }, actions: InputActionsFace, t: TFn): void {
  const publish = publisher
  if (publish === null) {
    // The seat went away while the request ran (plugin teardown): nothing can answer.
    void postCancel(reply.runId)
    fail(sessionId, t('err_ABORTED'))
    return
  }
  const run: AskRun = {
    runId: reply.runId,
    questions: reply.questions.map(({ id, question }) => ({ id, question, ideas: [], selected: new Set<string>(), custom: '', pending: false, notice: null })),
    actions,
    stardea: new AbortController(),
    unpublish: () => {},
  }
  const state = storeFor(sessionId)
  state.ask = run
  // Nothing is in flight while the panel is open; the busy star cancels through /cancel instead.
  state.controller = null
  try {
    // The panel cannot be handed to another UI, so a host teardown that takes it away cancels the refine.
    run.unpublish = publish({ kind: FOLLOW_UP_KIND, key: run.runId, sessionId }, () => (storeFor(sessionId).ask === run ? cancelAsk(sessionId, t) : Promise.resolve()))
  } catch (error) {
    console.error('[dsh-smart-prompt] follow-up panel could not be shown', error)
    void cancelAsk(sessionId, t)
    return
  }
  notify(sessionId)
}

/** Apply one refine reply: `/improve` and `/answer` answer in the same shapes. */
function settle(sessionId: string, data: ApiResponse, actions: InputActionsFace, t: TFn): void {
  if (data.ok === true && typeof data.text === 'string' && data.text !== '') {
    const latest = storeFor(sessionId)
    latest.enhanced = data.text
    latest.meta = data.meta !== undefined ? data.meta : null
    latest.phase = 'done'
    latest.controller = null
    actions.setDraft(data.text)
    notify(sessionId)
    return
  }
  const ask = data.ok === true ? parseAsk(data.ask) : null
  if (ask !== null) openAsk(sessionId, ask, actions, t)
  else fail(sessionId, failureText(data, t))
}

/** Send one refine request and apply its reply; aborting `controller` cancels the refine. */
async function send(sessionId: string, controller: AbortController, endpoint: Endpoint, body: unknown, actions: InputActionsFace, t: TFn): Promise<void> {
  try {
    settle(sessionId, await postJson(endpoint, body, controller.signal), actions, t)
  } catch (error) {
    fail(sessionId, transportFailureText(error, t))
  }
}

/**
 * Send one draft to the host and write the result into the composer.
 *
 * Shared by the composer button and both Retries, so all follow the same state transitions:
 * busy -> done (draft replaced, `backup` keeps `text`), busy -> error (draft untouched), or
 * busy with the follow-up panel open, which continues the refine through {@link submitAsk}.
 * A slash-command draft with no body is ignored.
 *
 * @param sessionId - the session whose composer is rewritten.
 * @param text - the draft to enhance; becomes the Revert target.
 * @param actions - composer actions used to write the result.
 * @param t - localized copy lookup for failure messages.
 */
export function runImprove(sessionId: string, text: string, actions: InputActionsFace, t: TFn): void {
  if (splitCommand(text).body === '') return
  const current = storeFor(sessionId)
  const controller = new AbortController()
  current.controller = controller
  current.phase = 'busy'
  current.error = null
  current.backup = text
  current.meta = null
  current.enhanced = ''
  // A new refine gets its own success bubble.
  current.doneBubbleOwner = null
  notify(sessionId)

  // The attachments in the composer now: they stay there whatever the refine does.
  const attachmentIds = current.attachmentIds
  const serialize = current.serialize

  void (async () => {
    let attachments: readonly unknown[] = []
    try {
      if (attachmentIds.length > 0 && serialize !== null) attachments = await serialize(attachmentIds)
    } catch {
      // Typically a file still uploading: refining without it would ignore what the user attached.
      fail(sessionId, controller.signal.aborted ? t('err_ABORTED') : t('err_ATTACHMENTS'))
      return
    }
    // No mode: the host reads it from the plugin settings page.
    await send(sessionId, controller, ENDPOINT.improve, {
      sessionId,
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(publisher !== null ? { interactive: true } : {}),
    }, actions, t)
  })()
}

/**
 * Cancel the session's running refine, whatever it waits on: the open panel's run through
 * `/cancel`, otherwise the request in flight. Both end with the cancelled failure bubble.
 */
export function cancelRefine(sessionId: string, t: TFn): void {
  const current = storeFor(sessionId)
  if (current.ask !== null) void cancelAsk(sessionId, t)
  else if (current.controller !== null) current.controller.abort()
}

/** Every question's answer: its ticked idea texts (in list order) and own words; blank questions are left out. */
function answersOf(run: AskRun): AnswerBody[] {
  return run.questions.flatMap((question) => {
    const selected = question.ideas.filter((idea) => question.selected.has(idea.id)).map((idea) => idea.text)
    const custom = question.custom.trim()
    if (selected.length === 0 && custom === '') return []
    return [{ id: question.id, selected, ...(custom !== '' ? { custom } : {}) }]
  })
}

/** Tick or untick one idea of an open question. */
export function toggleIdea(sessionId: string, question: AskQuestion, ideaId: string): void {
  if (!question.selected.delete(ideaId)) question.selected.add(ideaId)
  notify(sessionId)
}

/** Record the user's own words for an open question. */
export function setOwnWords(sessionId: string, question: AskQuestion, text: string): void {
  question.custom = text
  notify(sessionId)
}

/** `/answer` with no answers: the host keeps the first rewrite. */
const NO_ANSWERS = (): AnswerBody[] => []

/** Close the panel and continue the refine with the chosen answers. */
function sendAnswers(sessionId: string, pick: (run: AskRun) => AnswerBody[], t: TFn): void {
  const state = storeFor(sessionId)
  const run = state.ask
  if (run === null) return
  const answers = pick(run)
  closeAsk(sessionId)
  // Aborting this request (the busy star) cancels the refine.
  const controller = new AbortController()
  state.controller = controller
  notify(sessionId)
  void send(sessionId, controller, ENDPOINT.answer, { runId: run.runId, answers }, run.actions, t)
}

/** Submit the panel's answers. */
export function submitAsk(sessionId: string, t: TFn): void {
  sendAnswers(sessionId, answersOf, t)
}

/** Skip every question; the refine keeps its first rewrite. */
export function skipAsk(sessionId: string, t: TFn): void {
  sendAnswers(sessionId, NO_ANSWERS, t)
}

/**
 * Ask the host for more ideas for one open question and append them after the existing ones.
 * A failure, or a reply with nothing new, leaves a note under the question and keeps its ideas.
 *
 * @param sessionId - the session whose panel shows the question.
 * @param question - the question, as held by the open run.
 * @param t - localized copy lookup.
 */
export async function requestIdeas(sessionId: string, question: AskQuestion, t: TFn): Promise<void> {
  const run = storeFor(sessionId).ask
  if (run === null || question.pending || !run.questions.includes(question)) return
  question.pending = true
  question.notice = null
  notify(sessionId)
  let notice: AskNotice | null = null
  try {
    const data = await postJson(ENDPOINT.stardea, { runId: run.runId, questionId: question.id }, run.stardea.signal)
    if (data.ok === true && Array.isArray(data.ideas)) {
      // Ideas are keyed by id (list keys, ticks), so an id seen before is never added twice.
      const known = new Set(question.ideas.map((idea) => idea.id))
      const before = question.ideas.length
      for (const idea of parseIdeas(data.ideas)) {
        if (known.has(idea.id)) continue
        known.add(idea.id)
        question.ideas.push(idea)
      }
      // The host drops ideas that repeat earlier ones, so a click can come back empty.
      if (question.ideas.length === before) notice = { kind: 'info', text: t('stardeaNoMore') }
    } else {
      notice = { kind: 'error', text: failureText(data, t) }
    }
  } catch (error) {
    notice = { kind: 'error', text: transportFailureText(error, t) }
  }
  question.pending = false
  question.notice = notice
  notify(sessionId)
}
