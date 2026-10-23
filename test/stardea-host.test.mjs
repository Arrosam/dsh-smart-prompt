// Stardea (星念), host side. Black-box: every expected outcome comes from the Stardea working
// contract (requirements, HTTP API, host module API, model conversation), not from the code.
//
// Levels:
//  - Integration: improveDraft (lib/orchestrate.js) with a scripted model, a scripted follow-up
//    desk adapted to the ask-user seam (deps.askUser), a stub web search (deps.web), the 0.11
//    session lookup seam (deps.sessionMessages + input.lookupRounds) and the answer memory
//    (deps.answers).
//  - System: the HTTP route registered by apply (lib/index.js): POST /improve, /stardea,
//    /answer and /cancel driven through a fake request / response pair.
//
// Techniques:
//  - State transition: rewrite -> asking -> (Stardea click)* -> answered | skipped | cancelled;
//    failed click -> removed from the conversation again; run live -> finished (NO_RUN
//    afterwards); tools offered -> refused (plain from then on); failed answer -> retry reuses
//    the answers.
//  - Decision table: web_search offered = stardeaRounds > 0 AND stardeaWebSearch AND web service
//    AND questions possible;
//    answer composition = selected ideas x own words x left out (one part as-is, several as
//    `- part` lines); /improve asks = interactive
//    AND sessionId.
//  - EP: idea sources (web | conversation | proposal); Stardea failures (empty, upstream,
//    abort); bad bodies per endpoint; unknown run / unknown question / finished run.
//  - BVA: ideas per click 1 / 3 / 4 / 5; lookup rounds 0 / 1 and one round past the per-click
//    budget; usage fields 0 / missing / present.
//
// Migration (Stardea settings, 0.13): Stardea no longer borrows the rewrite's lookup rounds
// and web search is opt-in. `refine` therefore passes `stardeaRounds` (default: the same value
// as `rounds`) and `stardeaWebSearch: true` explicitly, so the cases keep their 0.12 intent; the
// route cases (SR-11, SR-13, SR-14) configure `stardeaRounds` / `stardeaWebSearch` in the raw
// settings. New-setting cases live in stardea-settings.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { isDeepStrictEqual } from 'node:util'
import { resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'
import { AnswerMemory } from '../lib/answer-memory.js'
import { apply } from '../lib/index.js'

const CFG = resolveConfig({})
const API = '/dsh-smart-prompt/api'
/**
 * The mode these cases run in. They exercise one panel holding every question (ids q1, q2),
 * one rewrite with the answers and Skip keeping the first rewrite: light keeps that single
 * round. Standard and detailed ask one question per round (standard-rounds.test.mjs covers
 * Stardea there). The route cases select it through the saved defaultMode.
 */
const PANEL_MODE = 'light'
/** A refinement left waiting must fail its test instead of hanging the file. */
const T = { timeout: 15000 }
const MAX_IDEAS_PER_CLICK = 4
const IDEA_SOURCES = ['web', 'conversation', 'proposal']
const WEB_TOOL = 'web_search'
const SEARCH_TOOL = 'search_session'
const READ_TOOL = 'read_session_messages'

// ================================================================ fixtures

const PATH = 'src/api/limit.ts'
/** Self-contained (no smart-context trigger); its one hard fact is PATH. */
const DRAFT = '给 ' + PATH + ' 里的接口加上限流'
const Q1 = '限流阈值是多少？'
const Q2 = '按什么维度限流？'
const WITH_GAPS = DRAFT + '。\n- 阈值：(TBD)\n- 维度：(TBD)\n<missing_info>\n<question>' + Q1 + '</question>\n<question>' + Q2 + '</question>\n</missing_info>'
const PLAIN = '为 ' + PATH + ' 里的接口增加限流。'
const PER_MINUTE = '每分钟 100 次'
const PER_HOUR = '每小时 1000 次'
const OWN = '突发可以放宽'
const BY_IP = '按 IP'
/** Keeps the draft's path and every answer used below, so no repair call follows it. */
const FOLDED = '给 ' + PATH + ' 里的接口加上限流：' + PER_MINUTE + '，' + PER_HOUR + '，' + OWN + '，' + BY_IP + '。'
/** Folds the q1 answer but drops the draft's path: exactly one repair call follows. */
const FOLDED_NO_PATH = '给接口加上限流：' + PER_MINUTE + '，' + PER_HOUR + '，' + OWN + '。'
const REPAIRED = '给 ' + PATH + ' 里的接口加上限流：' + PER_MINUTE + '，' + PER_HOUR + '，' + OWN + '。'

const IDEAS_1 = [['web', PER_MINUTE], ['conversation', '每分钟 60 次'], ['proposal', '每秒 10 次'], ['proposal', '按套餐分级']]
/** Its first entry repeats an earlier q1 idea and must be dropped. */
const IDEAS_2 = [['proposal', '每分钟 60 次'], ['proposal', PER_HOUR], ['web', '突发上限 20']]
const IDEAS_Q2 = [['conversation', BY_IP], ['proposal', '按用户']]

const typed = (text) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const modelReply = (text) => ({ role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text }] })
const LOOKUP_MARK = 'LOOKUP-MARK'
/** Transcript text no search query contains: a tool result quoting it proves a session search ran. */
const LOOKUP_HIT = '登录接口以后要加限流'
const TRANSCRIPT = [typed(LOOKUP_HIT + ' ' + LOOKUP_MARK), modelReply('好的，限流先按每分钟 60 次')]

const WEB_MARK = 'WEB-MARK 推荐的限流阈值'
const WEB_URL = 'https://example.com/rate-limit'
const WEB_RESULT = { content: WEB_MARK, sources: [{ url: WEB_URL, title: 'Rate limit guide', snippet: '100 per minute' }], truncated: false }

// ================================================================ harness

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

