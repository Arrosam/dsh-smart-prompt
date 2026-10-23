// Answer reuse on retry (requirement 2), black-box through improveDraft.
// Techniques: State transition (Empty -> Remembered -> {kept on failure, Empty on
// success}), Decision table (same/different session x same/different draft x
// answered/not), EP (failure kinds: upstream, length, abort; reply kinds: answered,
// partial, skipped, rejected), BVA (sessionId '' vs non-empty, 0 vs >=1 answers).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'
import { AnswerMemory } from '../lib/answer-memory.js'

/**
 * Scripted model. A step is a reply string, `{ throw }` for an upstream error, or
 * `{ abort: controller }` which aborts the caller's request mid-call.
 */
function stubLlm(script) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      const step = script.length > 0 ? script.shift() : ''
      const signal = options.signal
      return (async function* () {
        if (typeof step === 'object' && step.throw !== undefined) throw new Error(step.throw)
        if (typeof step === 'object' && step.abort !== undefined) {
          step.abort.abort()
          await new Promise((resolve) => {
            if (signal.aborted) return resolve()
            const timer = setTimeout(resolve, 2000)
            signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
          })
          return
        }
        if (step !== '') yield { type: 'text-delta', index: 0, text: step }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** Records every question card it is shown and answers with `reply` (or throws it). */
function stubAsk(reply) {
  const asked = []
  return {
    asked,
    askUser: () => async (questions) => {
      asked.push(questions)
      if (reply instanceof Error) throw reply
      return reply
    },
  }
}

const textOf = (message) => message.content.map((p) => p.text ?? '').join('')
/** Text of a request's first user turn (a retry folds remembered answers into it). */
const userText = (call) => textOf(call.messages[0])
/** Text of a request's latest user turn (an answers rewrite is appended as a new turn). */
const lastUserText = (call) => textOf(call.messages.filter((m) => m.role === 'user').at(-1))

const DRAFT = '给那个接口加上限流'
const OTHER_DRAFT = '给那个页面加上缓存'
const WITH_GAPS = '给那个接口加上限流。\n- 目标接口：(TBD)\n- 阈值：(TBD)\n<missing_info>\n<question>是哪个接口？</question>\n<question>限流阈值是多少？</question>\n</missing_info>'
const FOLDED = '给 /api/login 接口加上限流，阈值每分钟 100 次。'
const BOTH = { answers: [{ id: 'q1', selected: [], custom: '/api/login' }, { id: 'q2', selected: [], custom: '每分钟 100 次' }] }
const ONE = { answers: [{ id: 'q1', selected: [], custom: '/api/login' }, { id: 'q2', selected: [] }] }
// Answers without hard facts, so the fidelity gate cannot re-append them and outrank the length gate.
const SOFT = { answers: [{ id: 'q1', selected: [], custom: '登录接口' }, { id: 'q2', selected: [], custom: '按用户限流' }] }
const SKIPPED = { answers: [{ id: 'q1', selected: [] }, { id: 'q2', selected: [] }] }

/** One improveDraft call against a shared memory. */
function run({ llm, ask, answers, cfg = resolveConfig({}), ...over }) {
  return improveDraft(
    { llm, selection: { provider: 'p', model: 'm' }, lastRoute: null, askUser: ask?.askUser, answers },
    cfg,
    { draft: DRAFT, sessionId: 's1', mode: 'standard', signal: new AbortController().signal, maxQuestions: 5, ...over },
  )
}

/** First attempt: questions answered with BOTH, then the folding call fails upstream. */
async function failAfterAnswering(memory, over = {}) {
  const llm = stubLlm([WITH_GAPS, { throw: 'gateway exploded' }])
  const ask = stubAsk(over.reply ?? BOTH)
  const out = await run({ llm, ask, answers: memory, ...over })
  assert.equal(out.ok, false, 'the first attempt must fail: ' + JSON.stringify(out))
  assert.equal(ask.asked.length, 1, 'the first attempt asks')
  return out
}

/** Assert a retry reused the answers: no card, one folding call carrying them. */
function assertReused(llm, ask) {
  assert.equal(ask.asked.length, 0, 'askUser must not be called again')
  assert.equal(llm.calls.length, 1, 'only the answer-folding call, no question-generation call')
  assert.match(userText(llm.calls[0]), /<user_answers>[\s\S]*<\/user_answers>/)
}

// ---------------------------------------------------------------- AnswerMemory state machine

test('RA-01 [State] recall is empty until remembered, returns the memo, and forget empties it', () => {
  const memory = new AnswerMemory()
  const memo = { asked: 2, answered: [{ question: '是哪个接口？', answer: '/api/login' }] }
  assert.equal(memory.recall('s1', DRAFT), undefined)
  memory.remember('s1', DRAFT, memo)
  assert.deepEqual(memory.recall('s1', DRAFT), memo)
  assert.equal(memory.recall('s1', OTHER_DRAFT), undefined, 'keyed by draft')
  assert.equal(memory.recall('s2', DRAFT), undefined, 'keyed by session')
  memory.forget('s1')
  assert.equal(memory.recall('s1', DRAFT), undefined)
})

test('RA-02 [State] forgetting one session leaves another intact', () => {
  const memory = new AnswerMemory()
  const memo = { asked: 1, answered: [{ question: 'q', answer: 'a' }] }
  memory.remember('s1', DRAFT, memo)
  memory.remember('s2', DRAFT, memo)
  memory.forget('s1')
  assert.equal(memory.recall('s1', DRAFT), undefined)
  assert.deepEqual(memory.recall('s2', DRAFT), memo)
})

// ---------------------------------------------------------------- reuse after each failure kind

// RA-03 and RA-06 need a card holding both questions: light keeps that single round (standard
// and detailed ask one question per card; their memo retries are in detailed-rounds and
// standard-rounds tests).
test('RA-03 [EP upstream] after the folding call fails, the retry folds the previous answers without asking', async () => {
  const memory = new AnswerMemory()
  const first = await failAfterAnswering(memory, { mode: 'light' })
  assert.equal(first.code, 'UPSTREAM')

  const llm = stubLlm([FOLDED])
  const ask = stubAsk(BOTH)
  const out = await run({ llm, ask, answers: memory, mode: 'light' })
  assert.equal(out.ok, true, JSON.stringify(out))
  assertReused(llm, ask)
  const body = userText(llm.calls[0])
  assert.match(body, /是哪个接口？[\s\S]*\/api\/login/)
  assert.match(body, /限流阈值是多少？[\s\S]*每分钟 100 次/)
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 })
  assert.equal(out.text, FOLDED)
})

