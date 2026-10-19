/**
 * The host routes the client calls. Every route takes a JSON `POST` and answers HTTP 200
 * with JSON, so one request helper serves them all.
 *
 * @module dsh-smart-prompt/client/api
 */

import type { Meta } from './store.js'

/** Base path the host mounts the plugin's routes under. */
const API_BASE = '/dsh-smart-prompt/api/'

/** Route names under {@link API_BASE}. */
export const ENDPOINT = Object.freeze({
  /** Refine a draft; may answer with follow-up questions instead of a result. */
  improve: 'improve',
  /** Ask for more candidate answers (ideas) to one follow-up question. */
  stardea: 'stardea',
  /** Answer (or skip) the follow-up questions; answers like `improve`. */
  answer: 'answer',
  /** Drop a refine that waits for answers. */
  cancel: 'cancel',
})

export type Endpoint = typeof ENDPOINT[keyof typeof ENDPOINT]

/** One question's answer as `/answer` takes it: the ticked idea texts plus the user's own words. */
export interface AnswerBody {
  id: string
  selected: string[]
  custom?: string
}

/**
 * Union of the fields the routes answer with; which ones are present depends on the route
 * and the outcome. Untrusted: callers check every field they read.
 */
export interface ApiResponse {
  ok?: boolean
  code?: string
  message?: string
  text?: string
  meta?: Meta
  ask?: unknown
  ideas?: unknown
}

/**
 * POST one JSON body to a plugin route.
 *
 * @param endpoint - the route.
 * @param body - the request body, serialized as JSON.
 * @param signal - aborts the request.
 * @returns the parsed response body.
 * @throws on network failure, abort (see {@link isAbort}) or a body that is not JSON.
 */
export async function postJson(endpoint: Endpoint, body: unknown, signal?: AbortSignal): Promise<ApiResponse> {
  const response = await fetch(API_BASE + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  return (await response.json()) as ApiResponse
}

/** Whether a rejected request was aborted through its signal. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
