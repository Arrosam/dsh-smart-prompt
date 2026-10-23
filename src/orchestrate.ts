/**
 * The enhancement orchestrator: generate, ask, gate, repair once, report.
 *
 * Kept free of cordis so the whole reply pipeline can be driven by a stub model in
 * tests — the gates are the product, so they are verified deterministically rather
 * than by hoping a real model misbehaves.
 *
 * Every model call of one refinement goes through one {@link RefineChat}, so each call
 * repeats the previous one's request as its prefix (prompt-cache friendly) and lookups
 * found in one step stay visible to every later step.
 *
 * @module dsh-smart-prompt/orchestrate
 */

import { extractAnchors } from './anchors.js'
import { splitCommand } from './command.js'
import { maxRatioFor, type Mode, type ResolvedConfig } from './config.js'
import { checkFidelity, fidelityNote, reinjectionBlock, repairClause } from './fidelity.js'
import { collectTurns, formatHistoryBlock, liveMessages, type HistoryTurn, type SessionsFace } from './history.js'
import { NoRouteError, resolveRoute, type CallFailure, type LlmFace, type Route } from './llm-call.js'
import { charLength, formatRatio, lengthRepairClause, lengthVerdict } from './length-gate.js'
import { Lookups, RoundBudget, WebLookup, type LookupSource, type WebFace } from './lookups.js'
import { normalizeOutput } from './normalize.js'
import {
  answersPrompt, answersTurn, attachmentsPrompt, buildAttachmentContent, buildSystemPrompt, buildUserMessage,
  followUpStatus, knowledgeUpdateTurn, lookupPrompt, questionsPrompt, skippedTurn, stardeaPrompt, stardeaTurn,
  type FollowUpState,
} from './prompts.js'
import { FOLLOW_UP_POLICY, questionsForReply } from './follow-up-policy.js'
import { answeredQuestions, formatAnswers, parseRewrite, questionId, type SeamAnswer } from './questions.js'
import { contextTrigger } from './context-trigger.js'
import { RefineChat, type UsageReport } from './refine-chat.js'
import { SessionLookup } from './session-lookup.js'
import { DEFAULT_STARDEA_IDEAS } from './settings-fields.js'
import { IdeaBook, parseIdeas, type Stardea, type StardeaOutcome } from './stardea.js'
import type { AnswerMemory } from './answer-memory.js'
import { knowledgeBlock, loadKnowledge, parseKnowledgeUpdate, type KnowledgeStore, type LoadedKnowledge } from './workspace-knowledge.js'

/** Stable error codes the client maps to localized copy. */
export const ERR = {
  EMPTY: 'EMPTY',
  COMMAND: 'COMMAND',
  TOO_LONG: 'TOO_LONG',
  BAD_BODY: 'BAD_BODY',
  NO_ROUTE: 'NO_ROUTE',
  TIMEOUT: 'TIMEOUT',
  ABORTED: 'ABORTED',
  EMPTY_OUTPUT: 'EMPTY_OUTPUT',
  TOOL_CALL: 'TOOL_CALL',
  LENGTH_EXCEEDED: 'LENGTH_EXCEEDED',
  UPSTREAM: 'UPSTREAM',
  /** A follow-up request (Stardea, answers, cancel) names a refinement or question that is not open. */
  NO_RUN: 'NO_RUN',
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
  /** Why session context was used: the smart-context trigger, 'last-turn', 'lookup', or 'none'. */
  contextUsed: string
  /** Follow-up questions asked about missing information, and how many the user answered. */
  questions: { asked: number; answered: number }
  /** Lookup rounds the model used for the rewrite (Stardea rounds not included). */
  lookups: number
  /** Tokens of every model call of the refinement, Stardea included; absent when no call reported any. */
  usage?: UsageReport
}

/** Success payload. */
export interface ImproveOk { ok: true; text: string; meta: ImproveMeta }
/** Failure payload — the draft is never touched. */
export interface ImproveErr { ok: false; code: string; message: string }
/** What the route returns. */
export type ImproveOutcome = ImproveOk | ImproveErr

export type { SessionsFace }

/** One follow-up question. */
export interface FollowUpQuestion { readonly id: string; readonly question: string; readonly header: string }

/**
 * Asks the user; rejects when the questions are dismissed. `stardea` finds ideas for
 * answering one of the questions while they are open.
 */
