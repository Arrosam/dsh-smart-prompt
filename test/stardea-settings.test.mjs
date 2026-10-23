// Stardea settings (0.13): `stardeaIdeas`, `stardeaRounds` and `stardeaWebSearch`, from the
// Config schema through improveDraft and the HTTP route to the client settings section.
// Black-box: expected outcomes come from the Stardea settings requirements only.
//
// The harnesses below are compact copies of the ones in stardea-host.test.mjs (scripted model,
// follow-up desk, web stub, fake request/response) and lookup-settings.test.mjs (module loader,
// fake ctx, primitives stub with a `Switch`); test files cannot import each other without
// running each other's cases.
//
// Techniques:
//  - BVA: stardeaIdeas 0 / 1 / 4 / 8 / 9 / -1 / 2.5; stardeaRounds -1 / 0 / 1 / 10 / 11 / 2.5;
//    ideas offered N and N+1 for caps 1, 4, 8; rewrite budget 1 + one extra round; click
//    budget 2 + one extra round; client fields '', '1', '8', '0', '9', '2.5' / '0', '10',
//    '-1', '11', '2.5'.
//  - EP: readLiveSettings inputs (missing, plain valid, volatile ref, out of range, fraction,
//    wrong type, null / non-object raw); boolean spec format/parse inputs; locales en / zh;
//    primitives with and without `Switch`.
//  - Decision table: tools declared = session tools (sessionId x sessionMessages x
//    (lookupRounds > 0 OR (canAsk AND stardeaRounds > 0))) and web_search (canAsk x
//    stardeaWebSearch x stardeaRounds > 0 x deps.web); canAsk = asker x maxQuestions > 0 x
//    sessionId x no remembered answers.
//  - State transition: settings snapshot per refinement (a change mid-run applies to the next
//    refinement only); Switch off -> on -> off staging; invalid -> valid save state.
//
// Cases: SS-01..SS-08 config, SS-10..SS-19 orchestration, SS-20..SS-22 HTTP, SS-30..SS-39 client.
//
// Supplement (SS-40..SS-49), for requirements the cases above do not discriminate:
//  - EP absent inputs: stardeaRounds absent -> 0 even when lookupRounds > 0 (a click never
//    borrows the rewrite budget); stardeaWebSearch must be exactly `true` (absent, 'true', 1, {}).
//  - EP system prompt: it states the configured ideas limit (2 vs 7).
//  - Decision (HTTP): stardeaRounds 2 -> two web rounds per click (neither the default 1 nor
//    sessionLookupRounds 0); sessionLookupRounds 3 + stardeaRounds 0 -> the rewrite looks up,
//    the click does not.
//  - EP rewrite with answers: a web_search call there is "Not run".
//  - EP primitives: each of the six required primitives missing or not a function -> no section.
//  - Layout: row order (labels, number inputs, dedicated picker, Switch last).
//  - State: typing invalid -> valid in the Stardea inputs; Switch saved on -> off -> discard -> on.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { Config, readLiveSettings, resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'
import { AnswerMemory } from '../lib/answer-memory.js'
import { apply } from '../lib/index.js'

const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const T = { timeout: 15000 }
const CFG = resolveConfig({})
const API = '/dsh-smart-prompt/api'
/** Light keeps one panel with every question (q1, q2); see PANEL_MODE in stardea-host.test.mjs. */
const PANEL_MODE = 'light'
const DEFAULTS = { stardeaIdeas: 4, stardeaRounds: 1, stardeaWebSearch: false }
const WEB_TOOL = 'web_search'
const SEARCH_TOOL = 'search_session'
const READ_TOOL = 'read_session_messages'
const SESSION_TOOLS = [READ_TOOL, SEARCH_TOOL]
const ALL_TOOLS = [READ_TOOL, SEARCH_TOOL, WEB_TOOL]
const NOT_RUN = 'Not run: web_search is not available in this step.'

// ================================================================ config (schema + readLiveSettings)

test('SS-01 [BVA] stardeaIdeas: the schema accepts 1, 4, 8 and rejects 0, 9, -1, 2.5', () => {
  for (const v of [1, 4, 8]) {
    assert.doesNotThrow(() => Config({ stardeaIdeas: v }), String(v))
    assert.equal(readLiveSettings(Config({ stardeaIdeas: v })).stardeaIdeas, v)
  }
  for (const v of [0, 9, -1, 2.5]) assert.throws(() => Config({ stardeaIdeas: v }), String(v))
})

test('SS-02 [BVA] stardeaRounds: the schema accepts 0, 1, 10 and rejects -1, 11, 2.5', () => {
  for (const v of [0, 1, 10]) {
    assert.doesNotThrow(() => Config({ stardeaRounds: v }), String(v))
    assert.equal(readLiveSettings(Config({ stardeaRounds: v })).stardeaRounds, v)
  }
  for (const v of [-1, 11, 2.5]) assert.throws(() => Config({ stardeaRounds: v }), String(v))
})

test('SS-03 [EP] stardeaWebSearch is a boolean: true / false accepted', () => {
  assert.equal(readLiveSettings(Config({ stardeaWebSearch: true })).stardeaWebSearch, true)
  assert.equal(readLiveSettings(Config({ stardeaWebSearch: false })).stardeaWebSearch, false)
})

test('SS-04 [EP default] defaults are 4 ideas, 1 round, web search off', () => {
  const live = readLiveSettings(Config({}))
  assert.deepEqual({ stardeaIdeas: live.stardeaIdeas, stardeaRounds: live.stardeaRounds, stardeaWebSearch: live.stardeaWebSearch }, DEFAULTS)
})

test('SS-05 [EP] the three Stardea fields are volatile settings-page fields', () => {
  const resolved = Config({})
  for (const field of ['stardeaIdeas', 'stardeaRounds', 'stardeaWebSearch']) {
    assert.equal(typeof resolved[field]?.get, 'function', field)
  }
})

test('SS-06 [EP fallback] missing, out-of-range, fractional or wrong-type values fall back to the defaults', () => {
  for (const v of [undefined, 0, 9, -1, 2.5, '4', null, true]) assert.equal(readLiveSettings({ stardeaIdeas: v }).stardeaIdeas, 4, JSON.stringify(v))
  for (const v of [undefined, -1, 11, 2.5, '1', null, false]) assert.equal(readLiveSettings({ stardeaRounds: v }).stardeaRounds, 1, JSON.stringify(v))
  for (const v of [undefined, 'true', 1, null, {}]) assert.equal(readLiveSettings({ stardeaWebSearch: v }).stardeaWebSearch, false, JSON.stringify(v))
  // Valid plain values are read as is.
  assert.deepEqual(
    (({ stardeaIdeas, stardeaRounds, stardeaWebSearch }) => ({ stardeaIdeas, stardeaRounds, stardeaWebSearch }))(readLiveSettings({ stardeaIdeas: 8, stardeaRounds: 0, stardeaWebSearch: true })),
    { stardeaIdeas: 8, stardeaRounds: 0, stardeaWebSearch: true },
  )
})