test('RA-04 [EP length] after LENGTH_EXCEEDED in light mode, the retry reuses the answers', async () => {
  const memory = new AnswerMemory()
  // Default light ratio (2.0). Length base = draft + '\n' + answers joined by '\n'
  // (20 chars), so the budget is max(600, 40) = 600; both 5000-char rewrites exceed it,
  // and the SOFT answers carry no hard facts, so nothing is re-appended to outrank it.
  const cfg = resolveConfig({})
  const llm1 = stubLlm([WITH_GAPS, 'x'.repeat(5000), 'y'.repeat(5000)])
  const ask1 = stubAsk(SOFT)
  const first = await run({ llm: llm1, ask: ask1, answers: memory, cfg, mode: 'light' })
  assert.equal(first.code, 'LENGTH_EXCEEDED', JSON.stringify(first))
  assert.match(first.message, /5000 > 600/)
  assert.equal(ask1.asked.length, 1)
  assert.equal(llm1.calls.length, 3, 'question generation + answer folding + one length repair')
  assert.match(lastUserText(llm1.calls[1]), /<user_answers>/)

  const llm = stubLlm(['给登录接口加上按用户的限流。'])
  const ask = stubAsk(SOFT)
  const out = await run({ llm, ask, answers: memory, cfg, mode: 'light' })
  assert.equal(out.ok, true, JSON.stringify(out))
  assertReused(llm, ask)
  assert.match(userText(llm.calls[0]), /按用户限流/)
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 })
})

test('RA-05 [EP abort] after the request is aborted during the folding call, the retry reuses the answers', async () => {
  const memory = new AnswerMemory()
  const controller = new AbortController()
  const llm1 = stubLlm([WITH_GAPS, { abort: controller }])
  const ask1 = stubAsk(BOTH)
  const first = await run({ llm: llm1, ask: ask1, answers: memory, signal: controller.signal })
  assert.equal(first.ok, false)
  assert.equal(ask1.asked.length, 1)

  const llm = stubLlm([FOLDED])
  const ask = stubAsk(BOTH)
  const out = await run({ llm, ask, answers: memory })
  assert.equal(out.ok, true, JSON.stringify(out))
  assertReused(llm, ask)
})

