/**
 * dsh-smart-prompt — host half.
 *
 * One loopback route that rewrites a composer draft into a sharper, agent-ready
 * prompt, wrapped in two deterministic gates that no other prompt enhancer in the
 * ecosystem has:
 *
 * - **fidelity gate** — extracts the draft's hard facts (paths, identifiers,
 *   numbers, URLs, code, @references) and verifies each one literally survived the
 *   rewrite; a dropped fact triggers exactly one repair call, then a deterministic
 *   re-append, so nothing is ever silently lost.
 * - **length gate** — refuses to let a one-line request become a specification,
 *   matching WorkBuddy's own "less filler, fewer tokens" positioning.
 *
 * When the rewrite finds information missing, the user is asked short follow-up
 * questions in the plugin's own composer panel and the draft is rewritten once more
 * with the answers. While the questions are open, Stardea (星念) proposes ideas for
 * answering one of them, from web search, the conversation, and the model's own proposals.
 * At most three model calls per click (generation, answers, repair), plus one per lookup
 * round the model uses (a settings-page limit, default 3) and one per Stardea request.
 * All of them are turns of one conversation, so each call reuses the last one's prompt cache.
 *
 * The draft's attachments, and the images of the earlier turns carried as context, are
 * sent to the refinement model with the draft.
 *
 * @module dsh-smart-prompt
 */

import z from '@deepseek-ai/schemastery'
import { MODE_VALUES, readLiveSettings, resolveConfig, type LiveSettings, type Mode, type ResolvedConfig } from './config.js'
import { improveDraft, ERR, type ImproveDeps, type ImproveOutcome, type SessionsFace } from './orchestrate.js'
import type { LlmFace, Route } from './llm-call.js'
import { AnswerMemory } from './answer-memory.js'
import { readAttachments, type AttachmentServices } from './attachments.js'
import { FollowUpDesk, NO_RUN, type Exchange } from './follow-up.js'
import { liveMessages } from './history.js'
import type { WebFace } from './lookups.js'
import type { SeamAnswer } from './questions.js'
import { messagesOfLog } from './session-lookup.js'
import { isOneOf } from './settings-fields.js'
import { asRecord, errorMessage, trimmedText } from './values.js'
import { fileKnowledgeStore, type KnowledgeStore } from './workspace-knowledge.js'

/**
 * The slice of the Cordis host context this plugin touches.
 *
 * Declared structurally rather than imported: the built plugin then type-checks
 * against nothing but TypeScript and @types/node, so a peer-package version skew
 * can never turn into a build failure. Every member is read defensively at call
 * time anyway (see `service()` below).
 */
export interface HostContext {
  effect(fn: () => unknown | (() => void), label?: string): unknown
  on(event: string, listener: (...args: never[]) => unknown): unknown
  get(name: string): unknown
  logger?: { warn?: (message: string) => void }
}

/** Cordis plugin name. */
export const name = 'dsh-smart-prompt'

/** Required services: the model registry and the HTTP carrier. */
export const inject = ['llm', 'webServer']

export { Config } from './config.js'

/** Route namespace. */
const API = '/dsh-smart-prompt/api'

/** Endpoints under {@link API}. */
const ENDPOINT = Object.freeze({ config: '/config', improve: '/improve', stardea: '/stardea', answer: '/answer', cancel: '/cancel' })

/** Whether a request URL addresses one endpoint (a trailing slash is accepted). */
function isEndpoint(url: string, endpoint: string): boolean {
  return url === API + endpoint || url === API + endpoint + '/'
}

/** Prefix of every host log line. */
const LOG_PREFIX = '[dsh-smart-prompt] '

/** Request body cap without images; the composer limit is far lower, this only stops abuse. */
const MAX_TEXT_BODY_BYTES = 512 * 1024

/** Encoded size per raw byte in base64 (4 characters per 3 bytes). */
const BASE64_EXPANSION = 4 / 3

/**
 * Body cap for a request that may carry the draft's images as base64: the host's own
 * per-message image limit (what the composer can send at all), expanded by base64.
 */
function maxBodyBytes(attachments: AttachmentStoreFace | undefined): number {
  const images = attachments?.imageLimits?.maxMessageImageBytes
  return typeof images === 'number' && Number.isFinite(images) && images > 0
    ? MAX_TEXT_BODY_BYTES + Math.ceil(images * BASE64_EXPANSION)
    : MAX_TEXT_BODY_BYTES
}