function untilAbort(signal) {
  return new Promise((resolve) => {
    if (signal === undefined || signal.aborted) { resolve(); return }
    const timer = setTimeout(resolve, 5000)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

/**
 * Scripted model. A step is `{ text?, tools?: [{ name, args }], usage?, throw?, finishError?,
 * hang? }` or a function `(options) => step`. Tool call ids are `call-<n>-<i>` (n = 1-based
 * call number) so they stay unique across the conversation. Every request is snapshotted as
 * JSON at call time: later mutation of the arrays the plugin passed cannot fake a prefix.
 */
function stubLlm(script) {
  const calls = []
  const live = []
  return {
    calls,
    live,
    stream(options) {
      const n = calls.length + 1
      // `tools: []` and no `tools` key both mean "no tools"; only that meaning is compared.
      const tools = Array.isArray(options.tools) && options.tools.length > 0 ? clone(options.tools) : undefined
      calls.push({ system: clone(options.system), messages: clone(options.messages), tools })
      live.push(options)
      let step = script.length > 0 ? script.shift() : { text: '' }
      if (typeof step === 'function') step = step(options)
      return (async function* () {
        if (step.hang === true) { await untilAbort(options.signal); return }
        if (step.throw !== undefined) throw new Error(step.throw)
        if (step.finishError !== undefined) {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: step.finishError, code: 'X' } } }
          return
        }
        let index = 0
        if (step.text !== undefined && step.text !== '') {
          yield { type: 'text-delta', index, text: step.text }
          yield { type: 'block-end', index, block: { type: 'text', text: step.text } }
          index += 1
        }
        for (const [i, call] of (step.tools ?? []).entries()) {
          const id = 'call-' + String(n) + '-' + String(i + 1)
          const args = JSON.stringify(call.args)
          yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: args }
          yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: args } }
          index += 1
        }
        if (step.usage !== undefined) yield { type: 'usage', usage: step.usage }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/**
 * A scripted follow-up desk adapted to the ask-user seam: `askUser(sessionId)` returns
 * `ask(questions, signal, stardea)`, which runs `script({ questions, stardea, signal, click })`
 * and resolves to `{ answers: <the script's result> }`; a script that throws makes ask reject,
 * which the contract reads as "skipped". `click(id)` calls the Stardea function with the ask
 * signal and records its result.
 */
function stubDesk(script = async () => []) {
  const log = { sessions: [], asked: [], results: [], stardea: null }
  const askUser = (sessionId) => {
    log.sessions.push(sessionId)
    return async (questions, signal, stardea) => {
      log.asked.push(clone(questions))
      log.stardea = stardea
      const click = async (id) => {
        const result = await stardea(id, signal)
        log.results.push(result)
        return result
      }
      return { answers: await script({ questions, stardea, signal, click }) }
    }
  }
  return { log, askUser }
}

/** DSH web search stub; `result` may be an Error to reject with. */
function stubWeb(result = WEB_RESULT) {
  const calls = []
  return {
    calls,
    search: async (request, signal) => {
      calls.push({ request: clone(request), signal })
      if (result instanceof Error) throw result
      return result
    },
  }
}

/** One improveDraft run; `messages: null` leaves the session reader out. */
async function refine({ script, desk, web, rounds = 3, stardeaRounds = rounds, messages = TRANSCRIPT, answers, controller = new AbortController(), input = {}, deps = {} }) {
  const llm = stubLlm(script)
  const out = await improveDraft(
    {
      llm,
      selection: { provider: 'p', model: 'm' },
      lastRoute: null,
      sessionMessages: messages === null ? undefined : async () => messages,
      askUser: desk?.askUser,
      web,
      answers,
      ...deps,
    },
    CFG,
    { draft: DRAFT, sessionId: 's1', mode: PANEL_MODE, signal: controller.signal, maxQuestions: 5, lookupRounds: rounds, stardeaRounds, stardeaWebSearch: true, ...input },
  )
  return { out, llm }
}

const textOf = (message) => (message === undefined ? '' : (message.content ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).join(''))
const lastUserText = (call) => textOf([...call.messages].reverse().find((m) => m.role === 'user'))
const allText = (call) => call.messages.map(textOf).join('\n')
const toolResult = (call, id) => call.messages.find((m) => m.role === 'tool' && m.toolCallId === id)
/** Ids of the session searches whose results `call` still carries (results quote the transcript). */
const lookupsRun = (call) => call.messages.filter((m) => m.role === 'tool' && textOf(m).includes(LOOKUP_HIT)).map((m) => m.toolCallId)
const offersTools = (call) => Array.isArray(call.tools) && call.tools.length > 0
const toolNames = (call) => (call.tools ?? []).map((t) => t.name).sort()
const ideasXml = (pairs, prose = '') => prose + '<ideas>\n' + pairs.map(([source, text]) => '<idea source="' + source + '">' + text + '</idea>').join('\n') + '\n</ideas>'
const textsOf = (result) => result.ideas.map((idea) => idea.text)
const webCall = (query) => ({ name: WEB_TOOL, args: { query } })
const searchCall = (query) => ({ name: SEARCH_TOOL, args: { query } })

/** Assert `needles` all occur in `haystack`, in this order. */
function assertInOrder(haystack, needles, label) {
  const at = needles.map((needle) => haystack.indexOf(needle))
  assert.ok(at.every((i) => i >= 0), label + ': every part is present ' + JSON.stringify({ needles, at, haystack }))
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i - 1] < at[i], label + ': ' + needles[i - 1] + ' before ' + needles[i])
}

/**
 * Requirement 2: for every consecutive pair from `from` on, the later call's messages start
 * with ALL of the earlier call's messages, and system and tools are identical. Only for runs
 * without a failed step (see assertStepDropped).
 */
function assertAppendOnly(calls, { from = 0 } = {}) {
  for (let i = from + 1; i < calls.length; i += 1) {
    const prev = calls[i - 1]
    const next = calls[i]
    assert.ok(next.messages.length >= prev.messages.length, 'call ' + String(i) + ' is not shorter than call ' + String(i - 1))
    assert.deepEqual(next.messages.slice(0, prev.messages.length), prev.messages, 'call ' + String(i) + ' repeats call ' + String(i - 1) + ' as its prefix')
    assert.deepEqual(next.system, prev.system, 'call ' + String(i) + ' has the same system prompt')
    assert.deepEqual(next.tools, prev.tools, 'call ' + String(i) + ' offers the same tools')
  }
}

/**
 * Model conversation: a failed or cancelled step is removed from the conversation again.
 * `failed` is that step's single call, built on call `before` and its reply; call `next` (the
 * following step) starts from the messages as they were before the failed step and carries
 * none of the failed step's own request messages.
 */
function assertStepDropped(calls, { before, failed, next }) {
  const base = calls[failed].messages.slice(0, calls[before].messages.length + 1)
  assert.deepEqual(calls[next].messages.slice(0, base.length), base, 'call ' + String(next) + ' starts from the conversation before the failed step')
  const dropped = calls[failed].messages.slice(base.length)
  assert.ok(dropped.length > 0, 'the failed step appended its own request')
  for (const message of calls[next].messages.slice(base.length)) {
    assert.ok(!dropped.some((gone) => isDeepStrictEqual(gone, message)), 'the failed step is not in call ' + String(next) + ': ' + JSON.stringify(message))
  }
  assert.deepEqual(calls[next].system, calls[before].system)
  assert.deepEqual(calls[next].tools, calls[before].tools)
}

/**
 * Answer composition: one part alone is used as-is; several are listed one per line as `- part`.
 * Only the answer text is checked: whatever label introduces it may share the first line.
 */
function assertAnswerParts(text, { asIs = [], listed = [] }, label) {
  const list = listed.map((part) => '- ' + part).join('\n')
  if (listed.length > 0) assert.ok(text.includes(list), label + ': ' + JSON.stringify(list) + ' in ' + JSON.stringify(text))
  for (const part of asIs) assert.ok(text.includes(part) && !text.includes('- ' + part), label + ': ' + part + ' is used as-is, not listed, in ' + JSON.stringify(text))
}

/**
 * The whole refinement in one run (8 calls):
 *  0 rewrite lookup round | 1 rewrite | 2 click q1 web round | 3 click q1 ideas |
 *  4 click q1 again | 5 click q2 | 6 rewrite with answers | 7 repair.
 */
const CALL = { lookupRound: 0, rewrite: 1, click1Round: 2, click1: 3, click2: 4, clickQ2: 5, answers: 6, repair: 7 }

async function fullRefinement({ usage } = {}) {
  const web = stubWeb()
  const desk = stubDesk(async ({ click }) => {
    await click('q1')
    await click('q1')
    await click('q2')
    return [{ id: 'q1', selected: [PER_MINUTE, PER_HOUR], custom: OWN }, { id: 'q2', selected: [], custom: '' }]
  })
  const script = [
    { tools: [searchCall(LOOKUP_MARK)] },
    { text: WITH_GAPS },
    { tools: [webCall('API 限流 阈值 推荐')] },
    { text: ideasXml(IDEAS_1) },
    { text: ideasXml(IDEAS_2) },
    { text: ideasXml(IDEAS_Q2) },
    { text: FOLDED_NO_PATH },
    { text: REPAIRED },
  ].map((step, i) => (usage === undefined ? step : { ...step, usage: usage(i) }))
  const { out, llm } = await refine({ script, desk, web })
  return { out, llm, web, desk, results: desk.log.results }
}

// ================================================================ one append-only conversation (requirement 2)

test('ST-01 [State append-only] every call of the refinement repeats the previous call as its prefix, followed by its reply', T, async () => {
  const { out, llm } = await fullRefinement()
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 8, 'lookup round + rewrite + click (web round + ideas) + click + click + answers rewrite + repair')
  assertAppendOnly(llm.calls)
  for (let i = 1; i < llm.calls.length; i += 1) {
    const after = llm.calls[i].messages[llm.calls[i - 1].messages.length]
    assert.equal(after?.role, 'assistant', 'call ' + String(i) + ' continues with call ' + String(i - 1) + "'s reply")
  }
  const rewriteReply = llm.calls[CALL.click1Round].messages[llm.calls[CALL.rewrite].messages.length]
  assert.ok(textOf(rewriteReply).includes(Q1), 'the first rewrite reply is kept in the conversation')
})

test('ST-02 [EP tools] with rounds > 0, a session, a web service and a desk, every call offers the two lookup tools and web_search', T, async () => {
  const { llm } = await fullRefinement()
  assert.deepEqual(toolNames(llm.calls[0]), [READ_TOOL, SEARCH_TOOL, WEB_TOOL])
  const web = llm.calls[0].tools.find((t) => t.name === WEB_TOOL)
  assert.equal(typeof web.description, 'string')
  assert.ok(JSON.stringify(web.parameters).includes('query'), 'web_search takes { query }')
  for (const call of llm.calls) assert.deepEqual(toolNames(call), [READ_TOOL, SEARCH_TOOL, WEB_TOOL])
})