test('RA-06 [EP partial] a partially answered card is reused with its original counts', async () => {
  const memory = new AnswerMemory()
  await failAfterAnswering(memory, { reply: ONE, mode: 'light' })

  const llm = stubLlm([FOLDED])
  const ask = stubAsk(BOTH)
  const out = await run({ llm, ask, answers: memory, mode: 'light' })
  assert.equal(out.ok, true)
  assertReused(llm, ask)
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 1 })
  assert.match(userText(llm.calls[0]), /\/api\/login/)
  assert.doesNotMatch(userText(llm.calls[0]), /每分钟 100 次/, 'a skipped question carries no answer')
})

// ---------------------------------------------------------------- state transitions across attempts

test('RA-07 [State] Remembered survives a failed retry and is still reused on the next one', async () => {
  const memory = new AnswerMemory()
  await failAfterAnswering(memory)

  const llm2 = stubLlm([{ throw: 'still down' }])
  const ask2 = stubAsk(BOTH)
  const second = await run({ llm: llm2, ask: ask2, answers: memory })
  assert.equal(second.code, 'UPSTREAM')
  assertReused(llm2, ask2)

  const llm3 = stubLlm([FOLDED])
  const ask3 = stubAsk(BOTH)
  const third = await run({ llm: llm3, ask: ask3, answers: memory })
  assert.equal(third.ok, true)
  assertReused(llm3, ask3)
})

test('RA-08 [State] Remembered -> success -> Empty: the next identical request asks again', async () => {
  const memory = new AnswerMemory()
  await failAfterAnswering(memory)
  const retry = await run({ llm: stubLlm([FOLDED]), ask: stubAsk(BOTH), answers: memory })
  assert.equal(retry.ok, true)
  assert.equal(memory.recall('s1', DRAFT), undefined, 'success forgets the session')

  const llm = stubLlm([WITH_GAPS, FOLDED])
  const ask = stubAsk(BOTH)
  const out = await run({ llm, ask, answers: memory })
  assert.equal(out.ok, true)
  assert.equal(ask.asked.length, 1, 'asked again')
  assert.equal(llm.calls.length, 2, 'question generation + folding')
})

test('RA-09 [State] a first-attempt success leaves nothing to reuse', async () => {
  const memory = new AnswerMemory()
  const first = await run({ llm: stubLlm([WITH_GAPS, FOLDED]), ask: stubAsk(BOTH), answers: memory })
  assert.equal(first.ok, true)
  assert.equal(memory.recall('s1', DRAFT), undefined)

  const ask = stubAsk(BOTH)
  const llm = stubLlm([WITH_GAPS, FOLDED])
  await run({ llm, ask, answers: memory })
  assert.equal(ask.asked.length, 1)
})

test('RA-10 [State] a success on another draft in the same session also clears the memory', async () => {
  const memory = new AnswerMemory()
  await failAfterAnswering(memory)
  const other = await run({ llm: stubLlm(['给那个页面加上缓存。']), ask: stubAsk(BOTH), answers: memory, draft: OTHER_DRAFT })
  assert.equal(other.ok, true)

  const ask = stubAsk(BOTH)
  await run({ llm: stubLlm([WITH_GAPS, FOLDED]), ask, answers: memory })
  assert.equal(ask.asked.length, 1, 'memory for the session was forgotten on success')
})

// ---------------------------------------------------------------- decision table: key match

test('RA-11 [Decision] same session, different draft: asks again', async () => {
  const memory = new AnswerMemory()
  await failAfterAnswering(memory)
  const llm = stubLlm([WITH_GAPS, '给 /web/home 页面加上缓存。'])
  const ask = stubAsk(BOTH)
  await run({ llm, ask, answers: memory, draft: OTHER_DRAFT })
  assert.equal(ask.asked.length, 1)
  assert.doesNotMatch(userText(llm.calls[0]), /<user_answers>/, 'the first call is question generation')
})