test('SS-07 [EP] null / non-object raw input gives all defaults', () => {
  for (const raw of [null, undefined, 'x', 5]) {
    const live = readLiveSettings(raw)
    assert.deepEqual({ stardeaIdeas: live.stardeaIdeas, stardeaRounds: live.stardeaRounds, stardeaWebSearch: live.stardeaWebSearch }, DEFAULTS, String(raw))
  }
})

test('SS-08 [State] volatile refs are read at call time; an invalid live value falls back', () => {
  let ideas = 2
  let rounds = 5
  let web = true
  const raw = { stardeaIdeas: { get: () => ideas }, stardeaRounds: { get: () => rounds }, stardeaWebSearch: { get: () => web } }
  assert.deepEqual([readLiveSettings(raw).stardeaIdeas, readLiveSettings(raw).stardeaRounds, readLiveSettings(raw).stardeaWebSearch], [2, 5, true])
  ideas = 8; rounds = 0; web = false
  assert.deepEqual([readLiveSettings(raw).stardeaIdeas, readLiveSettings(raw).stardeaRounds, readLiveSettings(raw).stardeaWebSearch], [8, 0, false])
  ideas = 9; rounds = 11
  assert.deepEqual([readLiveSettings(raw).stardeaIdeas, readLiveSettings(raw).stardeaRounds], [4, 1])
})

// ================================================================ orchestration harness