test('ST-03 [State] session lookup and web results from earlier calls are still in the last call', T, async () => {
  const { llm } = await fullRefinement()
  const last = llm.calls[CALL.repair]
  const lookup = toolResult(last, 'call-1-1')
  assert.ok(lookup !== undefined, 'the rewrite lookup result is still in the repair call')
  assert.ok(textOf(lookup).includes(LOOKUP_MARK), textOf(lookup))
  const web = toolResult(last, 'call-3-1')
  assert.ok(web !== undefined, 'the Stardea web result is still in the repair call')
  assert.ok(textOf(web).includes(WEB_MARK) || textOf(web).includes(WEB_URL), textOf(web))
})

test('ST-04 [State tools refused] a route rejecting tools on the first call: same messages again without tools, and no tools from then on', T, async () => {
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
  const { out, llm } = await refine({
    desk,
    web: stubWeb(),
    script: [{ throw: 'tools unsupported' }, { text: WITH_GAPS }, { text: ideasXml(IDEAS_1) }],
  })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 3)
  assert.ok(offersTools(llm.calls[0]))
  assert.deepEqual(llm.calls.slice(1).map(offersTools), [false, false])
  // Assumption: the system prompt may change together with the tools on this one retry; the
  // contract names only the tools as the exception, so only the message prefix is compared here.
  assert.deepEqual(llm.calls[1].messages.slice(0, llm.calls[0].messages.length), llm.calls[0].messages, 'the retry repeats the failed request as its prefix')
  assertAppendOnly(llm.calls, { from: 1 })
  assert.equal(desk.log.results[0]?.ok, true, 'Stardea still works without tools (direct proposals)')
})

test('ST-05 [State concurrency] two Stardea clicks started together are still one append-only conversation', T, async () => {
  // Assumption: concurrent clicks are serialized; the contract requires every call to repeat
  // the previous one, which two parallel calls could not.
  const mentioned = []
  const answerFor = (options) => {
    const text = lastUserText(options)
    const which = text.includes(Q2) && !text.includes(Q1) ? 'q2' : text.includes(Q1) && !text.includes(Q2) ? 'q1' : '?'
    mentioned.push(which)
    return { text: ideasXml(which === 'q2' ? IDEAS_Q2 : IDEAS_1) }
  }
  const desk = stubDesk(async ({ click }) => {
    const [a, b] = await Promise.all([click('q1'), click('q2')])
    desk.log.pair = [a, b]
    return []
  })
  const { out, llm } = await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }, answerFor, answerFor] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 3)
  assertAppendOnly(llm.calls)
  const [a, b] = desk.log.pair
  assert.ok(a.ok && b.ok, JSON.stringify(desk.log.pair))
  // Routing is only checkable when each Stardea request names exactly its own question.
  if (!mentioned.includes('?')) {
    assert.deepEqual(textsOf(a), IDEAS_1.map(([, t]) => t), 'q1 got the q1 ideas')
    assert.deepEqual(textsOf(b), IDEAS_Q2.map(([, t]) => t), 'q2 got the q2 ideas')
  }
})

// ================================================================ Stardea ideas (requirements 3 and 4)

test('ST-06 [EP first click] the first click returns the 4 ideas with their sources and string ids', T, async () => {
  const { results } = await fullRefinement()
  const first = results[0]
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.ideas.length, MAX_IDEAS_PER_CLICK)
  assert.deepEqual(textsOf(first), IDEAS_1.map(([, t]) => t))
  assert.deepEqual(first.ideas.map((i) => i.source), IDEAS_1.map(([s]) => s))
  for (const idea of first.ideas) {
    assert.equal(typeof idea.id, 'string')
    assert.ok(idea.id.length > 0)
    assert.ok(IDEA_SOURCES.includes(idea.source), idea.source)
  }
})

test('ST-07 [State later click] a second click returns only NEW ideas: a repeat of an earlier idea is dropped', T, async () => {
  const { results } = await fullRefinement()
  const [first, second] = results
  assert.equal(second.ok, true, JSON.stringify(second))
  assert.deepEqual(textsOf(second), [PER_HOUR, '突发上限 20'])
  assert.deepEqual(second.ideas.map((i) => i.source), ['proposal', 'web'])
  for (const text of textsOf(second)) assert.ok(!textsOf(first).includes(text), 'not repeated: ' + text)
})

test('ST-08 [EP ids] idea ids are unique within the run, across clicks and questions', T, async () => {
  const { results } = await fullRefinement()
  assert.equal(results.length, 3)
  assert.ok(results.every((r) => r.ok), JSON.stringify(results))
  const ids = results.flatMap((r) => r.ideas.map((i) => i.id))
  assert.equal(new Set(ids).size, ids.length, JSON.stringify(ids))
  assert.deepEqual(textsOf(results[2]), [BY_IP, '按用户'], 'q2 has its own ideas')
})

test('ST-09 [EP request] each Stardea call asks about its question', T, async () => {
  // Assumption: the Stardea request is a user message that quotes the question text.
  const { llm } = await fullRefinement()
  assert.ok(lastUserText(llm.calls[CALL.click1Round]).includes(Q1))
  assert.ok(lastUserText(llm.calls[CALL.click2]).includes(Q1))
  assert.ok(lastUserText(llm.calls[CALL.clickQ2]).includes(Q2))
})

test('ST-10 [BVA ideas per click] 1, 3 and 4 ideas come back as given; a fifth idea is cut', T, async () => {
  const pool = ['甲方案', '乙方案', '丙方案', '丁方案', '戊方案']
  for (const [count, expected] of [[1, 1], [3, 3], [4, 4], [5, 4]]) {
    const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
    const offered = pool.slice(0, count)
    const { out } = await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }, { text: ideasXml(offered.map((t) => ['proposal', t])) }] })
    assert.equal(out.ok, true, JSON.stringify(out))
    const result = desk.log.results[0]
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(textsOf(result), offered.slice(0, expected), 'count ' + String(count))
  }
})

test('ST-11 [EP parse] ideas are read from the <ideas> block, with prose around it and whitespace inside an idea', T, async () => {
  // Assumption: an idea's text is its element content with surrounding whitespace trimmed.
  const reply = '下面是几个方案：\n<ideas>\n  <idea source="web">\n    ' + PER_MINUTE + '\n  </idea>\n  <idea source="conversation">每分钟 60 次</idea>\n  <idea source="proposal">按套餐分级</idea>\n</ideas>\n以上。'
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
  await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }, { text: reply }] })
  const result = desk.log.results[0]
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(textsOf(result), [PER_MINUTE, '每分钟 60 次', '按套餐分级'])
  assert.deepEqual(result.ideas.map((i) => i.source), ['web', 'conversation', 'proposal'])
})

test('ST-11b [EP source] an idea with an unknown source attribute never comes back with a source outside web | conversation | proposal', T, async () => {
  // Assumption: such an idea is either dropped or re-labelled; both are accepted.
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
  await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }, { text: ideasXml([['magic', '甲方案'], ['proposal', '乙方案']]) }] })
  const result = desk.log.results[0]
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.ok(textsOf(result).includes('乙方案'))
  for (const idea of result.ideas) assert.ok(IDEA_SOURCES.includes(idea.source), idea.source)
})

test('ST-12 [EP unknown question] an unknown questionId answers NO_RUN without a model call', T, async () => {
  const desk = stubDesk(async ({ click }) => {
    for (const id of ['q0', 'q3', 'x']) await click(id)
    return []
  })
  const { out, llm } = await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }] })
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 1, 'no Stardea call was made')
  for (const result of desk.log.results) {
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NO_RUN', JSON.stringify(result))
  }
})

test('ST-13 [State finished] Stardea after the refinement has finished answers NO_RUN without a model call', T, async () => {
  const desk = stubDesk(async () => [])
  const { out, llm } = await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }, { text: ideasXml(IDEAS_1) }] })
  assert.equal(out.ok, true)
  assert.equal(typeof desk.log.stardea, 'function')
  const late = await desk.log.stardea('q1', new AbortController().signal)
  assert.equal(late.ok, false)
  assert.equal(late.code, 'NO_RUN')
  assert.equal(llm.calls.length, 1)
})