export type AskUser = (questions: readonly FollowUpQuestion[], signal: AbortSignal, stardea: Stardea) => Promise<SeamAnswer>

/**
 * Turns of context every refinement carries (user requirement): the last exchange is what
 * the user just read, so a new draft most often continues it even without an anaphora.
 */
const ALWAYS_KEPT_TURNS = 1

/** Heading shown on each follow-up question. */
const QUESTION_HEADER = 'Smart prompt'

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
  /**
   * The follow-up panel of the request's conversation, or undefined when the user cannot
   * be asked there. Without it the model is not asked for questions at all.
   */
  readonly askUser?: ((sessionId: string) => AskUser | undefined) | undefined
  /** DSH's web search service, for Stardea ideas; undefined when the host has none. */
  readonly web?: WebFace | undefined
  /** Answers kept across a failed refinement, so retrying the same draft does not ask again. */
  readonly answers?: AnswerMemory | undefined
  /**
   * Reads the draft's attachments into model content blocks; undefined on hosts without
   * attachment storage, where attachments are left out.
   */
  readonly readAttachments?: ((sessionId: string, wire: readonly unknown[], signal: AbortSignal) => Promise<readonly unknown[]>) | undefined
  /** Loads a session's messages for lookups; undefined when the host cannot. */
  readonly sessionMessages?: ((sessionId: string) => Promise<unknown>) | undefined
  /** The workspace knowledge file of a session's workspace; undefined when it has none. */
  readonly knowledge?: ((sessionId: string) => KnowledgeStore | undefined) | undefined
  /**
   * Runs work that outlives the request (the knowledge update), after the outcome is
   * returned; absent means the work is simply not awaited.
   */
  readonly background?: ((task: () => Promise<void>) => void) | undefined
}

/** One request. */
export interface ImproveInput {
  readonly draft: string
  readonly sessionId: string
  readonly mode: Mode
  readonly signal: AbortSignal
  /** Most follow-up questions to ask; 0 asks none. */
  readonly maxQuestions?: number
  /** The draft's attachments, as the composer serialized them. */
  readonly attachments?: readonly unknown[]
  /** Most lookup rounds the rewrite steps may use together; 0 (the default) runs none. */
  readonly lookupRounds?: number
  /** Most new ideas one Stardea request returns; absent means {@link DEFAULT_STARDEA_IDEAS}. */
  readonly stardeaIdeas?: number
  /** Most lookup rounds each Stardea request may use; 0 (the default) runs none. */
  readonly stardeaRounds?: number
  /** Whether Stardea requests may search the web; off by default. */
  readonly stardeaWebSearch?: boolean
}

/**
 * Host-side failure copy. The client shows its own localized text per code and falls
 * back to these only for a code it does not know; they also go to the host log.
 */
const MESSAGE = Object.freeze({
  EMPTY: '输入框为空',
  COMMAND: '斜杠命令后没有可改写的正文',
  tooLong: (chars: number, max: number): string => '草稿过长（' + String(chars) + ' > ' + String(max) + ' 字符）',
  NO_LLM: '模型服务不可用',
  NO_ROUTE: '未找到可用模型：请在插件设置里选一个模型，或先在会话里选模型',
  ABORTED: '已取消',
  timeout: (ms: number): string => '增强超时（' + String(ms) + 'ms），原文未改动',
  EMPTY_OUTPUT: '模型没有返回内容，原文未改动',
  UNUSABLE_OUTPUT: '模型没有返回可用内容，原文未改动',
  TOOL_CALL: '模型返回了工具调用而非提示词，原文未改动',
  NO_IDEAS: '模型没有给出想法',
  NO_RUN: '这次改写已结束或问题不存在',
  upstream: (detail: string): string => '模型调用失败：' + detail + '（原文未改动）',
  lengthExceeded: (chars: number, budget: number, ratio: string): string => '增强结果超出长度上限（' + String(chars) + ' > ' + String(budget)
    + ' 字符，' + ratio + '），已保留原文；可切换到「轻」档或调高上限',
})

function refuse(code: string, message: string): ImproveErr {
  return { ok: false, code, message }
}

/** The outcome of a cancelled refinement. */
function aborted(): ImproveErr {
  return refuse(ERR.ABORTED, MESSAGE.ABORTED)
}