const PATH = 'src/api/limit.ts'
const DRAFT = '给 ' + PATH + ' 里的接口加上限流'
const Q1 = '限流阈值是多少？'
const Q2 = '按什么维度限流？'
const WITH_GAPS = DRAFT + '。\n- 阈值：(TBD)\n- 维度：(TBD)\n<missing_info>\n<question>' + Q1 + '</question>\n<question>' + Q2 + '</question>\n</missing_info>'
const PLAIN = '为 ' + PATH + ' 里的接口增加限流。'
const FOLDED = '给 ' + PATH + ' 里的接口加上限流：每分钟 100 次。'
const LOOKUP_MARK = 'LOOKUP-MARK'
const LOOKUP_HIT = '登录接口以后要加限流'
const typed = (text) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const TRANSCRIPT = [typed(LOOKUP_HIT + ' ' + LOOKUP_MARK)]
const WEB_RESULT = { content: 'WEB-MARK', sources: [{ url: 'https://example.com', title: 't', snippet: 's' }], truncated: false }
const POOL = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'].map((c) => c + '方案')

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/** Scripted model, same step format as stardea-host.test.mjs. */
function stubLlm(script) {
  const calls = []
  return {
    calls,
    stream(options) {
      const n = calls.length + 1
      const tools = Array.isArray(options.tools) && options.tools.length > 0 ? clone(options.tools) : undefined
      calls.push({ system: clone(options.system), messages: clone(options.messages), tools })
      let step = script.length > 0 ? script.shift() : { text: '' }
      if (typeof step === 'function') step = step(options)
      return (async function* () {
        let index = 0
        if (step.text !== undefined && step.text !== '') {
          yield { type: 'text-delta', index, text: step.text }
          yield { type: 'block-end', index, block: { type: 'text', text: step.text } }
          index += 1
        }
        if (step.throw !== undefined) throw new Error(step.throw)
        for (const [i, call] of (step.tools ?? []).entries()) {
          const id = 'call-' + String(n) + '-' + String(i + 1)
          const args = JSON.stringify(call.args)
          yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: args }
          yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: args } }
          index += 1
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

function stubDesk(script = async () => []) {
  const log = { results: [], asked: 0 }
  const askUser = () => async (questions, signal, stardea) => {
    log.asked += 1
    const click = async (id) => { const r = await stardea(id, signal); log.results.push(r); return r }
    return { answers: await script({ click }) }
  }
  return { log, askUser }
}

function stubWeb() {
  const calls = []
  return { calls, search: async (request) => { calls.push(clone(request)); return WEB_RESULT } }
}

/** One improveDraft run. Stardea inputs are passed only when given, so absent defaults are testable. */
async function refine({ script, desk, web, messages = TRANSCRIPT, answers, input = {}, deps = {} }) {
  const llm = stubLlm(script)
  const out = await improveDraft(
    { llm, selection: { provider: 'p', model: 'm' }, lastRoute: null, sessionMessages: messages === null ? undefined : async () => messages, askUser: desk?.askUser, web, answers, ...deps },
    CFG,
    { draft: DRAFT, sessionId: 's1', mode: PANEL_MODE, signal: new AbortController().signal, maxQuestions: 5, ...input },
  )
  return { out, llm }
}

const textOf = (m) => (m === undefined ? '' : (m.content ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).join(''))
const lastUserText = (call) => textOf([...call.messages].reverse().find((m) => m.role === 'user'))
const toolResult = (call, id) => call.messages.find((m) => m.role === 'tool' && m.toolCallId === id)
const lookupsRun = (calls) => [...new Set(calls.flatMap((c) => c.messages.filter((m) => m.role === 'tool' && textOf(m).includes(LOOKUP_HIT)).map((m) => m.toolCallId)))]
const toolNames = (call) => (call.tools ?? []).map((t) => t.name).sort()
const ideasXml = (texts) => '<ideas>\n' + texts.map((t) => '<idea source="proposal">' + t + '</idea>').join('\n') + '\n</ideas>'
const textsOf = (r) => r.ideas.map((i) => i.text)
const webCall = (query) => ({ name: WEB_TOOL, args: { query } })
const searchCall = (query) => ({ name: SEARCH_TOOL, args: { query } })

// ================================================================ orchestration

test('SS-10 [Decision] tools declared: session tools and web_search per the decision table', T, async () => {
  const rows = [
    // lookupRounds x stardeaRounds x web flag x deps.web x canAsk x sessionMessages
    { name: 'rewrite rounds only', input: { lookupRounds: 2 }, desk: true, web: true, tools: SESSION_TOOLS },
    { name: 'rewrite rounds, no asker', input: { lookupRounds: 2, stardeaRounds: 2, stardeaWebSearch: true }, desk: false, web: true, tools: SESSION_TOOLS },
    { name: 'stardea rounds only, web off', input: { lookupRounds: 0, stardeaRounds: 1, stardeaWebSearch: false }, desk: true, web: true, tools: SESSION_TOOLS },
    { name: 'stardea rounds, web on', input: { lookupRounds: 0, stardeaRounds: 1, stardeaWebSearch: true }, desk: true, web: true, tools: ALL_TOOLS },
    { name: 'web on, no web service', input: { lookupRounds: 0, stardeaRounds: 1, stardeaWebSearch: true }, desk: true, web: false, tools: SESSION_TOOLS },
    { name: 'web on, stardea rounds 0', input: { lookupRounds: 3, stardeaRounds: 0, stardeaWebSearch: true }, desk: true, web: true, tools: SESSION_TOOLS },
    { name: 'web on, no session reader', input: { lookupRounds: 3, stardeaRounds: 1, stardeaWebSearch: true }, desk: true, web: true, messages: null, tools: [WEB_TOOL] },
    { name: 'stardea rounds, no asker (rewrite 0)', input: { lookupRounds: 0, stardeaRounds: 3, stardeaWebSearch: true }, desk: false, web: true, tools: [] },
    { name: 'asker returns undefined', input: { lookupRounds: 0, stardeaRounds: 3, stardeaWebSearch: true }, deps: { askUser: () => undefined }, web: true, tools: [] },
    { name: 'maxQuestions 0', input: { lookupRounds: 0, stardeaRounds: 3, stardeaWebSearch: true, maxQuestions: 0 }, desk: true, web: true, tools: [] },
    { name: 'empty sessionId', input: { lookupRounds: 3, stardeaRounds: 3, stardeaWebSearch: true, sessionId: '' }, desk: true, web: true, tools: [] },
    { name: 'all zero', input: { lookupRounds: 0, stardeaRounds: 0, stardeaWebSearch: true }, desk: true, web: true, tools: [] },
    { name: 'all absent (lookupRounds 0, stardeaRounds 0, web off)', input: {}, desk: true, web: true, tools: [] },
  ]
  for (const row of rows) {
    const { out, llm } = await refine({
      script: [{ text: PLAIN }], desk: row.desk ? stubDesk() : undefined, deps: row.deps ?? {},
      web: row.web ? stubWeb() : undefined, messages: row.messages === null ? null : TRANSCRIPT, input: row.input,
    })
    assert.equal(out.ok, true, row.name + ': ' + JSON.stringify(out))
    assert.deepEqual(toolNames(llm.calls[0]), row.tools, row.name)
  }
})

test('SS-11 [Decision canAsk] remembered answers for the draft: no Stardea tools are declared', T, async () => {
  const memory = new AnswerMemory()
  const input = { lookupRounds: 0, stardeaRounds: 2, stardeaWebSearch: true }
  const first = await refine({ answers: memory, input, web: stubWeb(), desk: stubDesk(async () => [{ id: 'q1', selected: [], custom: '每分钟 100 次' }]), script: [{ text: WITH_GAPS }, { throw: 'gateway exploded' }, { throw: 'gateway exploded' }] })
  assert.equal(first.out.ok, false, JSON.stringify(first.out))
  assert.deepEqual(toolNames(first.llm.calls[0]), ALL_TOOLS, 'the first run could ask')
  const second = await refine({ answers: memory, input, web: stubWeb(), desk: stubDesk(async () => { throw new Error('not asked') }), script: [{ text: FOLDED }] })
  assert.equal(second.out.ok, true, JSON.stringify(second.out))
  assert.deepEqual(toolNames(second.llm.calls[0]), [], 'answers remembered: the user cannot be asked, no tools')
})

test('SS-12 [EP] tools are identical in every call of one refinement', T, async () => {
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [{ id: 'q1', selected: [], custom: '每分钟 100 次' }] })
  const { out, llm } = await refine({
    desk, web: stubWeb(), input: { lookupRounds: 1, stardeaRounds: 1, stardeaWebSearch: true },
    script: [{ text: WITH_GAPS }, { tools: [webCall('q')] }, { text: ideasXml(POOL.slice(0, 2)) }, { text: FOLDED }],
  })
  assert.equal(out.ok, true, JSON.stringify(out))
  for (const call of llm.calls) assert.deepEqual(call.tools, llm.calls[0].tools)
  assert.deepEqual(toolNames(llm.calls[0]), ALL_TOOLS)
})

test('SS-13 [EP rewrite web] a web_search call in the rewrite is not run; its tool result starts "Not run: …"', T, async () => {
  const web = stubWeb()
  const { out, llm } = await refine({ desk: stubDesk(), web, input: { lookupRounds: 2, stardeaRounds: 1, stardeaWebSearch: true }, script: [{ tools: [webCall('rewrite query')] }, { text: PLAIN }] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(web.calls.length, 0)
  const result = toolResult(llm.calls[1], 'call-1-1')
  assert.ok(result !== undefined)
  assert.ok(textOf(result).startsWith(NOT_RUN), textOf(result))
})

test('SS-14 [BVA rewrite budget] lookupRounds 0 runs no rewrite lookup even when tools are declared for Stardea', T, async () => {
  const { llm } = await refine({ desk: stubDesk(), input: { lookupRounds: 0, stardeaRounds: 3 }, script: [{ tools: [searchCall(LOOKUP_MARK)] }, { text: PLAIN }, { text: PLAIN }] })
  assert.deepEqual(toolNames(llm.calls[0]), SESSION_TOOLS, 'declared for Stardea')
  assert.deepEqual(lookupsRun(llm.calls), [], 'the rewrite ran no lookup')
})

test('SS-15 [BVA separate budgets] rewrite = lookupRounds (1, a second round is cut); each click = stardeaRounds (2 each, a third is cut)', T, async () => {
  // The outcome of an over-budget reply is unspecified; only the lookups / searches that ran are asserted.
  const rewrite = await refine({
    desk: stubDesk(), input: { lookupRounds: 1, stardeaRounds: 2 },
    script: [{ tools: [searchCall(LOOKUP_MARK)] }, { tools: [searchCall(LOOKUP_MARK)] }, { text: PLAIN }, { text: PLAIN }],
  })
  assert.deepEqual(lookupsRun(rewrite.llm.calls), ['call-1-1'], 'one rewrite lookup round only')

  const web = stubWeb()
  const desk = stubDesk(async ({ click }) => { await click('q1'); await click('q2'); return [] })
  const { out, llm } = await refine({
    desk, web, input: { lookupRounds: 1, stardeaRounds: 2, stardeaWebSearch: true },
    script: [
      { tools: [searchCall(LOOKUP_MARK)] }, { text: WITH_GAPS }, // the rewrite uses its one round
      { tools: [webCall('a1')] }, { tools: [webCall('a2')] }, { text: ideasXml(POOL.slice(0, 2)) },
      { tools: [webCall('b1')] }, { tools: [webCall('b2')] }, { text: ideasXml(POOL.slice(2, 4)) },
    ],
  })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.deepEqual(lookupsRun(llm.calls), ['call-1-1'])
  assert.deepEqual(web.calls.map((c) => c.query), ['a1', 'a2', 'b1', 'b2'], 'each click has its own 2 rounds, untouched by the rewrite')
  assert.deepEqual(desk.log.results.map((r) => r.ok), [true, true])

  const overWeb = stubWeb()
  await refine({
    desk: stubDesk(async ({ click }) => { await click('q1'); return [] }), web: overWeb, input: { lookupRounds: 0, stardeaRounds: 2, stardeaWebSearch: true },
    script: [{ text: WITH_GAPS }, { tools: [webCall('x1')] }, { tools: [webCall('x2')] }, { tools: [webCall('x3')] }, { text: ideasXml(POOL.slice(0, 1)) }],
  })
  assert.deepEqual(overWeb.calls.map((c) => c.query), ['x1', 'x2'], 'a third round in one click is not run')
})

test('SS-16 [BVA stardeaRounds 0] a click is one model call with direct proposals; no tool runs', T, async () => {
  const web = stubWeb()
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
  const { out, llm } = await refine({ desk, web, input: { lookupRounds: 2, stardeaRounds: 0, stardeaWebSearch: true }, script: [{ text: WITH_GAPS }, { text: ideasXml(POOL.slice(0, 3)) }] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 2, 'rewrite + one call for the click')
  assert.deepEqual(textsOf(desk.log.results[0]), POOL.slice(0, 3))
  assert.equal(web.calls.length, 0)

  // Even if the model asks for a session search in a 0-round click, it does not run.
  const desk2 = stubDesk(async ({ click }) => { await click('q1'); return [] })
  const second = await refine({ desk: desk2, input: { lookupRounds: 2, stardeaRounds: 0 }, script: [{ text: WITH_GAPS }, { tools: [searchCall(LOOKUP_MARK)] }, { text: ideasXml(POOL.slice(0, 1)) }, { text: ideasXml(POOL.slice(0, 1)) }] })
  assert.deepEqual(lookupsRun(second.llm.calls), [], 'no session search ran in the click')
})

test('SS-17 [EP web off] stardeaWebSearch false: web_search is not declared and the web service is never searched', T, async () => {
  const web = stubWeb()
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
  const { llm } = await refine({ desk, web, input: { lookupRounds: 0, stardeaRounds: 3, stardeaWebSearch: false }, script: [{ text: WITH_GAPS }, { tools: [webCall('x')] }, { text: ideasXml(POOL.slice(0, 2)) }, { text: ideasXml(POOL.slice(0, 2)) }] })
  assert.deepEqual(toolNames(llm.calls[0]), SESSION_TOOLS)
  assert.equal(web.calls.length, 0)
})

test('SS-18 [BVA ideas cap] stardeaIdeas 1 / 4 / 8: N ideas pass, an (N+1)th is dropped; the request asks for "up to N"', T, async () => {
  for (const cap of [1, 4, 8]) {
    for (const offered of [cap, cap + 1]) {
      const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
      const { out, llm } = await refine({ messages: null, desk, input: { stardeaIdeas: cap }, script: [{ text: WITH_GAPS }, { text: ideasXml(POOL.slice(0, offered)) }] })
      assert.equal(out.ok, true, JSON.stringify(out))
      const result = desk.log.results[0]
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.deepEqual(textsOf(result), POOL.slice(0, cap), 'cap ' + String(cap) + ', offered ' + String(offered))
      assert.ok(lastUserText(llm.calls[1]).includes('up to ' + String(cap)), lastUserText(llm.calls[1]))
    }
  }
})

test('SS-19 [EP ideas cap x repeats] absent stardeaIdeas caps at 4; repeats are dropped before the cap counts new ideas', T, async () => {
  const desk = stubDesk(async ({ click }) => { await click('q1'); await click('q1'); return [] })
  await refine({ messages: null, desk, script: [{ text: WITH_GAPS }, { text: ideasXml(POOL.slice(0, 5)) }, { text: ideasXml([POOL[0], POOL[1], ...POOL.slice(5, 10)]) }] })
  const [first, second] = desk.log.results
  assert.deepEqual(textsOf(first), POOL.slice(0, 4), 'default cap 4')
  assert.deepEqual(textsOf(second), POOL.slice(5, 9), 'repeats dropped, then 4 new ideas')
  assert.deepEqual(second.ideas.map((i) => i.id), ['q1-i5', 'q1-i6', 'q1-i7', 'q1-i8'], 'ids continue <questionId>-i<n>')
})

// ================================================================ HTTP route

function mountPlugin({ raw, script = [], web, extra = {} } = {}) {
  const llm = stubLlm(script)
  const routes = []
  const services = { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) }, ...extra }
  if (web !== undefined) services.web = web
  const ctx = {
    ...services,
    logger: { warn() {}, error() {}, info() {}, debug() {} },
    on() {},
    effect(fn) { return fn() },
    get: (name) => services[name],
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  apply(ctx, { defaultMode: PANEL_MODE, ...raw })
  return { route: routes[0], llm }
}

function post(route, endpoint, payload) {
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = API + '/' + endpoint
  req.headers = { 'content-type': 'application/json' }
  const res = new EventEmitter()
  const reply = { status: 0, json: null }
  res.writableEnded = false
  res.writeHead = (status) => { reply.status = status; return res }
  res.end = (text) => { res.writableEnded = true; res.writableFinished = true; reply.json = typeof text === 'string' && text !== '' ? JSON.parse(text) : null }
  const done = Promise.resolve(route.handler(req, res)).then(() => reply)
  req.emit('data', Buffer.from(JSON.stringify(payload), 'utf8'))
  req.emit('end')
  return done
}

const askBody = { sessionId: 's1', text: DRAFT, interactive: true }
const cancelRun = async (route, runId) => { if (typeof runId === 'string') await post(route, 'cancel', { runId }) }

test('SS-20 [EP route] /improve passes stardeaIdeas, stardeaRounds and stardeaWebSearch; /stardea searches the web and caps the ideas', T, async () => {
  const web = stubWeb()
  const plugin = mountPlugin({
    raw: { sessionLookupRounds: 0, stardeaIdeas: 2, stardeaRounds: 1, stardeaWebSearch: true }, web,
    script: [{ text: WITH_GAPS }, { tools: [webCall('route query')] }, { text: ideasXml(POOL.slice(0, 3)) }],
  })
  const asked = await post(plugin.route, 'improve', askBody)
  const runId = asked.json?.ask?.runId
  try {
    assert.ok(toolNames(plugin.llm.calls[0]).includes(WEB_TOOL), 'web_search declared')
    const ideas = await post(plugin.route, 'stardea', { runId, questionId: 'q1' })
    assert.equal(ideas.json.ok, true, JSON.stringify(ideas.json))
    assert.deepEqual(textsOf(ideas.json), POOL.slice(0, 2), 'capped at stardeaIdeas 2')
    assert.deepEqual(web.calls.map((c) => c.query), ['route query'])
  } finally { await cancelRun(plugin.route, runId) }
})

test('SS-21 [EP route default] default settings: web search off, so web_search is not declared and the web is not searched', T, async () => {
  const web = stubWeb()
  const plugin = mountPlugin({ web, script: [{ text: WITH_GAPS }, { tools: [webCall('x')] }, { text: ideasXml(POOL.slice(0, 2)) }, { text: ideasXml(POOL.slice(0, 2)) }] })
  const asked = await post(plugin.route, 'improve', askBody)
  const runId = asked.json?.ask?.runId
  try {
    assert.equal(toolNames(plugin.llm.calls[0]).includes(WEB_TOOL), false)
    await post(plugin.route, 'stardea', { runId, questionId: 'q1' })
    assert.equal(web.calls.length, 0)
  } finally { await cancelRun(plugin.route, runId) }
})

test('SS-22 [State snapshot] a settings change mid-refinement applies only to the next refinement', T, async () => {
  let ideas = 1
  let webOn = true
  const plugin = mountPlugin({
    raw: { sessionLookupRounds: 0, stardeaRounds: 1, stardeaIdeas: { get: () => ideas }, stardeaWebSearch: { get: () => webOn } }, web: stubWeb(),
    script: [{ text: WITH_GAPS }, { text: ideasXml(POOL.slice(0, 5)) }, { text: WITH_GAPS }, { text: ideasXml(POOL.slice(5, 10)) }],
  })
  const a = await post(plugin.route, 'improve', askBody)
  const runA = a.json?.ask?.runId
  try {
    assert.ok(toolNames(plugin.llm.calls[0]).includes(WEB_TOOL), 'run A snapshot: web on')
    ideas = 3
    webOn = false
    const ideasA = await post(plugin.route, 'stardea', { runId: runA, questionId: 'q1' })
    assert.deepEqual(textsOf(ideasA.json), POOL.slice(0, 1), 'run A keeps its snapshot of 1 idea')
  } finally { await cancelRun(plugin.route, runA) }
  const b = await post(plugin.route, 'improve', { ...askBody, sessionId: 's2' })
  const runB = b.json?.ask?.runId
  try {
    assert.equal(toolNames(plugin.llm.calls[2]).includes(WEB_TOOL), false, 'run B: web off')
    const ideasB = await post(plugin.route, 'stardea', { runId: runB, questionId: 'q1' })
    assert.deepEqual(textsOf(ideasB.json), POOL.slice(5, 8), 'run B uses the new 3')
  } finally { await cancelRun(plugin.route, runB) }
})

// ================================================================ client harness

async function loadClient(primitives) {
  let captured = null
  globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, setTimeout, clearTimeout }
  await import('../lib/client.js?cachebust=' + String(Date.now()) + Math.random())
  return captured.factory((id) => {
    if (id === '@deepseek-ai/dsh-client-ui-primitives' && primitives !== undefined) return primitives
    if (id === 'react') return React
    if (id === 'react-dom') return require('react-dom')
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (id === 'react-dom/client') return require('react-dom/client')
    throw new Error('unexpected external: ' + id)
  })
}

function fakeCtx(services = {}) {
  const registered = []
  const locales = {}
  const ctx = {
    slots: {
      inject(_seat, fn) { const it = fn(); if (it !== undefined && typeof it.next === 'function') it.next(); return () => {} },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
    locale: { register(ns, d) { locales[ns] = d; return () => {} }, bind() { return (k) => k } },
    effect(fn) { return fn() },
    get(name) { return services[name] },
  }
  return { ctx, registered, locales }
}

/** Primitives stub (as in lookup-settings.test.mjs) recording specs; `shellState` drives writable/saving. */
function fakePrimitives({ withSwitch = true, shellState = {}, patch } = {}) {
  const record = { specs: null, numberFields: [], textFields: [] }
  class SettingsFormModel {
    constructor(scope, specs) { this.scope = scope; record.specs = specs; this.staged = new Map(); this.listeners = new Set() }
    bind(project) {
      let snap = project()
      this.fire = () => { snap = project(); for (const l of this.listeners) l() }
      return { getSnapshot: () => snap, subscribe: (l) => { this.listeners.add(l); return () => this.listeners.delete(l) } }
    }
    shell() { return { available: true, writable: true, dirty: this.staged.size > 0, invalid: false, saving: false, failed: false, ...shellState } }
    field(name) {
      const text = this.staged.has(name) ? this.staged.get(name) : String(this.scope.getSnapshot().value?.[name] ?? '')
      return { text, overridden: false, invalid: false }
    }
    actions() {
      return { edit: (f, text) => { this.staged.set(f, text); record.staged = this.staged; this.fire() }, resetField: () => {}, save: () => {}, discard: () => { this.staged.clear(); this.fire() } }
    }
    dispose() {}
  }
  const primitives = {
    SettingsFormModel,
    settingsTextField: (field) => { record.textFields.push(field); return { field } },
    settingsNumberField: (field) => { record.numberFields.push(field); return { field } },
    SettingsForm: (props) => React.createElement('form', { 'data-invalid': String(props.state.invalid) }, props.children),
    SegmentedControl: (props) => React.createElement('div', { 'data-segmented': props.id, 'data-value': props.value }),
  }
  if (withSwitch) {
    primitives.Switch = (props) => React.createElement('button', { role: 'switch', 'aria-checked': props.checked, 'aria-label': props.label, disabled: props.disabled, onClick: () => props.onChange(!props.checked) })
  }
  // `patch` removes or replaces primitives for the "required primitives" cases.
  if (patch !== undefined) patch(primitives)
  record.primitives = primitives
  return { primitives, record }
}

async function bootSection({ value = { defaultMode: 'standard', modelSource: 'conversation' }, ...opts } = {}) {
  const { primitives, record } = fakePrimitives(opts)
  const module = await loadClient(primitives)
  const scope = { getSnapshot: () => ({ status: 'ready', value, writable: true }), subscribe: () => () => {} }
  const { ctx, registered, locales } = fakeCtx({
    configForms: { get: () => scope, whileServed: (_ns, register) => register() },
    remote: { get session() { throw new Error('cannot get property "remote.session" without inject') } },
    'remote.session': { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) },
  })
  await TestRenderer.act(async () => { module.apply(ctx) })
  const entry = registered.find((r) => r.options.name === 'plugins.bundle.config')
  return { entry, record, registered, locales }
}

async function mountSection(entry) {
  const face = entry.options.inject()
  const store = face.hooks.smartPromptSettings
  const props = { ...face, view: 'page', t: (k) => k, useSmartPromptSettings: (sel) => sel(store.getSnapshot()) }
  delete props.hooks
  let renderer = null
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(entry.component, props)) })
  const rerender = async () => { await TestRenderer.act(async () => { renderer.update(React.createElement(entry.component, props)) }) }
  const numberInputs = () => renderer.root.findAll((n) => n.type === 'input' && n.props.type === 'number')
  const switches = () => renderer.root.findAll((n) => n.type === 'button' && n.props.role === 'switch')
  return { face, store, renderer, rerender, numberInputs, switches }
}