test('ST-14 [EP empty] an empty Stardea reply fails that click with EMPTY_OUTPUT; the refinement still finishes with the answers', T, async () => {
  // Assumption: an empty model reply maps to the existing EMPTY_OUTPUT code.
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [{ id: 'q1', selected: [], custom: PER_MINUTE }] })
  const { out, llm } = await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }, { text: '' }, { text: FOLDED }] })
  assert.deepEqual([desk.log.results[0].ok, desk.log.results[0].code], [false, 'EMPTY_OUTPUT'])
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.text, FOLDED)
  assert.equal(llm.calls.length, 3)
  assertStepDropped(llm.calls, { before: 0, failed: 1, next: 2 })
})

test('ST-15 [EP upstream] a Stardea call that throws fails that click with UPSTREAM; the refinement still finishes', T, async () => {
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [{ id: 'q1', selected: [], custom: PER_MINUTE }] })
  const { out, llm } = await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }, { throw: 'gateway exploded' }, { text: FOLDED }] })
  assert.deepEqual([desk.log.results[0].ok, desk.log.results[0].code], [false, 'UPSTREAM'])
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.text, FOLDED)
  assert.equal(llm.calls.length, 3)
  assertStepDropped(llm.calls, { before: 0, failed: 1, next: 2 })
})

// ================================================================ web search and lookup rounds

test('ST-16 [EP web tool] a web_search call hits deps.web.search and its result comes back as a tool-result message', T, async () => {
  const { llm, web } = await fullRefinement()
  assert.equal(web.calls.length, 1)
  assert.equal(web.calls[0].request.query, 'API 限流 阈值 推荐')
  const result = toolResult(llm.calls[CALL.click1], 'call-3-1')
  assert.ok(result !== undefined, 'the call after the round carries the tool result')
  assert.equal(result.content[0].type, 'text')
  assert.ok(textOf(result).includes(WEB_MARK) || textOf(result).includes(WEB_URL), textOf(result))
  assert.deepEqual(result.source, { kind: 'tool', callId: 'call-3-1' })
})

test('ST-17 [Decision] web_search is offered only for rounds > 0 AND a web service AND questions possible', T, async () => {
  const rows = [
    { name: 'all true, session readable', rounds: 3, web: true, desk: 'desk', messages: true, tools: [READ_TOOL, SEARCH_TOOL, WEB_TOOL] },
    { name: 'all true, no session reader', rounds: 3, web: true, desk: 'desk', messages: false, tools: [WEB_TOOL] },
    { name: 'no web service', rounds: 3, web: false, desk: 'desk', messages: true, tools: [READ_TOOL, SEARCH_TOOL] },
    { name: 'no follow-up seam', rounds: 3, web: true, desk: 'none', messages: true, tools: [READ_TOOL, SEARCH_TOOL] },
    { name: 'no desk for this session', rounds: 3, web: true, desk: 'undefined', messages: true, tools: [READ_TOOL, SEARCH_TOOL] },
    { name: 'rounds 0', rounds: 0, web: true, desk: 'desk', messages: true, tools: [] },
  ]
  for (const row of rows) {
    const desk = row.desk === 'desk' ? stubDesk() : undefined
    const deps = row.desk === 'undefined' ? { askUser: () => undefined } : {}
    const { out, llm } = await refine({
      rounds: row.rounds, web: row.web ? stubWeb() : undefined, desk, deps, messages: row.messages ? TRANSCRIPT : null, script: [{ text: PLAIN }],
    })
    assert.equal(out.ok, true, row.name + ': ' + JSON.stringify(out))
    assert.deepEqual(toolNames(llm.calls[0]), row.tools, row.name)
    if (row.tools.length === 0) assert.equal(offersTools(llm.calls[0]), false, row.name + ': no tools at all')
  }
})

test('ST-18 [BVA rounds 0] lookup rounds 0: no call offers tools; each click is one direct-proposal call; the web is never searched', T, async () => {
  const web = stubWeb()
  const desk = stubDesk(async ({ click }) => { await click('q1'); await click('q1'); return [] })
  const { out, llm } = await refine({ rounds: 0, web, desk, script: [{ text: WITH_GAPS }, { text: ideasXml(IDEAS_1) }, { text: ideasXml(IDEAS_2) }] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 3, 'rewrite + one call per click')
  assert.deepEqual(llm.calls.map(offersTools), [false, false, false])
  assert.equal(web.calls.length, 0)
  assert.equal(desk.log.results[0].ideas.length, MAX_IDEAS_PER_CLICK)
  assert.deepEqual(textsOf(desk.log.results[1]), [PER_HOUR, '突发上限 20'])
  assertAppendOnly(llm.calls)
})

test('ST-19 [BVA rounds 1] every click has its own round budget, independent of the rewrite and of earlier clicks', T, async () => {
  const web = stubWeb()
  const desk = stubDesk(async ({ click }) => { await click('q1'); await click('q1'); return [] })
  const { out, llm } = await refine({
    rounds: 1,
    web,
    desk,
    script: [
      { tools: [searchCall(LOOKUP_MARK)] }, // the rewrite uses its one round
      { text: WITH_GAPS },
      { tools: [webCall('first click')] }, // the first click uses its own round
      { text: ideasXml(IDEAS_1) },
      { tools: [webCall('second click')] }, // and so does the second
      { text: ideasXml([['web', PER_HOUR]]) },
    ],
  })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 6)
  assert.deepEqual(web.calls.map((c) => c.request.query), ['first click', 'second click'])
  assert.equal(desk.log.results[0].ok, true, JSON.stringify(desk.log.results[0]))
  assert.deepEqual(textsOf(desk.log.results[1]), [PER_HOUR])
})

test('ST-20 [BVA rounds 1 + 1] a click never runs more search rounds than its Stardea round budget', T, async () => {
  // Outcome of the over-budget reply is unspecified; only the number of searches is asserted.
  const web = stubWeb()
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
  await refine({
    rounds: 1,
    web,
    desk,
    script: [{ text: WITH_GAPS }, { tools: [webCall('one')] }, { tools: [webCall('two')] }, { text: ideasXml(IDEAS_1) }],
  })
  assert.deepEqual(web.calls.map((c) => c.request.query), ['one'])
})

test('ST-34 [BVA shared rewrite budget] the first rewrite and the rewrite with answers share the rounds; Stardea rounds do not count', T, async () => {
  // Rewrite rounds are session lookups (the rewrite lookup budget is 0.11 behaviour); the
  // contract ties online search to Stardea clicks, so the click's round is a web search.
  // `lookups` = ids of the session searches that ran (their results quote the transcript).
  const answer = [{ id: 'q1', selected: [], custom: PER_MINUTE }]
  const rows = [
    {
      name: 'rounds 1, used by the first rewrite: the answers rewrite cannot search',
      rounds: 1, click: false,
      script: [{ tools: [searchCall(LOOKUP_MARK)] }, { text: WITH_GAPS }, { tools: [searchCall(LOOKUP_MARK)] }, { text: FOLDED }, { text: FOLDED }],
      lookups: ['call-1-1'], searched: [],
    },
    {
      name: 'rounds 2: one round each for the first rewrite and the answers rewrite',
      rounds: 2, click: false,
      script: [{ tools: [searchCall(LOOKUP_MARK)] }, { text: WITH_GAPS }, { tools: [searchCall(LOOKUP_MARK)] }, { text: FOLDED }],
      lookups: ['call-1-1', 'call-3-1'], searched: [], ok: true,
    },
    {
      name: 'rounds 1, used by a click: the answers rewrite still has its round',
      rounds: 1, click: true,
      script: [{ text: WITH_GAPS }, { tools: [webCall('click')] }, { text: ideasXml(IDEAS_1) }, { tools: [searchCall(LOOKUP_MARK)] }, { text: FOLDED }],
      lookups: ['call-4-1'], searched: ['click'], ok: true,
    },
  ]
  for (const row of rows) {
    const web = stubWeb()
    const desk = stubDesk(async ({ click }) => { if (row.click) await click('q1'); return answer })
    const { out, llm } = await refine({ rounds: row.rounds, web, desk, script: row.script })
    assert.deepEqual([...new Set(llm.calls.flatMap(lookupsRun))], row.lookups, row.name + ': session searches run')
    assert.deepEqual(web.calls.map((c) => c.request.query), row.searched, row.name + ': web searches run')
    if (row.ok === true) {
      assert.equal(out.ok, true, row.name + ': ' + JSON.stringify(out))
      assert.equal(out.text, FOLDED, row.name)
    }
  }
})