test('RA-12 [Decision] different session, same draft: asks again', async () => {
  const memory = new AnswerMemory()
  await failAfterAnswering(memory)
  const llm = stubLlm([WITH_GAPS, FOLDED])
  const ask = stubAsk(BOTH)
  await run({ llm, ask, answers: memory, sessionId: 's2' })
  assert.equal(ask.asked.length, 1)
  assert.doesNotMatch(userText(llm.calls[0]), /<user_answers>/)
  assert.ok(memory.recall('s1', DRAFT) !== undefined, 'the other session keeps its memory')
})

// ---------------------------------------------------------------- nothing remembered

test('RA-13 [BVA 0 answers] skipped questions are not remembered; the retry asks again', async () => {
  const memory = new AnswerMemory()
  const cfg = resolveConfig({})
  // Skipping keeps the first rewrite; make it too long in light mode so the request fails.
  const longGaps = 'z'.repeat(5000) + WITH_GAPS
  const first = await run({ llm: stubLlm([longGaps, 'y'.repeat(5000)]), ask: stubAsk(SKIPPED), answers: memory, cfg, mode: 'light' })
  assert.equal(first.code, 'LENGTH_EXCEEDED')
  assert.equal(memory.recall('s1', DRAFT), undefined)

  const ask = stubAsk(BOTH)
  await run({ llm: stubLlm([WITH_GAPS, FOLDED]), ask, answers: memory, cfg, mode: 'light' })
  assert.equal(ask.asked.length, 1)
})

test('RA-14 [EP rejected] a closed question card (askUser rejects) is not remembered', async () => {
  const memory = new AnswerMemory()
  const cfg = resolveConfig({})
  const longGaps = 'z'.repeat(5000) + WITH_GAPS
  const first = await run({ llm: stubLlm([longGaps, 'y'.repeat(5000)]), ask: stubAsk(new Error('ASK_CANCELLED')), answers: memory, cfg, mode: 'light' })
  assert.equal(first.ok, false)
  assert.equal(memory.recall('s1', DRAFT), undefined)

  const ask = stubAsk(BOTH)
  await run({ llm: stubLlm([WITH_GAPS, FOLDED]), ask, answers: memory, cfg, mode: 'light' })
  assert.equal(ask.asked.length, 1)
})

test('RA-15 [BVA sessionId] a request with sessionId "" never remembers anything', async () => {
  const remembered = []
  class SpyMemory extends AnswerMemory {
    remember(sessionId, draft, memo) { remembered.push(sessionId); return super.remember(sessionId, draft, memo) }
  }
  const memory = new SpyMemory()
  const out = await run({ llm: stubLlm([WITH_GAPS, { throw: 'down' }]), ask: stubAsk(BOTH), answers: memory, sessionId: '' })
  assert.ok(!remembered.includes(''), 'remember is never called for sessionId ""')
  assert.equal(memory.recall('', DRAFT), undefined)
  assert.ok(out !== undefined)
})

test('RA-16 [EP] without an answers memory the retry behaves as before (asks again)', async () => {
  await failAfterAnswering(undefined)
  const ask = stubAsk(BOTH)
  const out = await run({ llm: stubLlm([WITH_GAPS, FOLDED]), ask, answers: undefined })
  assert.equal(out.ok, true)
  assert.equal(ask.asked.length, 1)
})

// ================================================================ client: Retry in the error bubble (requirement 3)
// System level: the BUILT client bundle, booted through the slot registration path,
// with a stubbed global fetch and a manual clock behind window.setTimeout.
// Techniques: State transition (idle -> busy -> error -> busy -> done | error),
// EP (failure kinds: host ok:false, network rejection; bubble kinds: error, done),
// BVA (auto-hide at 11999 ms vs 12000 ms).
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer from 'react-test-renderer'

const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** Manual clock: window.setTimeout timers only fire when advanced. */
function manualClock() {
  let now = 0
  let seq = 0
  const timers = new Map()
  return {
    setTimeout: (fn, ms) => { seq += 1; timers.set(seq, { fn, at: now + (ms ?? 0) }); return seq },
    clearTimeout: (id) => { timers.delete(id) },
    advance(ms) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = target
    },
  }
}