// ================================================================ client

test('SS-30 [EP specs] number fields in order maxQuestions, sessionLookupRounds, stardeaIdeas, stardeaRounds; text fields; a stardeaWebSearch spec', async () => {
  const { entry, record } = await bootSection()
  assert.ok(entry !== undefined)
  assert.deepEqual(record.numberFields, ['maxQuestions', 'sessionLookupRounds', 'stardeaIdeas', 'stardeaRounds'])
  assert.deepEqual([...record.textFields].sort(), ['dedicatedReasoningEffort', 'defaultMode', 'model', 'modelSource', 'provider'])
  const web = record.specs.find((s) => s.field === 'stardeaWebSearch')
  assert.ok(web !== undefined, 'the boolean spec is passed to the form model')
  assert.equal(typeof web.format, 'function')
  assert.equal(typeof web.parse, 'function')
})

test('SS-31 [EP boolean spec] format and parse of the stardeaWebSearch spec', async () => {
  const { record } = await bootSection()
  const web = record.specs.find((s) => s.field === 'stardeaWebSearch')
  assert.equal(web.format(true), 'true')
  assert.equal(web.format(false), 'false')
  for (const v of [undefined, null, 'true', 1, 0]) assert.equal(web.format(v), '', JSON.stringify(v))
  assert.deepEqual(web.parse(''), { kind: 'clear' })
  assert.deepEqual(web.parse('true'), { kind: 'set', value: true })
  assert.deepEqual(web.parse('false'), { kind: 'set', value: false })
  for (const v of ['TRUE', 'yes', '1', ' true']) assert.equal(web.parse(v), undefined, JSON.stringify(v))
})