test('ST-35 [EP duplicates] a click with only repeated ideas returns no new ones; an idea of another question is not a duplicate', T, async () => {
  // Assumption: a click whose ideas are all repeats may answer ok with [] or fail; it never
  // returns a repeat.
  const desk = stubDesk(async ({ click }) => { await click('q1'); await click('q1'); await click('q2'); return [] })
  await refine({
    rounds: 0, messages: null, desk,
    script: [{ text: WITH_GAPS }, { text: ideasXml(IDEAS_1) }, { text: ideasXml(IDEAS_1) }, { text: ideasXml([['proposal', PER_MINUTE]]) }],
  })
  const [first, repeat, other] = desk.log.results
  assert.equal(first.ok, true)
  if (repeat.ok) assert.deepEqual(repeat.ideas, [], 'nothing new')
  assert.equal(other.ok, true, JSON.stringify(other))
  assert.deepEqual(textsOf(other), [PER_MINUTE], 'duplicates are dropped per question only')
})

test('ST-21 [EP rewrite web] a web_search call in the rewrite step is answered with a tool result and the rewrite still finishes', T, async () => {
  // The contract offers web_search for the whole refinement (fixed tools keep every request
  // cache-identical) but names online search only for Stardea clicks (requirement 3). Whether a
  // rewrite-step call really searches is unspecified: at most one search, with its own query.
  const web = stubWeb()
  const { out, llm } = await refine({ web, desk: stubDesk(), script: [{ tools: [webCall('rewrite query')] }, { text: PLAIN }] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.ok(['[]', '["rewrite query"]'].includes(JSON.stringify(web.calls.map((c) => c.request.query))), JSON.stringify(web.calls.map((c) => c.request)))
  assert.ok(toolResult(llm.calls[1], 'call-1-1') !== undefined)
  assert.equal(out.text, PLAIN)
})

test('ST-22 [EP web failure] a failing web search does not fail the click; the call still gets a tool result', T, async () => {
  // Assumption: like a failing session load (0.11), a search failure degrades instead of failing.
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
  const { out, llm } = await refine({
    web: stubWeb(new Error('search service down')),
    desk,
    script: [{ text: WITH_GAPS }, { tools: [webCall('x')] }, { text: ideasXml(IDEAS_1) }],
  })
  assert.equal(out.ok, true)
  assert.equal(desk.log.results[0].ok, true, JSON.stringify(desk.log.results[0]))
  assert.equal(desk.log.results[0].ideas.length, MAX_IDEAS_PER_CLICK)
  assert.ok(toolResult(llm.calls[2], 'call-2-1') !== undefined)
})

// ================================================================ answers (requirement 5)

test('ST-23 [EP desk] the desk is taken for the request session and shown the parsed questions with ids q1, q2', T, async () => {
  const desk = stubDesk(async () => [])
  await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }] })
  assert.ok(desk.log.sessions.length >= 1)
  assert.ok(desk.log.sessions.every((s) => s === 's1'), JSON.stringify(desk.log.sessions))
  assert.equal(desk.log.asked.length, 1, 'asked once')
  assert.deepEqual(desk.log.asked[0].map(({ id, question }) => ({ id, question })), [{ id: 'q1', question: Q1 }, { id: 'q2', question: Q2 }])
  for (const q of desk.log.asked[0]) assert.equal(typeof q.header, 'string', 'every question has a header: ' + JSON.stringify(q))
})

test('ST-24 [State full] selected ideas then own words are folded in; unselected ideas and skipped questions are not; one repair follows', T, async () => {
  const { out, llm } = await fullRefinement()
  const folded = lastUserText(llm.calls[CALL.answers])
  assertInOrder(folded, [Q1, PER_MINUTE, PER_HOUR, OWN], 'answers message')
  assertAnswerParts(folded, { listed: [PER_MINUTE, PER_HOUR, OWN] }, 'answers message')
  assert.ok(!folded.includes('每秒 10 次'), 'an unselected idea is not an answer')
  assert.ok(!folded.includes(BY_IP), 'the skipped question carries no answer')
  assert.ok(lastUserText(llm.calls[CALL.repair]).includes(PATH), 'the repair names the dropped fact')
  assert.equal(out.text, REPAIRED)
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 1 })
})

test('ST-25 [Decision answer composition] selected ideas x own words x left out', T, async () => {
  const rows = [
    { name: 'own words only', answers: [{ id: 'q1', selected: [], custom: PER_MINUTE }], answered: 1, order: [Q1, PER_MINUTE], asIs: [PER_MINUTE] },
    { name: 'one idea, no custom key', answers: [{ id: 'q1', selected: [PER_MINUTE] }], answered: 1, order: [Q1, PER_MINUTE], asIs: [PER_MINUTE] },
    { name: 'one idea and own words', answers: [{ id: 'q1', selected: [PER_MINUTE], custom: OWN }], answered: 1, order: [Q1, PER_MINUTE, OWN], listed: [PER_MINUTE, OWN] },
    { name: 'two ideas and own words', answers: [{ id: 'q1', selected: [PER_MINUTE, PER_HOUR], custom: OWN }], answered: 1, order: [Q1, PER_MINUTE, PER_HOUR, OWN], listed: [PER_MINUTE, PER_HOUR, OWN] },
    { name: 'q1 left out, q2 answered', answers: [{ id: 'q2', selected: [BY_IP] }], answered: 1, order: [Q2, BY_IP], asIs: [BY_IP] },
    { name: 'empty q1 next to answered q2', answers: [{ id: 'q1', selected: [], custom: '' }, { id: 'q2', selected: [BY_IP] }], answered: 1, order: [Q2, BY_IP], asIs: [BY_IP] },
    { name: 'both answered', answers: [{ id: 'q1', selected: [PER_MINUTE] }, { id: 'q2', selected: [], custom: BY_IP }], answered: 2, order: [Q1, PER_MINUTE, Q2, BY_IP], asIs: [PER_MINUTE, BY_IP] },
  ]
  for (const row of rows) {
    const { out, llm } = await refine({ rounds: 0, messages: null, desk: stubDesk(async () => row.answers), script: [{ text: WITH_GAPS }, { text: FOLDED }] })
    assert.equal(out.ok, true, row.name + ': ' + JSON.stringify(out))
    assert.equal(llm.calls.length, 2, row.name + ': rewrite + rewrite with answers')
    assertInOrder(lastUserText(llm.calls[1]), row.order, row.name)
    assertAnswerParts(lastUserText(llm.calls[1]), row, row.name)
    assert.deepEqual(out.meta.questions, { asked: 2, answered: row.answered }, row.name)
    assert.equal(out.text, FOLDED, row.name)
  }
})

test('ST-26 [EP all skipped] [], undefined, empty or whitespace answers, or a rejected ask keep the first rewrite with its (TBD) notes, no further call', T, async () => {
  // Assumption: whitespace-only own words count as empty.
  const replies = [
    ['[]', []],
    ['undefined', undefined],
    ['all empty', [{ id: 'q1', selected: [], custom: '' }, { id: 'q2', selected: [], custom: '   ' }]],
    ['one empty, one left out', [{ id: 'q1', selected: [] }]],
    ['ask rejects (skipped)', new Error('dismissed')],
  ]
  for (const [name, reply] of replies) {
    const desk = stubDesk(async () => { if (reply instanceof Error) throw reply; return reply })
    const { out, llm } = await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }, { text: FOLDED }] })
    assert.equal(out.ok, true, name + ': ' + JSON.stringify(out))
    assert.equal(llm.calls.length, 1, name)
    assert.match(out.text, /\(TBD\)/, name)
    assert.equal(out.text.includes('missing_info'), false, name)
  }
})

test('ST-27 [State] skipping after Stardea clicks keeps the first rewrite; only the click calls were made', T, async () => {
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
  const { out, llm } = await refine({ rounds: 0, messages: null, desk, script: [{ text: WITH_GAPS }, { text: ideasXml(IDEAS_1) }, { text: FOLDED }] })
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 2)
  assert.match(out.text, /\(TBD\)/)
})

