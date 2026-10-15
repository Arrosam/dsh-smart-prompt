/**
 * The enhancement orchestrator: generate, gate, repair once, report.
 *
 * Kept free of cordis so the whole reply pipeline can be driven by a stub model in
 * tests — the gates are the product, so they are verified deterministically rather
 * than by hoping a real model misbehaves.
 *
 * @module dsh-smart-prompt/orchestrate
 */

import { extractAnchors } from './anchors.js'
import { splitCommand } from './command.js'
import { maxRatioFor, type Mode, type ResolvedConfig } from './config.js'
import { checkFidelity, fidelityNote, reinjectionBlock, repairClause } from './fidelity.js'
import { collectTurns, formatHistoryBlock } from './history.js'
import { callModel, NoRouteError, resolveRoute, type CallFailure, type LlmFace, type Route } from './llm-call.js'
import { budgetFor, charLength, formatRatio, lengthVerdict } from './length-gate.js'
import { normalizeOutput } from './normalize.js'
import { buildSystemPrompt, buildUserMessage } from './prompts.js'
import { contextTrigger } from './context-trigger.js'

/** Stable error codes the client maps to localized copy. */
export const ERR = {
  EMPTY: 'EMPTY',
  COMMAND: 'COMMAND',
  TOO_LONG: 'TOO_LONG',
  NO_ROUTE: 'NO_ROUTE',
  TIMEOUT: 'TIMEOUT',
  ABORTED: 'ABORTED',
  EMPTY_OUTPUT: 'EMPTY_OUTPUT',
  TOOL_CALL: 'TOOL_CALL',
  LENGTH_EXCEEDED: 'LENGTH_EXCEEDED',
  UPSTREAM: 'UPSTREAM',
  UNKNOWN: 'UNKNOWN',
} as const

/** Quality certificate returned on success. */
export interface ImproveMeta {
  mode: Mode
  model: string
  ratio: number
  ratioLabel: string
  elapsedMs: number
  anchors: { total: number; kept: number; reinjected: number }
  note: string
  contextUsed: string
}

/** Success payload. */
export interface ImproveOk { ok: true; text: string; meta: ImproveMeta }
/** Failure payload — the draft is never touched. */
export interface ImproveErr { ok: false; code: string; message: string }
/** What the route returns. */
export type ImproveOutcome = ImproveOk | ImproveErr

/** Live session face used for context (feature-detected). */
export interface SessionsFace {
  get(id: string): { deriveMessages?: () => unknown } | undefined
}

/** Everything the orchestrator needs from the host. */
export interface ImproveDeps {
  readonly llm: LlmFace | undefined
  /** `agentDefaultModel.currentSelection()` output, when the service exists. */
  readonly selection?: { provider?: unknown; model?: unknown } | undefined
  /** The settings-page dedicated model, present only when that source is selected. */
  readonly dedicated?: { provider?: unknown; model?: unknown; reasoningEffort?: unknown } | undefined
  /** Model picked in the request's conversation, when the host can say. */
  readonly conversationModel?: (sessionId: string) => { provider?: unknown; model?: unknown } | undefined
  /** Route captured from the live `llm/stream` waterfall, when one has been seen. */
  readonly lastRoute?: Route | null
  readonly sessions?: SessionsFace | undefined
}

/** One request. */
export interface ImproveInput {
  readonly draft: string
  readonly sessionId: string
  readonly mode: Mode
  readonly signal: AbortSignal
}

function failureOf(failure: CallFailure, cfg: ResolvedConfig): ImproveErr {
  switch (failure.code) {
    case 'TIMEOUT':
      return { ok: false, code: ERR.TIMEOUT, message: '增强超时（' + String(cfg.timeoutMs) + 'ms），原文未改动' }
    case 'ABORTED':
      return { ok: false, code: ERR.ABORTED, message: '已取消' }
    case 'EMPTY':
      return { ok: false, code: ERR.EMPTY_OUTPUT, message: '模型没有返回内容，原文未改动' }
    case 'TOOL_CALL':
      return { ok: false, code: ERR.TOOL_CALL, message: '模型返回了工具调用而非提示词，原文未改动' }
    default:
      return { ok: false, code: ERR.UPSTREAM, message: '模型调用失败：' + failure.message + '（原文未改动）' }
  }
}

/**
 * Run one enhancement end to end.
 *
 * Call budget: one generation call, plus at most ONE repair call when a gate
 * complains. Never a pipeline.
 *
 * @param deps - host faces (model, route sources, sessions).
 * @param cfg - resolved configuration.
 * @param input - the draft, session, mode, and caller signal.
 * @returns the success payload with its certificate, or a typed failure.
 */