test('SS-32 [EP layout] four number inputs with the right bounds and placeholders, and one Switch', async () => {
  const { entry } = await bootSection()
  const { numberInputs, switches } = await mountSection(entry)
  const inputs = numberInputs()
  assert.equal(inputs.length, 4)
  const spec = inputs.map((n) => [n.props.placeholder, n.props.min === undefined ? undefined : Number(n.props.min), n.props.max === undefined ? undefined : Number(n.props.max)])
  assert.deepEqual(spec, [['5', 1, undefined], ['3', 0, 10], ['4', 1, 8], ['1', 0, 10]])
  assert.equal(switches().length, 1)
  assert.equal(switches()[0].props['aria-label'], 'settingsStardeaWeb', 'the Switch label is the row label')
})

test('SS-33 [State switch] checked follows the staged value (empty -> false); toggling stages "true" then "false"', async () => {
  const { entry, record } = await bootSection()
  const { store, rerender, switches } = await mountSection(entry)
  assert.equal(switches()[0].props['aria-checked'], false, 'empty means the default false')
  assert.equal(store.getSnapshot().stardeaWebSearch, false)
  await TestRenderer.act(async () => { switches()[0].props.onClick() })
  await rerender()
  assert.equal(record.staged.get('stardeaWebSearch'), 'true')
  assert.equal(switches()[0].props['aria-checked'], true)
  assert.equal(store.getSnapshot().stardeaWebSearch, true)
  await TestRenderer.act(async () => { switches()[0].props.onClick() })
  await rerender()
  assert.equal(record.staged.get('stardeaWebSearch'), 'false')
  assert.equal(switches()[0].props['aria-checked'], false)
})