// ================================================================ cancel and retry

test('ST-28 [State cancel] aborting the request while the questions are open ends as ABORTED, with no rewrite with answers', T, async () => {
  for (const lateAnswers of [false, true]) {
    const controller = new AbortController()
    const desk = stubDesk(({ signal }) => new Promise((resolve, reject) => {
      // A well-behaved desk settles on abort; the late variant even resolves with answers.
      const settle = () => (lateAnswers ? resolve([{ id: 'q1', selected: [], custom: PER_MINUTE }]) : reject(new Error('cancelled')))
      signal?.addEventListener('abort', settle, { once: true })
      controller.signal.addEventListener('abort', settle, { once: true })
      controller.abort()
    }))
    const { out, llm } = await refine({ rounds: 0, messages: null, desk, controller, script: [{ text: WITH_GAPS }, { text: FOLDED }] })
    assert.equal(out.ok, false, 'late answers: ' + String(lateAnswers))
    assert.equal(out.code, 'ABORTED', 'late answers: ' + String(lateAnswers))
    assert.equal(llm.calls.length, 1, 'late answers: ' + String(lateAnswers))
  }
})

test('ST-29 [State cancel] aborting during a Stardea call resolves that click as ABORTED and ends the refinement as ABORTED', T, async () => {
  const controller = new AbortController()
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [{ id: 'q1', selected: [], custom: PER_MINUTE }] })
  const script = [{ text: WITH_GAPS }, () => { controller.abort(); return { hang: true } }, { text: FOLDED }]
  const { out, llm } = await refine({ rounds: 0, messages: null, desk, controller, script })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'ABORTED')
  assert.equal(llm.calls.length, 2, 'no rewrite with answers')
  assert.equal(desk.log.results.length, 1, 'the Stardea promise resolves')
  assert.deepEqual([desk.log.results[0].ok, desk.log.results[0].code], [false, 'ABORTED'])
})

test('ST-30 [State retry] after the rewrite with answers fails, a retry of the same draft reuses the answers without asking', T, async () => {
  const memory = new AnswerMemory()
  const first = await refine({
    rounds: 0, messages: null, answers: memory,
    desk: stubDesk(async () => [{ id: 'q1', selected: [PER_MINUTE], custom: OWN }]),
    script: [{ text: WITH_GAPS }, { throw: 'gateway exploded' }],
  })
  assert.equal(first.out.ok, false)
  assert.equal(first.out.code, 'UPSTREAM')

  const desk = stubDesk(async () => { throw new Error('must not be asked again') })
  const second = await refine({ rounds: 0, messages: null, answers: memory, desk, script: [{ text: FOLDED }] })
  assert.equal(second.out.ok, true, JSON.stringify(second.out))
  assert.equal(desk.log.asked.length, 0, 'no second ask')
  assert.equal(second.llm.calls.length, 1, 'only the rewrite with the remembered answers')
  assertInOrder(allText(second.llm.calls[0]), [PER_MINUTE, OWN], 'the remembered answer: selected idea, then own words')
  assertAnswerParts(allText(second.llm.calls[0]), { listed: [PER_MINUTE, OWN] }, 'the remembered answer keeps both parts')
  assert.deepEqual(second.out.meta.questions, { asked: 2, answered: 1 })
})

// ================================================================ token usage (requirement 7)

test('ST-31 [BVA usage] one call: input = uncached + cache-write, cached = cache-read, missing fields count as 0, no report = absent', T, async () => {
  const rows = [
    [undefined, undefined],
    [{ inputTokens: 0, outputTokens: 0 }, { input: 0, cached: 0, output: 0 }],
    [{ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, { input: 0, cached: 0, output: 0 }],
    [{ inputTokens: 1, outputTokens: 1 }, { input: 1, cached: 0, output: 1 }],
    [{ inputTokens: 5, outputTokens: 2, cacheReadTokens: 9 }, { input: 5, cached: 9, output: 2 }],
    [{ inputTokens: 5, outputTokens: 2, cacheWriteTokens: 4 }, { input: 9, cached: 0, output: 2 }],
    [{ inputTokens: 5, outputTokens: 2, cacheReadTokens: 9, cacheWriteTokens: 4 }, { input: 9, cached: 9, output: 2 }],
  ]
  for (const [usage, expected] of rows) {
    const { out } = await refine({ rounds: 0, messages: null, script: [{ text: PLAIN, usage }] })
    assert.equal(out.ok, true, JSON.stringify(out))
    assert.deepEqual(out.meta.usage, expected, JSON.stringify(usage))
  }
})

test('ST-32 [EP usage] only the calls that reported usage are summed', T, async () => {
  const A = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3 }
  const B = { inputTokens: 7, outputTokens: 1, cacheWriteTokens: 2 }
  const rows = [[A, undefined, { input: 10, cached: 3, output: 5 }], [undefined, B, { input: 9, cached: 0, output: 1 }], [A, B, { input: 19, cached: 3, output: 6 }]]
  for (const [first, second, expected] of rows) {
    // The first reply drops the path, so exactly one repair call follows.
    const { out, llm } = await refine({ rounds: 0, messages: null, script: [{ text: '为接口增加限流。', usage: first }, { text: PLAIN, usage: second }] })
    assert.equal(out.ok, true)
    assert.equal(llm.calls.length, 2)
    assert.deepEqual(out.meta.usage, expected)
  }
})

test('ST-33 [EP usage] meta.usage sums every call of the refinement, lookup rounds and Stardea calls included', T, async () => {
  const usage = (i) => ({ inputTokens: 100 + i, outputTokens: 10 + i, cacheReadTokens: 1000 * i, ...(i % 2 === 0 ? { cacheWriteTokens: 50 } : {}) })
  const { out, llm } = await fullRefinement({ usage })
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 8)
  // input: (100..107) + 4 x 50 cache-write = 828 + 200; cached: 1000 x (0..7) = 28000; output: 10..17 = 108
  assert.deepEqual(out.meta.usage, { input: 1028, cached: 28000, output: 108 })
})

// ================================================================ HTTP route (system level)