/** The slice of `ctx.attachments` (`@deepseek-ai/dsh-attachment`) this plugin uses. */
interface AttachmentStoreFace {
  readonly imageLimits?: { readonly maxMessageImageBytes?: number }
  admitPromptContent?(content: readonly unknown[]): Promise<readonly unknown[]>
  readFileStream?(ref: unknown, signal?: AbortSignal): AsyncIterable<Uint8Array>
}

interface HttpRequest {
  method?: string
  url?: string
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

interface HttpResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
  on(event: string, listener: (...args: unknown[]) => void): unknown
  readonly writableEnded?: boolean
}

function sendJson(res: HttpResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function readBody(req: HttpRequest, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (...args: unknown[]) => {
      const chunk = args[0] as Buffer
      size += chunk.length
      if (size > maxBytes) { reject(new Error('body too large')); return }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', (error: unknown) => { reject(error instanceof Error ? error : new Error(String(error))) })
  })
}

/**
 * Attach the plugin.
 *
 * @param ctx - cordis context carrying `llm` and `webServer`.
 * @param rawConfig - loader-supplied configuration (all keys optional).
 */
export function apply(ctx: HostContext, rawConfig: unknown): void {
  const config: ResolvedConfig = resolveConfig(rawConfig)
  const log = ctx.logger
  // ctx.get() is the non-throwing accessor for a service outside the declared inject
  // list; reading ctx.<service> directly throws for an uninjected one.
  const service = (serviceName: string): unknown => ctx.get(serviceName)

  // Last route observed on the live waterfall: the fallback when neither the config
  // nor the default-model selection names one. Waterfall listeners MUST delegate.
  let lastRoute: Route | null = null
  ctx.on('llm/stream' as never, ((options: { provider?: string; model?: string }, next: () => unknown) => {
    if (typeof options.provider === 'string' && typeof options.model === 'string'
      && options.provider !== '' && options.model !== '') {
      lastRoute = { provider: options.provider, model: options.model }
    }
    return next()
  }) as never)

  // The model picked in one conversation: the host's durable `modelSelection` session
  // projection (`next` = pending pick, else the last request's route). Read structurally
  // and defensively — on hosts without it the route falls back to the default model.
  const conversationModel = (sessionId: string): { provider?: unknown; model?: unknown } | undefined => {
    const sessions = service('sessions') as { get?: (id: string) => unknown } | undefined
    const projections = service('sessionProjections') as { stateOf?: (session: unknown, key: string) => unknown } | undefined
    if (typeof sessions?.get !== 'function' || typeof projections?.stateOf !== 'function') return undefined
    try {
      const session = sessions.get(sessionId)
      if (session === undefined) return undefined
      const state = projections.stateOf(session, 'modelSelection') as
        { pending?: { provider?: unknown; model?: unknown } | null; lastUsed?: { provider?: unknown; model?: unknown } | null } | undefined
      return state?.pending ?? state?.lastUsed ?? undefined
    } catch {
      return undefined
    }
  }

  // One per plugin instance: answers outlive a failed request so its retry does not ask again.
  const answers = new AnswerMemory()
  // Refinements whose follow-up questions are open in a composer panel.
  const desk = new FollowUpDesk()
  ctx.effect(() => () => { desk.dispose() }, 'dsh-smart-prompt: follow-up questions')

  // The draft's attachments. Images go through the host's prompt admission, the same
  // validation and content-addressed storage a sent prompt uses (sending the draft later
  // stores the same bytes under the same id). File receipts belong to the session's agent.
  const attachmentServices = (): AttachmentServices | undefined => {
    const store = service('attachments') as AttachmentStoreFace | undefined
    const uploads = service('fileUploads') as { resolve?: (agent: unknown, receiptId: string) => unknown } | undefined
    const agents = service('agents') as { get?: (id: string) => unknown } | undefined
    if (typeof store?.admitPromptContent !== 'function' || typeof store.readFileStream !== 'function') return undefined
    return {
      admit: (parts) => store.admitPromptContent!(parts),
      resolveFile: (sessionId, receiptId) => {
        const agent = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined
        return agent !== undefined && typeof uploads?.resolve === 'function' ? uploads.resolve(agent, receiptId) : undefined
      },
      readFile: (ref, signal) => store.readFileStream!(ref, signal),
    }
  }

  // A session's messages for lookups. The query service reads the whole log, including
  // turns a compaction has since summarized; without it, the live session's current messages.
  const sessionMessages = async (sessionId: string): Promise<unknown> => {
    const query = service('sessionQuery') as { readSession?: (id: string) => Promise<{ events?: unknown }> } | undefined
    if (typeof query?.readSession === 'function') {
      try {
        return messagesOfLog((await query.readSession(sessionId)).events)
      } catch { /* fall back to the live session below */ }
    }
    return liveMessages(service('sessions') as SessionsFace | undefined, sessionId)
  }

  // DSH's web search service (`@deepseek-ai/dsh-web`), the one its own `web_search` tool
  // uses, with whichever provider the user configured. Absent on hosts without it.
  const webSearch = (): WebFace | undefined => {
    const web = service('web') as { search?: WebFace['search'] } | undefined
    return typeof web?.search === 'function' ? { search: (request, signal) => web.search!(request, signal) } : undefined
  }

  // The workspace knowledge file lives in the session's workspace: the directory the session
  // was created in (its header), not its current directory, which `cd` can move into a
  // subfolder or elsewhere. Sessions without one get no knowledge file.
  const knowledge = (sessionId: string): KnowledgeStore | undefined => {
    const sessions = service('sessions') as { get?: (id: string) => { header?: { cwd?: unknown } } | undefined } | undefined
    try {
      const root = sessions?.get?.(sessionId)?.header?.cwd
      return typeof root === 'string' && root !== '' ? fileKnowledgeStore(root) : undefined
    } catch {
      return undefined
    }
  }

  // Host faces for one request, with the settings that request runs under.
  const deps = (settings: LiveSettings): ImproveDeps => {
    const defaults = service('agentDefaultModel') as { currentSelection?: () => unknown } | undefined
    const attachments = attachmentServices()
    return {
      dedicated: settings.modelSource === 'dedicated'
        ? { provider: settings.provider, model: settings.model, reasoningEffort: settings.reasoningEffort }
        : undefined,
      conversationModel,
      llm: service('llm') as LlmFace | undefined,
      selection: typeof defaults?.currentSelection === 'function'
        ? (defaults.currentSelection() as { provider?: unknown; model?: unknown } | undefined)
        : undefined,
      lastRoute,
      sessions: service('sessions') as SessionsFace | undefined,
      answers,
      web: webSearch(),
      readAttachments: attachments !== undefined
        ? (sessionId: string, wire: readonly unknown[], signal: AbortSignal) => readAttachments(attachments, sessionId, wire, signal)
        : undefined,
      sessionMessages,
      knowledge,
    }
  }

  ctx.effect(() => (ctx as unknown as {
    webServer: { register(route: { kind: string; path: string; handler: (req: HttpRequest, res: HttpResponse) => unknown }): () => void }
  }).webServer.register({
    kind: 'prefix',
    path: API,
    handler: async (req, res) => {
      const url = typeof req.url === 'string' ? req.url : ''
      if (req.method === 'GET' && isEndpoint(url, ENDPOINT.config)) {
        sendJson(res, 200, {
          ok: true,
          defaultMode: readLiveSettings(rawConfig).mode,
          modes: MODE_VALUES,
          maxRatio: { light: config.lightMaxRatio, standard: config.standardMaxRatio },
          smartContext: config.smartContext,
        })
        return
      }
      const endpoint = POST_ENDPOINTS.find((candidate) => isEndpoint(url, candidate))
      if (endpoint === undefined) {
        sendJson(res, 404, { ok: false, code: ERR.UNKNOWN, message: 'unknown route: ' + url })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, code: ERR.UNKNOWN, message: 'POST required' })
        return
      }

      let body: unknown
      try {
        body = JSON.parse(await readBody(req, maxBodyBytes(service('attachments') as AttachmentStoreFace | undefined))) as unknown
      } catch (error) {
        sendJson(res, 400, { ok: false, code: ERR.BAD_BODY, message: error instanceof Error ? error.message : 'invalid JSON' })
        return
      }
      const input = asRecord(body)

      // Cancellation: a browser aborting the fetch must stop what it waits for.
      const controller = new AbortController()
      let clientGone = false
      res.on('close', () => {
        if (res.writableEnded !== true) { clientGone = true; controller.abort() }
      })
      const started = Date.now()
      const reply = (payload: unknown): void => { if (!clientGone) sendJson(res, 200, payload) }

      try {
        switch (endpoint) {
          case ENDPOINT.improve: {
            const exchange = await startRefine(input, controller.signal)
            // Questions nobody received can never be answered: end that refinement now.
            if (clientGone && exchange.kind === 'ask') desk.cancel(exchange.runId)
            reply(exchangePayload(exchange, started))
            return
          }
          case ENDPOINT.stardea: {
            const runId = trimmedText(input.runId)
            const questionId = trimmedText(input.questionId)
            if (runId === '' || questionId === '') { reply(badBody(BAD_BODY_MESSAGE.stardea)); return }
            reply(await desk.stardea(runId, questionId, controller.signal))
            return
          }
          case ENDPOINT.answer: {
            const runId = trimmedText(input.runId)
            if (runId === '' || !Array.isArray(input.answers)) { reply(badBody(BAD_BODY_MESSAGE.answer)); return }
            // Entries are read field by field downstream; anything but an object is no answer.
            const items = (input.answers as unknown[]).filter((item) => item !== null && typeof item === 'object')
            const next = desk.answer(runId, { answers: items as SeamAnswer['answers'] }, controller.signal)
            reply(next !== undefined ? exchangePayload(await next, started) : NO_RUN)
            return
          }
          default: {
            const runId = trimmedText(input.runId)
            if (runId === '') { reply(badBody(BAD_BODY_MESSAGE.cancel)); return }
            reply(desk.cancel(runId) ? { ok: true } : NO_RUN)
          }
        }
      } catch (error) {
        if (clientGone) return
        const message = errorMessage(error)
        if (config.logFailures) log?.warn?.(LOG_PREFIX + message)
        sendJson(res, 200, { ok: false, code: ERR.UNKNOWN, message })
      }
    },
  }), 'dsh-smart-prompt: improve api')

  /**
   * Start one refinement from an `/improve` body. A request that says its client can show
   * the follow-up panel (and names a session) may get questions back instead of a result.
   */
  function startRefine(input: Record<string, unknown>, signal: AbortSignal): Promise<Exchange> {
    // One settings snapshot per refinement: a save landing mid-refinement cannot mix values.
    const settings = readLiveSettings(rawConfig)
    const draft = typeof input.text === 'string' ? input.text : ''
    const sessionId = typeof input.sessionId === 'string' && input.sessionId !== '' ? input.sessionId : ''
    const attachments = Array.isArray(input.attachments) ? input.attachments as unknown[] : []
    // The settings page owns the mode; a request may still name one explicitly.
    const mode: Mode = isOneOf(input.mode, MODE_VALUES) ? input.mode : settings.mode
    const interactive = input.interactive === true && sessionId !== ''
    return desk.start(sessionId, signal, (ask, runSignal) => improveDraft(
      { ...deps(settings), askUser: interactive ? () => ask : undefined },
      config,
      {
        draft, sessionId, mode, signal: runSignal, attachments,
        maxQuestions: settings.maxQuestions,
        lookupRounds: settings.sessionLookupRounds,
        stardeaIdeas: settings.stardeaIdeas,
        stardeaRounds: settings.stardeaRounds,
        stardeaWebSearch: settings.stardeaWebSearch,
      },
    ))
  }

  /** The JSON reply for one exchange; every refusal is logged with how long the request took. */
  function exchangePayload(exchange: Exchange, started: number): unknown {
    if (exchange.kind === 'ask') return { ok: true, ask: { runId: exchange.runId, questions: exchange.questions.map(({ id, question }) => ({ id, question })) } }
    logRefusal(exchange.outcome, started)
    return exchange.outcome
  }

  // Every refusal is observable: handled failure payloads used to return silently,
  // leaving nothing in the host log to diagnose with.
  function logRefusal(outcome: ImproveOutcome, started: number): void {
    if (outcome.ok === false && config.logFailures) {
      log?.warn?.(LOG_PREFIX + outcome.code + ' (' + String(Date.now() - started) + 'ms): ' + outcome.message)
    }
  }
}

/** Endpoints that take a POST body. */
const POST_ENDPOINTS = [ENDPOINT.improve, ENDPOINT.stardea, ENDPOINT.answer, ENDPOINT.cancel] as const

/** What a follow-up request body is missing. */
const BAD_BODY_MESSAGE = Object.freeze({
  stardea: 'runId and questionId are required',
  answer: 'runId and an answers array are required',
  cancel: 'runId is required',
})

function badBody(message: string): { ok: false; code: string; message: string } {
  return { ok: false, code: ERR.BAD_BODY, message }
}