test('SS-34 [EP saved value] a saved stardeaWebSearch true / ideas / rounds show in the section and the store snapshot', async () => {
  const { entry } = await bootSection({ value: { defaultMode: 'standard', modelSource: 'conversation', stardeaWebSearch: true, stardeaIdeas: 6, stardeaRounds: 2 } })
  const { store, numberInputs, switches } = await mountSection(entry)
  assert.equal(switches()[0].props['aria-checked'], true)
  const snap = store.getSnapshot()
  assert.deepEqual([String(snap.stardeaIdeas), String(snap.stardeaRounds), snap.stardeaWebSearch], ['6', '2', true])
  assert.deepEqual(numberInputs().slice(2).map((n) => String(n.props.value)), ['6', '2'])
})

test('SS-35 [EP disabled] the Switch is disabled when the form is not writable or is saving', async () => {
  for (const [shellState, disabled] of [[{}, false], [{ writable: false }, true], [{ saving: true }, true]]) {
    const { entry } = await bootSection({ shellState })
    const { switches } = await mountSection(entry)
    assert.equal(Boolean(switches()[0].props.disabled), disabled, JSON.stringify(shellState))
  }
})

test('SS-36 [EP actions] setStardeaIdeas / setStardeaRounds / setStardeaWebSearch update the snapshot and the inputs', async () => {
  const { entry } = await bootSection()
  const { face, store, rerender, numberInputs } = await mountSection(entry)
  for (const name of ['setStardeaIdeas', 'setStardeaRounds', 'setStardeaWebSearch']) assert.equal(typeof face[name], 'function', name)
  await TestRenderer.act(async () => { face.setStardeaIdeas('7'); face.setStardeaRounds('5'); face.setStardeaWebSearch(true) })
  await rerender()
  const snap = store.getSnapshot()
  assert.deepEqual([snap.stardeaIdeas, snap.stardeaRounds, snap.stardeaWebSearch], ['7', '5', true])
  assert.deepEqual(numberInputs().map((n) => String(n.props.value)).slice(2), ['7', '5'])
  await TestRenderer.act(async () => { face.setStardeaWebSearch(false) })
  await rerender()
  assert.equal(store.getSnapshot().stardeaWebSearch, false)
})

test('SS-37 [BVA save] invalid stardea values block the save; valid boundaries and empty do not', async () => {
  const { entry } = await bootSection()
  const { face, store, rerender } = await mountSection(entry)
  const cases = [
    ['setStardeaIdeas', '', false], ['setStardeaIdeas', '1', false], ['setStardeaIdeas', '8', false],
    ['setStardeaIdeas', '0', true], ['setStardeaIdeas', '9', true], ['setStardeaIdeas', '2.5', true], ['setStardeaIdeas', '4', false],
    ['setStardeaRounds', '0', false], ['setStardeaRounds', '10', false], ['setStardeaRounds', '-1', true],
    ['setStardeaRounds', '11', true], ['setStardeaRounds', '2.5', true], ['setStardeaRounds', '', false],
  ]
  for (const [action, text, invalid] of cases) {
    await TestRenderer.act(async () => { face[action](text) })
    await rerender()
    assert.equal(store.getSnapshot().invalid, invalid, action + ' ' + JSON.stringify(text))
  }
})