function failureOf(failure: CallFailure, cfg: ResolvedConfig): ImproveErr {
  switch (failure.code) {
    case 'TIMEOUT':
      return refuse(ERR.TIMEOUT, MESSAGE.timeout(cfg.timeoutMs))
    case 'ABORTED':
      return aborted()
    case 'EMPTY':
      return refuse(ERR.EMPTY_OUTPUT, MESSAGE.EMPTY_OUTPUT)
    case 'TOOL_CALL':
      return refuse(ERR.TOOL_CALL, MESSAGE.TOOL_CALL)
    default:
      return refuse(ERR.UPSTREAM, MESSAGE.upstream(failure.message))
  }
}

/** A follow-up or repair reply as composer text: any stray question block removed, wrappers stripped. */
function cleanRewrite(text: string): string {
  return normalizeOutput(parseRewrite(text, 0).text)
}

/**
 * The lookup sources of one refinement. The conversation's earlier messages serve the
 * rewrite when it has rounds, and Stardea when the user can be asked and Stardea has
 * rounds; the web serves Stardea only, and only when the user turned it on. Fixed when the
 * refinement starts, because the tool list is part of every call's cached prefix.
 */
function lookupSources(deps: ImproveDeps, input: ImproveInput, canAsk: boolean): { session: LookupSource[]; web: LookupSource[] } {
  const stardeaSearches = canAsk && (input.stardeaRounds ?? 0) > 0
  const load = deps.sessionMessages
  const sessionUsed = (input.lookupRounds ?? 0) > 0 || stardeaSearches
  return {
    session: sessionUsed && input.sessionId !== '' && load !== undefined ? [new SessionLookup(() => load(input.sessionId))] : [],
    web: stardeaSearches && input.stardeaWebSearch === true && deps.web !== undefined ? [new WebLookup(deps.web)] : [],
  }
}

/**
 * Run one enhancement end to end.
 *
 * Call budget: one generation call; one more when the user answered follow-up
 * questions about missing information; plus at most ONE repair call when a gate
 * complains. Each lookup round the model uses adds one call: the rewrite steps share the
 * rewrite's round limit, and every Stardea request has its own Stardea limit (plus one plain
 * retry if the route refuses tools). Each Stardea request is one more step of the same
 * conversation.
 *
 * @param deps - host faces (model, route sources, sessions).
 * @param cfg - resolved configuration.
 * @param input - the draft, session, mode, and caller signal.
 * @returns the success payload with its certificate, or a typed failure.
 */
