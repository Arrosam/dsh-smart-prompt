/**
 * dsh-improve-prompt — host half.
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
 * At most TWO model calls per click (one generation + one repair), never a pipeline.
 *
 * @module dsh-improve-prompt
 */

import z from '@deepseek-ai/schemastery'
import { resolveConfig, type Mode, type ResolvedConfig } from './config.js'
import { improveDraft, ERR, type ImproveDeps, type SessionsFace } from './orchestrate.js'
import type { LlmFace, Route } from './llm-call.js'

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
export const name = 'dsh-improve-prompt'

/** Required services: the model registry and the HTTP carrier. */
export const inject = ['llm', 'webServer']

export { Config } from './config.js'

/** Route namespace. */
const API = '/dsh-improve-prompt/api'

/** Request body cap; the composer limit is far lower, this only stops abuse. */
const MAX_BODY_BYTES = 512 * 1024

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

function readBody(req: HttpRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (...args: unknown[]) => {
      const chunk = args[0] as Buffer
      size += chunk.length
      if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); return }
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

  const deps = (): ImproveDeps => {
    const defaults = service('agentDefaultModel') as { currentSelection?: () => unknown } | undefined
    return {
      llm: service('llm') as LlmFace | undefined,
      selection: typeof defaults?.currentSelection === 'function'
        ? (defaults.currentSelection() as { provider?: unknown; model?: unknown } | undefined)
        : undefined,
      lastRoute,
      sessions: service('sessions') as SessionsFace | undefined,
    }
  }

  ctx.effect(() => (ctx as unknown as {
    webServer: { register(route: { kind: string; path: string; handler: (req: HttpRequest, res: HttpResponse) => unknown }): () => void }
  }).webServer.register({
    kind: 'prefix',
    path: API,
    handler: async (req, res) => {
      const url = typeof req.url === 'string' ? req.url : ''
      if (req.method === 'GET' && (url === API + '/config' || url === API + '/config/')) {
        sendJson(res, 200, {
          ok: true,
          defaultMode: config.defaultMode,
          modes: ['light', 'standard'],
          maxRatio: { light: config.lightMaxRatio, standard: config.standardMaxRatio },
          smartContext: config.smartContext,
        })
        return
      }
      if (url !== API + '/improve' && url !== API + '/improve/') {
        sendJson(res, 404, { ok: false, code: ERR.UNKNOWN, message: 'unknown route: ' + url })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, code: ERR.UNKNOWN, message: 'POST required' })
        return
      }

      let body: unknown
      try {
        body = JSON.parse(await readBody(req)) as unknown
      } catch (error) {
        sendJson(res, 400, { ok: false, code: 'BAD_BODY', message: error instanceof Error ? error.message : 'invalid JSON' })
        return
      }
      const input = (body !== null && typeof body === 'object' ? body : {}) as Record<string, unknown>
      const draft = typeof input.text === 'string' ? input.text : ''
      const sessionId = typeof input.sessionId === 'string' && input.sessionId !== '' ? input.sessionId : ''
      const mode: Mode = input.mode === 'light' || input.mode === 'standard' ? input.mode : config.defaultMode

      // Cancellation: a browser aborting the fetch must stop the model.
      const controller = new AbortController()
      let clientGone = false
      res.on('close', () => {
        if (res.writableEnded !== true) { clientGone = true; controller.abort() }
      })

      const started = Date.now()
      try {
        const result = await improveDraft(deps(), config, { draft, sessionId, mode, signal: controller.signal })
        if (clientGone) return
        // Every refusal is observable: the handled failure payloads below used to
        // return silently, leaving nothing in the host log to diagnose with.
        if (result.ok === false && config.logFailures) {
          log?.warn?.('[dsh-improve-prompt] ' + result.code + ' (' + String(Date.now() - started) + 'ms): ' + result.message)
        }
        sendJson(res, 200, result)
      } catch (error) {
        if (clientGone) return
        if (config.logFailures) log?.warn?.('[dsh-improve-prompt] ' + (error instanceof Error ? error.message : String(error)))
        sendJson(res, 200, {
          ok: false,
          code: ERR.UNKNOWN,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }), 'dsh-improve-prompt: improve api')
}