test('SS-38 [EP locale] en and zh carry the six Stardea settings keys; English labels', async () => {
  const { locales } = await bootSection()
  const dict = locales['dsh-smart-prompt']
  const keys = ['settingsStardeaIdeas', 'settingsStardeaIdeasHint', 'settingsStardeaRounds', 'settingsStardeaRoundsHint', 'settingsStardeaWeb', 'settingsStardeaWebHint']
  for (const lang of ['en', 'zh']) for (const key of keys) assert.ok(typeof dict[lang]?.[key] === 'string' && dict[lang][key].length > 0, lang + '.' + key)
  assert.equal(dict.en.settingsStardeaIdeas, 'Stardea ideas per click')
  assert.equal(dict.en.settingsStardeaRounds, 'Stardea search rounds')
  assert.equal(dict.en.settingsStardeaWeb, 'Stardea web search')
})

test('SS-39 [EP primitives] without Switch no settings section is registered; the composer button still is', async () => {
  const { entry, registered } = await bootSection({ withSwitch: false })
  assert.equal(entry, undefined)
  assert.ok(registered.some((r) => r.options.id === 'dsh-smart-prompt-button'), 'the composer button is registered')
})

// ================================================================ supplement: orchestration

const sysText = (call) => (typeof call.system === 'string' ? call.system : JSON.stringify(call.system))
/** The number `n` stated next to the word "idea(s)", in either order. */
const statesIdeaLimit = (text, n) => new RegExp('\\b' + String(n) + '\\b[^.]{0,40}\\bideas?\\b|\\bideas?\\b[^.]{0,40}\\b' + String(n) + '\\b', 'i').test(text)

test('SS-40 [EP absent stardeaRounds] absent means 0, also when lookupRounds > 0: no web_search, and a click runs no lookup', T, async () => {
  // lookupRounds 0 + web on + stardeaRounds absent: neither the rewrite nor Stardea has rounds.
  const none = await refine({ desk: stubDesk(), web: stubWeb(), input: { lookupRounds: 0, stardeaWebSearch: true }, script: [{ text: PLAIN }] })
  assert.equal(none.out.ok, true, JSON.stringify(none.out))
  assert.deepEqual(toolNames(none.llm.calls[0]), [], 'no tools at all')

  // lookupRounds 2: the session tools are declared for the rewrite, but a click does not borrow its rounds.
  const web = stubWeb()
  const desk = stubDesk(async ({ click }) => { await click('q1'); return [] })
  const { llm } = await refine({
    desk, web, input: { lookupRounds: 2, stardeaWebSearch: true },
    script: [{ text: WITH_GAPS }, { tools: [searchCall(LOOKUP_MARK)] }, { text: ideasXml(POOL.slice(0, 1)) }, { text: ideasXml(POOL.slice(0, 1)) }],
  })
  assert.deepEqual(toolNames(llm.calls[0]), SESSION_TOOLS, 'web_search needs stardeaRounds > 0')
  assert.deepEqual(lookupsRun(llm.calls), [], 'the click ran no session search')
  assert.equal(web.calls.length, 0)
})

test('SS-41 [EP stardeaWebSearch strict] only exactly true declares web_search ("true", 1, {} and absent do not)', T, async () => {
  for (const flag of [undefined, 'true', 1, {}]) {
    const input = { lookupRounds: 0, stardeaRounds: 2, ...(flag === undefined ? {} : { stardeaWebSearch: flag }) }
    const { out, llm } = await refine({ desk: stubDesk(), web: stubWeb(), input, script: [{ text: PLAIN }] })
    assert.equal(out.ok, true, JSON.stringify(out))
    assert.deepEqual(toolNames(llm.calls[0]), SESSION_TOOLS, JSON.stringify(flag))
  }
  const on = await refine({ desk: stubDesk(), web: stubWeb(), input: { lookupRounds: 0, stardeaRounds: 2, stardeaWebSearch: true }, script: [{ text: PLAIN }] })
  assert.deepEqual(toolNames(on.llm.calls[0]), ALL_TOOLS, 'true')
})

test('SS-42 [EP system prompt] the system prompt states the configured ideas limit (2 vs 7; absent -> 4)', T, async () => {
  const systems = {}
  for (const ideas of [2, 7, undefined]) {
    const input = ideas === undefined ? {} : { stardeaIdeas: ideas }
    const { out, llm } = await refine({ messages: null, desk: stubDesk(), input, script: [{ text: PLAIN }] })
    assert.equal(out.ok, true, JSON.stringify(out))
    systems[String(ideas)] = sysText(llm.calls[0])
  }
  assert.ok(statesIdeaLimit(systems['2'], 2), 'states 2: ' + systems['2'])
  assert.ok(statesIdeaLimit(systems['7'], 7), 'states 7: ' + systems['7'])
  assert.ok(statesIdeaLimit(systems.undefined, 4), 'states the default 4: ' + systems.undefined)
  assert.notEqual(systems['2'], systems['7'], 'the limit is part of the system prompt')
})

test('SS-45 [EP rewrite with answers] web_search there is "Not run"; with lookupRounds 0 its session search does not run', T, async () => {
  const answer = [{ id: 'q1', selected: [], custom: '每分钟 100 次' }]
  const web = stubWeb()
  const { out, llm } = await refine({
    desk: stubDesk(async () => answer), web, input: { lookupRounds: 2, stardeaRounds: 1, stardeaWebSearch: true },
    script: [{ text: WITH_GAPS }, { tools: [webCall('answers query')] }, { text: FOLDED }],
  })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.text, FOLDED)
  assert.equal(web.calls.length, 0, 'the rewrite with answers never searches the web')
  const result = toolResult(llm.calls[2], 'call-2-1')
  assert.ok(result !== undefined, 'the web_search call got a tool result')
  assert.ok(textOf(result).startsWith(NOT_RUN), textOf(result))

  // The outcome of an over-budget reply is unspecified; only that no lookup ran is asserted.
  const zero = await refine({
    desk: stubDesk(async () => answer), input: { lookupRounds: 0, stardeaRounds: 2 },
    script: [{ text: WITH_GAPS }, { tools: [searchCall(LOOKUP_MARK)] }, { text: FOLDED }, { text: FOLDED }],
  })
  assert.deepEqual(toolNames(zero.llm.calls[0]), SESSION_TOOLS, 'declared for Stardea')
  assert.deepEqual(lookupsRun(zero.llm.calls), [], 'the rewrite with answers ran no lookup')
})

// ================================================================ supplement: HTTP route

/** A sessionQuery service whose log holds the lookup transcript (see messagesOfLog). */
const sessionQuery = { readSession: async () => ({ events: TRANSCRIPT.map((data) => ({ type: 'user/message', data })) }) }