export async function improveDraft(deps: ImproveDeps, cfg: ResolvedConfig, input: ImproveInput): Promise<ImproveOutcome> {
  // ---- local guards: refuse before any model traffic ----
  if (input.draft.trim() === '') return refuse(ERR.EMPTY, MESSAGE.EMPTY)
  // A leading slash token is the harness's command: rewrite only what follows it,
  // then put the prefix back verbatim. A command with no body has nothing to do.
  const split = splitCommand(input.draft)
  if (split.command !== '' && split.body === '') {
    return refuse(ERR.COMMAND, MESSAGE.COMMAND)
  }
  const draft = split.body
  if (charLength(draft) > cfg.maxInputChars) {
    return refuse(ERR.TOO_LONG, MESSAGE.tooLong(charLength(draft), cfg.maxInputChars))
  }
  const llm = deps.llm
  if (llm === undefined) return refuse(ERR.NO_ROUTE, MESSAGE.NO_LLM)

  let route: Route
  try {
    route = resolveRoute({
      dedicated: deps.dedicated,
      conversation: input.sessionId !== '' && deps.conversationModel !== undefined ? deps.conversationModel(input.sessionId) : undefined,
      defaults: deps.selection,
      lastSeen: deps.lastRoute ?? null,
    })
  } catch (error) {
    if (error instanceof NoRouteError) return refuse(ERR.NO_ROUTE, MESSAGE.NO_ROUTE)
    throw error
  }
  const started = Date.now()

  // ---- workspace knowledge: read first, like workspace instructions ----
  const store = cfg.knowledgeChars > 0 && input.sessionId !== '' ? deps.knowledge?.(input.sessionId) : undefined
  const knowledge = store !== undefined ? await loadKnowledge(store, cfg.knowledgeChars) : undefined

  // ---- context: the last turn always; more turns only when the draft cannot stand alone ----
  const trigger = cfg.smartContext && cfg.contextTurns > 0
    ? contextTrigger(draft)
    : { needed: false, reason: 'none' as const }
  const turnCount = trigger.needed ? cfg.contextTurns : Math.min(ALWAYS_KEPT_TURNS, cfg.contextTurns)
  let turns: HistoryTurn[] = []
  if (turnCount > 0 && input.sessionId !== '' && deps.sessions !== undefined) {
    // Context is an optimization, never a precondition: a broken session store
    // degrades to no context instead of failing the enhancement.
    try {
      turns = collectTurns(liveMessages(deps.sessions, input.sessionId), turnCount, cfg.contextChars)
    } catch { turns = [] }
  }
  const contextBlock = formatHistoryBlock(turns)
  const contextReason = trigger.needed ? trigger.reason : 'last-turn'

  // ---- attachments: the draft's own, then images of the turns kept above ----
  let current: readonly unknown[] = []
  if (input.attachments !== undefined && input.attachments.length > 0 && deps.readAttachments !== undefined) {
    // Like context, attachments only inform the rewrite (the agent receives them anyway),
    // so one that cannot be read is left out rather than failing the refinement.
    try {
      current = await deps.readAttachments(input.sessionId, input.attachments, input.signal)
    } catch {
      if (input.signal.aborted) return aborted()
      current = []
    }
  }
  const attachmentContent = buildAttachmentContent(turns, current)
  const attachmentExtra = attachmentContent.length > 0 ? [attachmentsPrompt()] : []

  const maxQuestions = input.maxQuestions ?? 0
  const lookupRounds = input.lookupRounds ?? 0
  const stardeaIdeas = input.stardeaIdeas ?? DEFAULT_STARDEA_IDEAS
  const stardeaRounds = input.stardeaRounds ?? 0
  // Answers survive a failed refinement so its retry skips the question panel. Keyed by
  // session, so a request without one (scripts) never shares answers.
  const memory = input.sessionId !== '' ? deps.answers : undefined
  let memo = memory?.recall(input.sessionId, draft)
  const policy = FOLLOW_UP_POLICY[input.mode]
  // Questions a recalled memo already used count against the cap.
  const recalledAsked = memo?.asked ?? 0
  let questionsLeft = Math.max(0, maxQuestions - recalledAsked)
  // Only invite questions when someone can answer them; otherwise the rewrite stays as before.
  // A recalled memo ends the asking, except in a mode that asks again after answers.
  const canAsk = maxQuestions > 0 && input.sessionId !== '' && deps.askUser !== undefined
    && (memo === undefined || (policy.askAgain && questionsLeft > 0))
  const ask = canAsk ? deps.askUser?.(input.sessionId) : undefined

  // ---- the refinement's one conversation: system prompt and tools fixed from here on ----
  const sources = lookupSources(deps, input, ask !== undefined)
  const instructions = ask !== undefined
    ? [questionsPrompt(maxQuestions), stardeaPrompt(stardeaIdeas, stardeaRounds), answersPrompt()]
    : memo !== undefined ? [answersPrompt()] : []
  const chat = new RefineChat({
    llm, route, config: cfg,
    lookups: new Lookups([...sources.session, ...sources.web]),
    system: (withTools) => buildSystemPrompt(input.mode, cfg, [...instructions, ...attachmentExtra, ...(withTools ? [lookupPrompt(lookupRounds)] : [])]),
  })
  // The rewrite steps share one round budget; the web serves Stardea ideas only.
  const rewriteBudget = new RoundBudget(lookupRounds)
  const rewriteTools = Lookups.namesOf(sources.session)
  const noTools: ReadonlySet<string> = new Set()

  let anchors = cfg.fidelityGate ? extractAnchors(draft) : []
  const maxRatio = maxRatioFor(cfg, input.mode)
  let enhanced = ''
  // Questions asked in this refinement; a recalled memo's are counted in `recalledAsked`.
  let askedCount = 0

  // Standard and Detailed end every user turn with where the questions stand; Light sends none.
  const statusNote = (state: FollowUpState): string => (policy.roundRules ? '\n\n' + followUpStatus(state) : '')
  const askState = (ended: 'limit' | 'unavailable'): FollowUpState =>
    (ask !== undefined && questionsLeft > 0 ? { kind: 'open', questionsLeft } : { kind: ended })

  // ---- first rewrite: may list missing information; a recalled memo answers it at once ----
  const first = await chat.step({
    // The knowledge opens the conversation, ahead of the task, like workspace instructions do.
    text: [knowledgeBlock(knowledge?.text ?? ''), buildUserMessage(draft, contextBlock, '', memo !== undefined ? formatAnswers(memo.answered) : '')]
      .filter((part) => part !== '').join('\n\n') + statusNote(askState(memo !== undefined ? 'limit' : 'unavailable')),
    content: attachmentContent,
  }, rewriteBudget, rewriteTools, input.signal)
  if (!first.ok) return failureOf(first.failure, cfg)
  let parsed = parseRewrite(first.text, ask !== undefined ? questionsForReply(policy, questionsLeft) : 0)
  enhanced = normalizeOutput(parsed.text)
  if (enhanced === '') return refuse(ERR.EMPTY_OUTPUT, MESSAGE.UNUSABLE_OUTPUT)

  // ---- follow-up rounds, with Stardea ideas on request ----
  // Light runs one round; Standard and Detailed ask one question per round until nothing is
  // missing or the cap is reached (FOLLOW_UP_POLICY).
  const ideaTools = Lookups.namesOf([...sources.session, ...sources.web])
  while (ask !== undefined && parsed.questions.length > 0) {
    const asked = parsed.questions
    askedCount += asked.length
    questionsLeft -= asked.length
    const questions = asked.map((question, index) => ({ id: questionId(index), question, header: QUESTION_HEADER }))
    // Settling the questions stops any idea request still running, so the rewrite never waits for one.
    const asking = new AbortController()
    const ideas = new IdeaBook()
    const stardea: Stardea = async (id, signal) => {
      const question = questions.find((candidate) => candidate.id === id)
      if (question === undefined || asking.signal.aborted) return refuse(ERR.NO_RUN, MESSAGE.NO_RUN)
      const result = await chat.step({ text: stardeaTurn(id, question.question, ideas.has(id), stardeaIdeas) },
        new RoundBudget(stardeaRounds), ideaTools, AbortSignal.any([signal, input.signal, asking.signal]))
      if (!result.ok) return failureOf(result.failure, cfg)
      const found = parseIdeas(result.text)
      if (found.length === 0) return refuse(ERR.EMPTY_OUTPUT, MESSAGE.NO_IDEAS)
      return { ok: true, ideas: ideas.add(id, found, stardeaIdeas) } satisfies StardeaOutcome
    }
    let reply: SeamAnswer | undefined
    try {
      reply = await ask(questions, input.signal, stardea)
    } catch {
      // Dismissed: the refinement is cancelled (checked below).
      reply = undefined
    } finally {
      asking.abort()
    }
    const answered = reply !== undefined ? answeredQuestions(asked, reply) : []
    // Remembered before the abort check: answers given just before a cancel still count.
    if (answered.length > 0) {
      memo = { asked: recalledAsked + askedCount, answered: [...(memo?.answered ?? []), ...answered] }
      memory?.remember(input.sessionId, draft, memo)
    }
    if (input.signal.aborted) return aborted()

    // Nothing answered (Skip): Light keeps the rewrite; Standard and Detailed rewrite with guesses.
    if (answered.length === 0 && !policy.guessOnSkip) break

    // ---- rewrite once more, in the same conversation ----
    const state: FollowUpState = answered.length === 0 ? { kind: 'skipped' } : policy.askAgain ? askState('limit') : { kind: 'limit' }
    const turn = answered.length > 0 ? answersTurn(formatAnswers(answered)) : skippedTurn()
    const next = await chat.step({ text: turn + statusNote(state) }, rewriteBudget, rewriteTools, input.signal)
    if (!next.ok) return failureOf(next.failure, cfg)
    parsed = parseRewrite(next.text, state.kind === 'open' ? questionsForReply(policy, questionsLeft) : 0)
    const folded = normalizeOutput(parsed.text)
    if (folded === '') return refuse(ERR.EMPTY_OUTPUT, MESSAGE.UNUSABLE_OUTPUT)
    enhanced = folded
  }

  // The length budget covers what the user supplied: the draft plus their answers.
  const lengthBase = memo !== undefined ? draft + '\n' + memo.answered.map((a) => a.answer).join('\n') : draft
  if (memo !== undefined && cfg.fidelityGate) anchors = extractAnchors(lengthBase)

  // ---- gates ----
  let fidelity = checkFidelity(anchors, enhanced)
  const verdict = cfg.lengthGate ? lengthVerdict(lengthBase, enhanced, maxRatio) : { kind: 'ok' as const, ratio: 1 }

  if ((fidelity.missing.length > 0 || verdict.kind === 'converge') && !input.signal.aborted) {
    const clauses: string[] = []
    if (verdict.kind === 'converge') clauses.push(lengthRepairClause(charLength(enhanced), verdict.charBudget))
    if (fidelity.missing.length > 0) clauses.push(repairClause(fidelity.missing))

    // The repair runs no lookups: it only reworks the rewrite already in the conversation.
    const repair = await chat.step({ text: clauses.join('\n').trim() }, new RoundBudget(0), noTools, input.signal)
    if (repair.ok) {
      const repaired = cleanRewrite(repair.text)
      if (repaired !== '') {
        enhanced = repaired
        fidelity = checkFidelity(anchors, enhanced)
      }
    }
  }
  if (input.signal.aborted) return aborted()

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
  const final = lengthVerdict(lengthBase, enhanced, maxRatio)
  if (cfg.lengthGate && reinjected === 0 && final.kind === 'converge') {
    return refuse(ERR.LENGTH_EXCEEDED, MESSAGE.lengthExceeded(charLength(enhanced), final.charBudget, formatRatio(final.ratio)))
  }

  // The answers did their job; a later click on the same draft asks afresh.
  memory?.forget(input.sessionId)
  const lookupsUsed = rewriteBudget.spent()
  const usage = chat.usage.report()
  if (store !== undefined && knowledge !== undefined) {
    const update = (): Promise<void> => updateKnowledge(chat, store, knowledge, cfg.knowledgeChars)
    if (deps.background !== undefined) deps.background(update)
    else void update()
  }
  return {
    ok: true,
    text: split.prefix + enhanced,
    meta: {
      mode: input.mode,
      // The agent's default selection may already carry the provider prefix
      // (e.g. model "zhipuai/glm-5.3-flash"); never render it twice.
      model: route.model.startsWith(route.provider + '/') ? route.model : route.provider + '/' + route.model,
      ratio: Math.round(final.ratio * 100) / 100,
      ratioLabel: formatRatio(final.ratio),
      elapsedMs: Date.now() - started,
      anchors: { total: fidelity.total, kept: fidelity.kept, reinjected },
      note: reinjected > 0 ? fidelityNote(fidelity.missing) : '',
      contextUsed: contextBlock !== '' ? contextReason : lookupsUsed > 0 ? 'lookup' : 'none',
      questions: { asked: recalledAsked + askedCount, answered: memo !== undefined ? memo.answered.length : 0 },
      lookups: lookupsUsed,
      ...(usage !== undefined ? { usage } : {}),
    },
  }
}

/**
 * After a successful refinement, one more turn of the same conversation asks the model to
 * update the workspace knowledge file; it writes only a changed, complete version. Runs
 * after the outcome is returned, so the user never waits for it, and its failures are
 * swallowed: the knowledge is a convenience, the rewrite is already in the composer.
 *
 * @param chat - the refinement's conversation (its prefix is cached, so the turn is cheap).
 * @param store - the workspace's knowledge file.
 * @param knowledge - what the model saw at the start; a clipped file is left alone.
 * @param maxChars - the file's size limit in codepoints.
 */
async function updateKnowledge(chat: RefineChat, store: KnowledgeStore, knowledge: LoadedKnowledge, maxChars: number): Promise<void> {
  if (!knowledge.complete) return
  try {
    // Its own signal: the request that started the refinement has already been answered.
    // The call is still bounded by the configured timeout.
    const reply = await chat.step({ text: knowledgeUpdateTurn(maxChars) }, new RoundBudget(0), new Set(), new AbortController().signal)
    if (!reply.ok) return
    const next = parseKnowledgeUpdate(reply.text, knowledge.text, maxChars)
    if (next !== null) await store.write(next)
  } catch { /* the knowledge stays as it was */ }
}