export async function improveDraft(deps: ImproveDeps, cfg: ResolvedConfig, input: ImproveInput): Promise<ImproveOutcome> {
  // ---- local guards: refuse before any model traffic ----
  if (input.draft.trim() === '') return { ok: false, code: ERR.EMPTY, message: '输入框为空' }
  // A leading slash token is the harness's command: rewrite only what follows it,
  // then put the prefix back verbatim. A command with no body has nothing to do.
  const split = splitCommand(input.draft)
  if (split.command !== '' && split.body === '') {
    return { ok: false, code: ERR.COMMAND, message: '斜杠命令后没有可改写的正文' }
  }
  const draft = split.body
  if (charLength(draft) > cfg.maxInputChars) {
    return {
      ok: false,
      code: ERR.TOO_LONG,
      message: '草稿过长（' + String(charLength(draft)) + ' > ' + String(cfg.maxInputChars) + ' 字符）',
    }
  }
  if (deps.llm === undefined) return { ok: false, code: ERR.NO_ROUTE, message: '模型服务不可用' }

  let route: Route
  try {
    route = resolveRoute({
      dedicated: deps.dedicated,
      conversation: input.sessionId !== '' && deps.conversationModel !== undefined ? deps.conversationModel(input.sessionId) : undefined,
      defaults: deps.selection,
      lastSeen: deps.lastRoute ?? null,
    })
  } catch (error) {
    if (error instanceof NoRouteError) {
      return {
        ok: false,
        code: ERR.NO_ROUTE,
        message: '未找到可用模型：请在插件设置里选一个模型，或先在会话里选模型',
      }
    }
    throw error
  }
  const started = Date.now()

  // ---- context: only when the draft cannot stand alone ----
  const trigger = cfg.smartContext && cfg.contextTurns > 0
    ? contextTrigger(draft)
    : { needed: false, reason: 'none' as const }
  let contextBlock = ''
  if (trigger.needed && input.sessionId !== '' && deps.sessions !== undefined) {
    // Context is an optimization, never a precondition: a broken session store
    // degrades to no context instead of failing the enhancement.
    try {
      const session = deps.sessions.get(input.sessionId)
      if (session !== undefined && typeof session.deriveMessages === 'function') {
        contextBlock = formatHistoryBlock(collectTurns(session.deriveMessages(), cfg.contextTurns, cfg.contextChars))
      }
    } catch { contextBlock = '' }
  }

  const system = buildSystemPrompt(input.mode, cfg)
  const anchors = cfg.fidelityGate ? extractAnchors(draft) : []
  const maxRatio = maxRatioFor(cfg, input.mode)

  const first = await callModel(deps.llm, {
    route, system, config: cfg, signal: input.signal,
    userMessage: buildUserMessage(draft, contextBlock, ''),
  })
  if (!first.ok) return failureOf(first.failure, cfg)

  let enhanced = normalizeOutput(first.text)
  if (enhanced === '') return { ok: false, code: ERR.EMPTY_OUTPUT, message: '模型没有返回可用内容，原文未改动' }

  // ---- gates ----
  let fidelity = checkFidelity(anchors, enhanced)
  const verdict = cfg.lengthGate ? lengthVerdict(draft, enhanced, maxRatio) : { kind: 'ok' as const, ratio: 1 }

  if ((fidelity.missing.length > 0 || verdict.kind === 'converge') && !input.signal.aborted) {
    const clauses: string[] = []
    if (verdict.kind === 'converge') {
      clauses.push('\nYour previous rewrite was too long: ' + String(charLength(enhanced))
        + ' characters against a budget of ' + String(verdict.charBudget)
        + '. Rewrite it again, shorter, without dropping any content.')
    }
    if (fidelity.missing.length > 0) clauses.push(repairClause(fidelity.missing))

    const repair = await callModel(deps.llm, {
      route, system, config: cfg, signal: input.signal,
      userMessage: buildUserMessage(draft, contextBlock, clauses.join('\n')),
    })
    if (repair.ok) {
      const repaired = normalizeOutput(repair.text)
      if (repaired !== '') {
        enhanced = repaired
        fidelity = checkFidelity(anchors, enhanced)
      }
    }
  }
  if (input.signal.aborted) return { ok: false, code: ERR.ABORTED, message: '已取消' }

  // ---- deterministic last resort: never silently lose a fact ----
  let reinjected = 0
  if (cfg.fidelityGate && fidelity.missing.length > 0) {
    const block = reinjectionBlock(fidelity.missing)
    if (block !== '') {
      enhanced = enhanced + block
      reinjected = fidelity.missing.length
    }
  }

  // ---- final length judgement: a re-appended fact outranks the ceiling ----
  const finalRatio = charLength(draft) === 0 ? 0 : charLength(enhanced) / charLength(draft)
  const finalBudget = budgetFor(draft, maxRatio)
  if (cfg.lengthGate && reinjected === 0 && charLength(enhanced) > finalBudget) {
    return {
      ok: false,
      code: ERR.LENGTH_EXCEEDED,
      message: '增强结果超出长度上限（' + String(charLength(enhanced)) + ' > ' + String(finalBudget)
        + ' 字符，' + formatRatio(finalRatio) + '），已保留原文；可切换到「轻」档或调高上限',
    }
  }

  return {
    ok: true,
    text: split.prefix + enhanced,
    meta: {
      mode: input.mode,
      // The agent's default selection may already carry the provider prefix
      // (e.g. model "zhipuai/glm-5.3-flash"); never render it twice.
      model: route.model.startsWith(route.provider + '/') ? route.model : route.provider + '/' + route.model,
      ratio: Math.round(finalRatio * 100) / 100,
      ratioLabel: formatRatio(finalRatio),
      elapsedMs: Date.now() - started,
      anchors: { total: fidelity.total, kept: fidelity.kept, reinjected },
      note: reinjected > 0 ? fidelityNote(fidelity.missing) : '',
      contextUsed: contextBlock !== '' ? trigger.reason : 'none',
    },
  }
}