/** Apply the plugin with stub host services; `web` is exposed as ctx.web and ctx.get('web'). */
function mountPlugin({ raw, script = [], web } = {}) {
  const llm = stubLlm(script)
  const routes = []
  const warnings = []
  const services = { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }
  if (web !== undefined) services.web = web
  const ctx = {
    ...services,
    logger: { warn: (m) => warnings.push(String(m)), error: (m) => warnings.push(String(m)), info() {}, debug() {} },
    on() {},
    effect(fn) { return fn() },
    get: (name) => services[name],
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  apply(ctx, { defaultMode: PANEL_MODE, ...raw })
  assert.equal(routes.length, 1)
  return { route: routes[0], llm, warnings }
}

/** Drive the handler with a fake request; returns the pair and a promise of the reply. */
function send(route, method, path, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = path
  req.headers = { 'content-type': 'application/json' }
  const res = new EventEmitter()
  const reply = { status: 0, headers: null, json: null }
  res.writableEnded = false
  res.writeHead = (status, headers) => { reply.status = status; reply.headers = headers; return res }
  res.end = (text) => {
    res.writableEnded = true
    res.writableFinished = true
    reply.json = typeof text === 'string' && text !== '' ? JSON.parse(text) : null
  }
  const done = Promise.resolve(route.handler(req, res)).then(() => reply)
  if (body !== undefined) req.emit('data', Buffer.from(body, 'utf8'))
  req.emit('end')
  return { req, res, reply, done }
}

const post = (route, endpoint, payload) => send(route, 'POST', API + '/' + endpoint, typeof payload === 'string' ? payload : JSON.stringify(payload)).done

/** A client that went away: every common disconnect signal of a Node request/response. */
function disconnect({ req, res }) {
  req.aborted = true
  req.destroyed = true
  res.destroyed = true
  req.emit('aborted')
  req.emit('close')
  res.emit('close')
}

async function waitFor(condition, label, ms = 3000) {
  const until = Date.now() + ms
  while (!condition()) {
    if (Date.now() > until) assert.fail('timed out waiting for ' + label)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const askBody = (over = {}) => ({ sessionId: 's1', text: DRAFT, interactive: true, ...over })

/** Never leave a run waiting (its timers would keep the file alive). */
async function cancelRun(route, runId) {
  if (typeof runId === 'string') await post(route, 'cancel', { runId })
}

test('SR-01 [EP not interactive] /improve without interactive asks nothing: the model is not invited to ask and the gaps stay (TBD)', T, async () => {
  const plugin = mountPlugin({ script: [{ text: WITH_GAPS }] })
  const reply = await post(plugin.route, 'improve', { sessionId: 's1', text: DRAFT })
  assert.equal(reply.status, 200)
  assert.equal(reply.json.ok, true, JSON.stringify(reply.json))
  assert.equal(reply.json.ask, undefined)
  assert.match(reply.json.text, /\(TBD\)/)
  assert.equal(plugin.llm.calls.length, 1, 'no rewrite with answers')
  const request = JSON.stringify({ system: plugin.llm.calls[0].system, messages: plugin.llm.calls[0].messages })
  assert.equal(request.includes('missing_info'), false, 'the model is not invited to list questions')
})

test('SR-02 [Decision interactive x sessionId] interactive without a sessionId asks nothing', T, async () => {
  for (const body of [{ text: DRAFT, interactive: true }, { sessionId: '', text: DRAFT, interactive: true }]) {
    const plugin = mountPlugin({ script: [{ text: WITH_GAPS }] })
    const reply = await post(plugin.route, 'improve', body)
    assert.equal(reply.json.ok, true, JSON.stringify(reply.json))
    assert.equal(reply.json.ask, undefined, JSON.stringify(body))
    assert.match(reply.json.text, /\(TBD\)/)
  }
})

test('SR-03 [EP ask] interactive + sessionId: questions come back as ask { runId, questions } without text; no gaps -> plain success', T, async () => {
  const plugin = mountPlugin({ script: [{ text: WITH_GAPS }, { text: PLAIN }] })
  const asked = await post(plugin.route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    assert.equal(asked.status, 200)
    assert.equal(asked.json.ok, true, JSON.stringify(asked.json))
    assert.equal(typeof runId, 'string')
    assert.ok(runId.length > 0)
    assert.deepEqual(asked.json.ask.questions.map(({ id, question }) => ({ id, question })), [{ id: 'q1', question: Q1 }, { id: 'q2', question: Q2 }])
    assert.equal('text' in asked.json, false, 'no text while asking')
  } finally { await cancelRun(plugin.route, runId) }

  const direct = await post(plugin.route, 'improve', askBody({ sessionId: 's2' }))
  assert.equal(direct.json.ok, true)
  assert.equal(direct.json.ask, undefined)
  assert.equal(direct.json.text, PLAIN)
})

test('SR-04 [State ask -> stardea x2 -> answer] the HTTP flow appends ideas, folds the answers, sums usage and stays append-only', T, async () => {
  const later = { inputTokens: 50, outputTokens: 120, cacheReadTokens: 1200 }
  const plugin = mountPlugin({
    script: [
      { text: WITH_GAPS, usage: { inputTokens: 1000, outputTokens: 100, cacheWriteTokens: 200 } },
      { text: ideasXml(IDEAS_1), usage: later },
      { text: ideasXml(IDEAS_2), usage: later },
      { text: FOLDED, usage: later },
    ],
  })
  const asked = await post(plugin.route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    const first = await post(plugin.route, 'stardea', { runId, questionId: 'q1' })
    assert.equal(first.status, 200)
    assert.equal(first.json.ok, true, JSON.stringify(first.json))
    assert.deepEqual(textsOf(first.json), IDEAS_1.map(([, t]) => t))
    assert.deepEqual(first.json.ideas.map((i) => i.source), IDEAS_1.map(([s]) => s))

    const second = await post(plugin.route, 'stardea', { runId, questionId: 'q1' })
    assert.equal(second.json.ok, true, JSON.stringify(second.json))
    assert.deepEqual(textsOf(second.json), [PER_HOUR, '突发上限 20'], 'only the new ideas')
    const ids = [...first.json.ideas, ...second.json.ideas].map((i) => i.id)
    assert.equal(new Set(ids).size, ids.length, 'ids unique within the run')

    const final = await post(plugin.route, 'answer', { runId, answers: [{ id: 'q1', selected: [PER_MINUTE, PER_HOUR], custom: OWN }, { id: 'q2', selected: [BY_IP] }] })
    assert.equal(final.status, 200)
    assert.equal(final.json.ok, true, JSON.stringify(final.json))
    assert.equal(final.json.text, FOLDED)
    assert.deepEqual(final.json.meta.questions, { asked: 2, answered: 2 })
    // input: 1000 + 200 + 3 x 50; cached: 3 x 1200; output: 100 + 3 x 120
    assert.deepEqual(final.json.meta.usage, { input: 1350, cached: 3600, output: 460 })

    assert.equal(plugin.llm.calls.length, 4)
    assertAppendOnly(plugin.llm.calls)
    assertInOrder(lastUserText(plugin.llm.calls[3]), [Q1, PER_MINUTE, PER_HOUR, OWN, Q2, BY_IP], 'answers message')
  } finally { await cancelRun(plugin.route, runId) }
})

test('SR-05 [State ask -> answer []] skipping all keeps the first rewrite with its (TBD) notes and makes no further call', T, async () => {
  const plugin = mountPlugin({ script: [{ text: WITH_GAPS }, { text: FOLDED }] })
  const asked = await post(plugin.route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    const final = await post(plugin.route, 'answer', { runId, answers: [] })
    assert.equal(final.json.ok, true, JSON.stringify(final.json))
    assert.match(final.json.text, /\(TBD\)/)
    assert.equal(final.json.text.includes('missing_info'), false)
    assert.equal(plugin.llm.calls.length, 1)
  } finally { await cancelRun(plugin.route, runId) }
})

test('SR-06 [State ask -> cancel] /cancel answers { ok: true }; the run is over: /answer and /stardea answer NO_RUN', T, async () => {
  const plugin = mountPlugin({ script: [{ text: WITH_GAPS }, { text: ideasXml(IDEAS_1) }, { text: FOLDED }] })
  const asked = await post(plugin.route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  assert.equal(typeof runId, 'string', JSON.stringify(asked.json))
  const cancelled = await post(plugin.route, 'cancel', { runId })
  assert.equal(cancelled.status, 200)
  assert.deepEqual(cancelled.json, { ok: true })
  for (const [endpoint, body] of [['answer', { runId, answers: [] }], ['stardea', { runId, questionId: 'q1' }]]) {
    const reply = await post(plugin.route, endpoint, body)
    assert.equal(reply.status, 200, endpoint)
    assert.deepEqual([reply.json.ok, reply.json.code], [false, 'NO_RUN'], endpoint)
  }
  assert.equal(plugin.llm.calls.length, 1, 'nothing ran after the cancel')
})

test('SR-07 [State answered -> finished] a second /answer or a /stardea after the run finished answers NO_RUN', T, async () => {
  const plugin = mountPlugin({ script: [{ text: WITH_GAPS }, { text: FOLDED }, { text: ideasXml(IDEAS_1) }] })
  const asked = await post(plugin.route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    const final = await post(plugin.route, 'answer', { runId, answers: [{ id: 'q1', selected: [], custom: PER_MINUTE }] })
    assert.equal(final.json.ok, true, JSON.stringify(final.json))
    const again = await post(plugin.route, 'answer', { runId, answers: [] })
    assert.deepEqual([again.json.ok, again.json.code], [false, 'NO_RUN'])
    const late = await post(plugin.route, 'stardea', { runId, questionId: 'q1' })
    assert.deepEqual([late.json.ok, late.json.code], [false, 'NO_RUN'])
    assert.equal(plugin.llm.calls.length, 2)
  } finally { await cancelRun(plugin.route, runId) }
})

test('SR-08 [EP unknown] an unknown runId or questionId answers NO_RUN, and the live run is untouched', T, async () => {
  const plugin = mountPlugin({ script: [{ text: WITH_GAPS }] })
  for (const [endpoint, body] of [['stardea', { runId: 'nope', questionId: 'q1' }], ['answer', { runId: 'nope', answers: [] }]]) {
    const reply = await post(plugin.route, endpoint, body)
    assert.equal(reply.status, 200, endpoint)
    assert.deepEqual([reply.json.ok, reply.json.code], [false, 'NO_RUN'], endpoint)
  }
  // Assumption: /cancel of an unknown run is harmless; only a 200 JSON reply is required.
  const cancelUnknown = await post(plugin.route, 'cancel', { runId: 'nope' })
  assert.equal(cancelUnknown.status, 200)
  assert.equal(typeof cancelUnknown.json?.ok, 'boolean')
  const asked = await post(plugin.route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    for (const questionId of ['q0', 'q3']) {
      const reply = await post(plugin.route, 'stardea', { runId, questionId })
      assert.deepEqual([reply.json.ok, reply.json.code], [false, 'NO_RUN'], questionId)
    }
    assert.equal(plugin.llm.calls.length, 1, 'no Stardea call for an unknown question')
    const final = await post(plugin.route, 'answer', { runId, answers: [] })
    assert.equal(final.json.ok, true, 'the run still waits for its answers: ' + JSON.stringify(final.json))
  } finally { await cancelRun(plugin.route, runId) }
})

test('SR-09 [EP bad bodies] malformed /stardea, /answer and /cancel bodies answer BAD_BODY and leave the run waiting', T, async () => {
  // HTTP status is not asserted for BAD_BODY: the existing route answers it with 400, while the
  // contract says 200 for the new endpoints. Assumption: /answer without `answers` is BAD_BODY.
  const plugin = mountPlugin({ script: [{ text: WITH_GAPS }, { text: FOLDED }] })
  const asked = await post(plugin.route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    assert.equal(typeof runId, 'string', JSON.stringify(asked.json))
    const bad = [
      ['stardea', '{not json'], ['stardea', {}], ['stardea', { runId }], ['stardea', { runId: 5, questionId: 'q1' }], ['stardea', { runId, questionId: 7 }],
      ['answer', '{not json'], ['answer', {}], ['answer', { runId }], ['answer', { runId, answers: 'q1' }], ['answer', { answers: [] }],
      ['cancel', '{not json'], ['cancel', {}], ['cancel', { runId: 5 }],
    ]
    for (const [endpoint, body] of bad) {
      const reply = await post(plugin.route, endpoint, body)
      assert.equal(reply.json?.ok, false, endpoint + ' ' + JSON.stringify(body))
      assert.equal(reply.json.code, 'BAD_BODY', endpoint + ' ' + JSON.stringify(body))
    }
    assert.equal(plugin.llm.calls.length, 1)
    const final = await post(plugin.route, 'answer', { runId, answers: [{ id: 'q1', selected: [], custom: PER_MINUTE }] })
    assert.equal(final.json.ok, true, JSON.stringify(final.json))
    assert.equal(final.json.text, FOLDED)
  } finally { await cancelRun(plugin.route, runId) }
})

test('SR-10 [State] a client that drops the /answer request cancels the refinement', T, async () => {
  const plugin = mountPlugin({ script: [{ text: WITH_GAPS }, { hang: true }] })
  const asked = await post(plugin.route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    assert.equal(typeof runId, 'string', JSON.stringify(asked.json))
    const pending = send(plugin.route, 'POST', API + '/answer', JSON.stringify({ runId, answers: [{ id: 'q1', selected: [], custom: PER_MINUTE }] }))
    await waitFor(() => plugin.llm.live.length >= 2, 'the rewrite with answers to start')
    disconnect(pending)
    await waitFor(() => plugin.llm.live[1].signal?.aborted === true, 'the model call to be aborted')
    const reply = await pending.done
    if (reply.json !== null) assert.equal(reply.json.ok, false, 'never a success after the client left')
    const after = await post(plugin.route, 'answer', { runId, answers: [] })
    assert.deepEqual([after.json.ok, after.json.code], [false, 'NO_RUN'], 'the run is over')
  } finally { await cancelRun(plugin.route, runId) }
})

test('SR-11 [State retry] after /answer fails, /improve of the same draft reuses the answers and asks nothing', T, async () => {
  // Lookup rounds 0: with tools offered, a throw would be taken as "tools refused" and retried
  // without tools (0.11 behaviour), so the failure would never reach the client.
  const plugin = mountPlugin({ raw: { sessionLookupRounds: 0, stardeaRounds: 0 }, script: [{ text: WITH_GAPS }, { throw: 'gateway exploded' }, { text: FOLDED }] })
  const asked = await post(plugin.route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    const failed = await post(plugin.route, 'answer', { runId, answers: [{ id: 'q1', selected: [PER_MINUTE], custom: OWN }] })
    assert.deepEqual([failed.json.ok, failed.json.code], [false, 'UPSTREAM'], JSON.stringify(failed.json))
    const retry = await post(plugin.route, 'improve', askBody())
    assert.equal(retry.json.ok, true, JSON.stringify(retry.json))
    assert.equal(retry.json.ask, undefined, 'no questions again')
    assert.equal(retry.json.text, FOLDED)
    assert.equal(plugin.llm.calls.length, 3)
    assertInOrder(allText(plugin.llm.calls[2]), [PER_MINUTE, OWN], 'the remembered answer')
  } finally { await cancelRun(plugin.route, runId) }
})

test('SR-12 [EP runs] two waiting refinements get different runIds', T, async () => {
  const plugin = mountPlugin({ script: [{ text: WITH_GAPS }, { text: WITH_GAPS }] })
  const a = await post(plugin.route, 'improve', askBody({ sessionId: 's1' }))
  const b = await post(plugin.route, 'improve', askBody({ sessionId: 's2' }))
  try {
    assert.equal(typeof a.json?.ask?.runId, 'string')
    assert.equal(typeof b.json?.ask?.runId, 'string')
    assert.notEqual(a.json.ask.runId, b.json.ask.runId)
  } finally {
    await cancelRun(plugin.route, a.json?.ask?.runId)
    await cancelRun(plugin.route, b.json?.ask?.runId)
  }
})

test('SR-13 [Decision] the route offers web_search only for interactive + sessionId + web service + stardeaWebSearch + stardeaRounds > 0', T, async () => {
  const WEB_ON = { stardeaWebSearch: true }
  const rows = [
    { name: 'all true (default 1 Stardea round)', body: askBody(), web: true, raw: WEB_ON, offered: true },
    { name: 'not interactive', body: { sessionId: 's1', text: DRAFT }, web: true, raw: WEB_ON, offered: false },
    { name: 'interactive without session', body: { text: DRAFT, interactive: true }, web: true, raw: WEB_ON, offered: false },
    { name: 'no web service', body: askBody(), web: false, raw: WEB_ON, offered: false },
    { name: 'Stardea web search off (default)', body: askBody(), web: true, raw: undefined, offered: false },
    { name: 'all rounds 0', body: askBody(), web: true, raw: { ...WEB_ON, sessionLookupRounds: 0, stardeaRounds: 0 }, offered: false, noTools: true },
  ]
  for (const row of rows) {
    const plugin = mountPlugin({ raw: row.raw, web: row.web ? stubWeb() : undefined, script: [{ text: PLAIN }] })
    const reply = await post(plugin.route, 'improve', row.body)
    assert.equal(reply.json.ok, true, row.name + ': ' + JSON.stringify(reply.json))
    assert.equal(toolNames(plugin.llm.calls[0]).includes(WEB_TOOL), row.offered, row.name)
    if (row.noTools === true) assert.equal(offersTools(plugin.llm.calls[0]), false, row.name)
  }
})

test('SR-14 [EP stardea web] a /stardea click can search the web through the DSH web search service', T, async () => {
  const web = stubWeb()
  const plugin = mountPlugin({ raw: { stardeaWebSearch: true, stardeaRounds: 1 }, web, script: [{ text: WITH_GAPS }, { tools: [webCall('限流 推荐')] }, { text: ideasXml(IDEAS_1) }] })
  const asked = await post(plugin.route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    const ideas = await post(plugin.route, 'stardea', { runId, questionId: 'q1' })
    assert.equal(ideas.json.ok, true, JSON.stringify(ideas.json))
    assert.equal(ideas.json.ideas.length, MAX_IDEAS_PER_CLICK)
    assert.deepEqual(web.calls.map((c) => c.request.query), ['限流 推荐'])
    assert.ok(toolResult(plugin.llm.calls[2], 'call-2-1') !== undefined)
  } finally { await cancelRun(plugin.route, runId) }
})