async function bootClient() {
  let captured = null
  const clock = manualClock()
  globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }
  await import('../lib/client.js?cachebust=' + String(Date.now()) + Math.random())
  assert.ok(captured !== null, 'bundle must call window.__ModuleLoader__.load')
  const module = captured.factory((id) => {
    if (id === 'react') return React
    if (id === 'react-dom') return require('react-dom')
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (id === 'react-dom/client') return require('react-dom/client')
    throw new Error('unexpected external: ' + id)
  })
  const registered = []
  const dicts = {}
  const ctx = {
    slots: {
      inject(_seat, fn) { const it = fn(); if (it !== undefined && typeof it.next === 'function') it.next(); return () => {} },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
    locale: {
      register(ns, d) { dicts[ns] = d; return () => {} },
      // Harness convention: an unregistered key comes back unchanged.
      bind() { return (key) => key },
    },
    effect(fn) { return fn() },
    get() { return undefined },
  }
  await TestRenderer.act(async () => { module.apply(ctx) })
  const button = registered.find((r) => r.options.id === 'dsh-smart-prompt-button').component
  const bar = registered.find((r) => r.options.id === 'dsh-smart-prompt-bar').component
  return { button, bar, clock, dicts }
}

async function mountEl(Component, props) {
  let renderer = null
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Component, props)) })
  return renderer
}

const ORIGINAL = '把那个接口加上限流'
const REWRITTEN = '为登录接口增加按 IP 的限流，每分钟 60 次。'
const okReply = () => ({ json: async () => ({ ok: true, text: REWRITTEN, meta: { mode: 'standard', model: 'p/m', ratio: 1.4, ratioLabel: '1.4x', elapsedMs: 2100, anchors: { total: 0, kept: 0, reinjected: 0 }, note: '', contextUsed: 'none' } }) })
const failReply = () => ({ json: async () => ({ ok: false, code: 'UPSTREAM_X', message: 'gateway exploded' }) })

/** Composer button over a live draft (setDraft really rewrites it) plus the status bar, same session. */
async function mountComposer(env) {
  const live = { draft: ORIGINAL, written: [] }
  const actions = { setDraft: (text) => { live.draft = text; live.written.push(text) } }
  const props = () => ({ sessionId: 's1', useInput: (sel) => sel({ draft: live.draft, phase: 'plain' }), inputActions: actions, t: (k) => k })
  // Render through the registered slot components, as the host does.
  live.button = await mountEl(env.button, props())
  live.bar = await mountEl(env.bar, { sessionId: 's1' })
  live.rerender = async () => { await TestRenderer.act(async () => { live.button.update(React.createElement(env.button, props())) }) }
  live.bubble = () => live.bar.root.findAll((n) => n.props.className === 'dip-bar')
  live.retry = () => live.bar.root.findAll((n) => n.props.className === 'dip-bar-retry' && typeof n.type === 'string')
  live.clickImprove = async () => { await TestRenderer.act(async () => { await live.button.root.findAllByProps({ className: 'dip-btn' })[0].props.onClick() }) }
  live.flush = async () => { await TestRenderer.act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)) }) }
  return live
}

/** A DOM-like click event for handlers that stop propagation or prevent default. */
const clickEvent = () => ({ preventDefault() {}, stopPropagation() {} })

/** Install a fetch stub answering from `replies` (functions or 'hold' for a manual deferred). */
function stubFetch(replies) {
  const sent = []
  const held = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    sent.push({ url, method: init.method, body: JSON.parse(init.body) })
    const next = replies.shift()
    if (next === 'hold') return new Promise((resolve) => { held.push(resolve) })
    if (next instanceof Error) throw next
    return next()
  }
  return { sent, held, restore: () => { globalThis.fetch = original } }
}

test('RB-01 [EP error/done] a failed request shows an error bubble with a Retry button; locale en says "Retry"', async () => {
  const env = await bootClient()
  const net = stubFetch([failReply])
  try {
    const live = await mountComposer(env)
    await live.clickImprove()
    await live.flush()
    const bubble = live.bubble()
    assert.equal(bubble.length, 1)
    assert.equal(bubble[0].props['data-kind'], 'error')
    assert.match(JSON.stringify(live.bar.toJSON()), /gateway exploded/, 'the error text is shown')
    const retry = live.retry()
    assert.equal(retry.length, 1, 'exactly one .dip-bar-retry')
    assert.match(JSON.stringify(live.bar.toJSON()), /"retry"/, 'labelled via the "retry" locale key (t echoes keys)')
    const en = Object.values(env.dicts)[0]?.en
    assert.equal(en?.retry, 'Retry')
  } finally { net.restore() }
})