test('SS-43 [Decision route] stardeaRounds 2 from the settings gives a click two web rounds (not the default 1, not sessionLookupRounds 0)', T, async () => {
  const web = stubWeb()
  const plugin = mountPlugin({
    raw: { sessionLookupRounds: 0, stardeaRounds: 2, stardeaWebSearch: true }, web,
    script: [{ text: WITH_GAPS }, { tools: [webCall('r1')] }, { tools: [webCall('r2')] }, { text: ideasXml(POOL.slice(0, 2)) }],
  })
  const asked = await post(plugin.route, 'improve', askBody)
  const runId = asked.json?.ask?.runId
  try {
    assert.equal(typeof runId, 'string', JSON.stringify(asked.json))
    const ideas = await post(plugin.route, 'stardea', { runId, questionId: 'q1' })
    assert.equal(ideas.json.ok, true, JSON.stringify(ideas.json))
    assert.deepEqual(web.calls.map((c) => c.query), ['r1', 'r2'])
    assert.deepEqual(textsOf(ideas.json), POOL.slice(0, 2))
  } finally { await cancelRun(plugin.route, runId) }
})

test('SS-44 [Decision route] sessionLookupRounds 3 + stardeaRounds 0: the rewrite looks up, a click does not; no web_search', T, async () => {
  // The outcome of the click's unrun tool call is unspecified; only the lookups that ran are asserted.
  const web = stubWeb()
  const plugin = mountPlugin({
    raw: { sessionLookupRounds: 3, stardeaRounds: 0, stardeaWebSearch: true }, web, extra: { sessionQuery },
    script: [{ tools: [searchCall(LOOKUP_MARK)] }, { text: WITH_GAPS }, { tools: [searchCall(LOOKUP_MARK)] }, { text: ideasXml(POOL.slice(0, 1)) }, { text: ideasXml(POOL.slice(0, 1)) }],
  })
  const asked = await post(plugin.route, 'improve', askBody)
  const runId = asked.json?.ask?.runId
  try {
    assert.equal(typeof runId, 'string', JSON.stringify(asked.json))
    assert.deepEqual(toolNames(plugin.llm.calls[0]), SESSION_TOOLS)
    await post(plugin.route, 'stardea', { runId, questionId: 'q1' })
    assert.deepEqual(lookupsRun(plugin.llm.calls), ['call-1-1'], 'only the rewrite lookup ran')
    assert.equal(web.calls.length, 0)
  } finally { await cancelRun(plugin.route, runId) }
})

// ================================================================ supplement: client

const REQUIRED_PRIMITIVES = ['SettingsFormModel', 'SettingsForm', 'SegmentedControl', 'Switch', 'settingsTextField', 'settingsNumberField']

test('SS-46 [EP primitives] each required primitive missing or null: no settings section; the composer button still registers', async () => {
  for (const name of REQUIRED_PRIMITIVES) {
    for (const [how, patch] of [['missing', (p) => { delete p[name] }], ['null', (p) => { p[name] = null }]]) {
      const { entry, registered } = await bootSection({ patch })
      assert.equal(entry, undefined, name + ' ' + how)
      assert.ok(registered.some((r) => r.options.id === 'dsh-smart-prompt-button'), name + ' ' + how + ': button')
    }
  }
})

test('SS-47 [EP row order] rows: method, model (+ dedicated picker), questions, lookup rounds, Stardea ideas, Stardea rounds, Stardea web', async () => {
  const { entry } = await bootSection({ value: { defaultMode: 'standard', modelSource: 'dedicated' } })
  const { renderer } = await mountSection(entry)
  const text = JSON.stringify(renderer.toJSON())
  const labels = ['settingsMode', 'settingsModel', 'settingsMaxQuestions', 'settingsLookupRounds', 'settingsStardeaIdeas', 'settingsStardeaRounds', 'settingsStardeaWeb']
  const at = labels.map((l) => text.indexOf('"' + l + '"'))
  assert.ok(at.every((i) => i >= 0), 'every row label is shown: ' + JSON.stringify(at))
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i - 1] < at[i], labels[i - 1] + ' before ' + labels[i])
  const kinds = renderer.root.findAll((n) => n.type === 'select' || (n.type === 'input' && n.props.type === 'number') || (n.type === 'button' && n.props.role === 'switch'))
    .map((n) => (n.type === 'select' ? 'select' : n.type === 'input' ? 'number' : 'switch'))
  assert.deepEqual(kinds, ['select', 'number', 'number', 'number', 'number', 'switch'], 'the dedicated picker sits under Model; the Switch is last')
})

test('SS-48 [State switch] saved on: onChange(false) stages "false", onChange(true) stages "true", discard returns to the saved on', async () => {
  const { entry, record } = await bootSection({ value: { defaultMode: 'standard', modelSource: 'conversation', stardeaWebSearch: true } })
  const { face, store, renderer, rerender } = await mountSection(entry)
  const sw = () => renderer.root.findAll((n) => n.type === record.primitives.Switch)[0]
  assert.equal(sw().props.checked, true)
  assert.equal(sw().props.label, 'settingsStardeaWeb')
  await TestRenderer.act(async () => { sw().props.onChange(false) })
  await rerender()
  assert.equal(record.staged.get('stardeaWebSearch'), 'false')
  assert.deepEqual([sw().props.checked, store.getSnapshot().stardeaWebSearch], [false, false])
  await TestRenderer.act(async () => { sw().props.onChange(true) })
  await rerender()
  assert.equal(record.staged.get('stardeaWebSearch'), 'true')
  assert.equal(sw().props.checked, true)
  await TestRenderer.act(async () => { sw().props.onChange(false) })
  await TestRenderer.act(async () => { face.discard() })
  await rerender()
  assert.deepEqual([sw().props.checked, store.getSnapshot().stardeaWebSearch], [true, true], 'discard shows the saved value again')
})

test('SS-49 [State input] typing in the Stardea inputs updates the snapshot; invalid -> valid unblocks the save', async () => {
  const { entry } = await bootSection()
  const { store, rerender, numberInputs } = await mountSection(entry)
  const type = async (i, value) => {
    await TestRenderer.act(async () => { numberInputs()[i].props.onChange({ target: { value }, currentTarget: { value } }) })
    await rerender()
  }
  for (const [i, key, text, invalid] of [[2, 'stardeaIdeas', '9', true], [2, 'stardeaIdeas', '8', false], [3, 'stardeaRounds', '11', true], [3, 'stardeaRounds', '10', false], [3, 'stardeaRounds', '0', false], [2, 'stardeaIdeas', '0', true], [2, 'stardeaIdeas', '1', false]]) {
    await type(i, text)
    assert.equal(String(store.getSnapshot()[key]), text, key + ' ' + text)
    assert.equal(store.getSnapshot().invalid, invalid, key + ' ' + text)
  }
})