test('RB-02 [EP network] a rejected fetch also offers Retry', async () => {
  const env = await bootClient()
  const net = stubFetch([new TypeError('network down')])
  try {
    const live = await mountComposer(env)
    await live.clickImprove()
    await live.flush()
    assert.equal(live.bubble()[0].props['data-kind'], 'error')
    assert.equal(live.retry().length, 1)
  } finally { net.restore() }
})

test('RB-03 [State error->busy->done] Retry re-sends the original draft and session, goes busy, then writes the result', async () => {
  const env = await bootClient()
  const net = stubFetch([failReply, 'hold'])
  try {
    const live = await mountComposer(env)
    await live.clickImprove()
    await live.flush()
    // The user edits the composer after the failure; Retry still uses the original.
    live.draft = ORIGINAL + ' 另外加日志'
    await live.rerender()

    await TestRenderer.act(async () => { live.retry()[0].props.onClick(clickEvent()) })
    await live.flush()
    assert.equal(net.sent.length, 2, 'Retry issues a second request')
    assert.equal(net.sent[1].url, '/dsh-smart-prompt/api/improve')
    assert.equal(net.sent[1].method, 'POST')
    assert.equal(net.sent[1].body.text, ORIGINAL, 'the draft as it was when the failed request started')
    assert.equal(net.sent[1].body.sessionId, 's1')

    await live.rerender()
    assert.equal(live.button.root.findAll((n) => n.props['data-busy'] === 'true').length, 1, 'the composer button shows busy')
    // The old error bubble may still be sliding out; no ACTIVE bubble is shown while busy.
    assert.equal(live.bubble().filter((b) => b.props['data-state'] !== 'leaving').length, 0, 'no active bubble while busy')

    await TestRenderer.act(async () => { net.held[0](okReply()) })
    await live.flush()
    assert.deepEqual(live.written, [REWRITTEN], 'setDraft receives the rewrite')
    const bubble = live.bubble()
    assert.equal(bubble[0].props['data-kind'], 'done')
    assert.equal(live.retry().length, 0, 'the success bubble has no Retry button')
  } finally { net.restore() }
})

test('RB-04 [State error->busy->error] a Retry that fails again offers Retry again with the same original text', async () => {
  const env = await bootClient()
  const net = stubFetch([failReply, failReply, okReply])
  try {
    const live = await mountComposer(env)
    await live.clickImprove()
    await live.flush()
    await TestRenderer.act(async () => { live.retry()[0].props.onClick(clickEvent()) })
    await live.flush()
    assert.equal(live.bubble()[0].props['data-kind'], 'error')
    assert.equal(live.retry().length, 1)
    await TestRenderer.act(async () => { live.retry()[0].props.onClick(clickEvent()) })
    await live.flush()
    assert.deepEqual(net.sent.map((s) => s.body.text), [ORIGINAL, ORIGINAL, ORIGINAL])
    assert.deepEqual(net.sent.map((s) => s.body.sessionId), ['s1', 's1', 's1'])
    assert.deepEqual(live.written, [REWRITTEN])
  } finally { net.restore() }
})

test('RB-05 [EP done] a successful first request shows no Retry in the bubble', async () => {
  const env = await bootClient()
  const net = stubFetch([okReply])
  try {
    const live = await mountComposer(env)
    await live.clickImprove()
    await live.flush()
    assert.equal(live.bubble()[0].props['data-kind'], 'done')
    assert.equal(live.retry().length, 0)
  } finally { net.restore() }
})

test('RB-06 [BVA 12s] the error bubble is still shown at 11999 ms and auto-hides at 12000 ms', async () => {
  const env = await bootClient()
  const net = stubFetch([failReply])
  try {
    const live = await mountComposer(env)
    await live.clickImprove()
    await live.flush()
    await TestRenderer.act(async () => { env.clock.advance(11999) })
    assert.equal(live.bubble().length, 1)
    assert.equal(live.bubble()[0].props['data-state'], 'entering')
    assert.equal(live.retry().length, 1)
    await TestRenderer.act(async () => { env.clock.advance(1) })
    const after = live.bubble()
    assert.ok(after.length === 0 || after[0].props['data-state'] === 'leaving', 'hidden (or sliding out) at 12 s')
    await TestRenderer.act(async () => { env.clock.advance(1000) })
    assert.equal(live.bar.toJSON(), null, 'gone after the exit animation')
  } finally { net.restore() }
})
