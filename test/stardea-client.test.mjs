// Stardea (星念), client side. System level: the BUILT client bundle (lib/client.js) booted
// through module.apply(ctx) with a fake cordis context, a fake ui session service
// (registerPendingInteraction), react-test-renderer and a stubbed global fetch. Expected
// outcomes come from the Stardea working contract (client UI contract + HTTP API) only.
//
// Techniques:
//  - Decision table: host capabilities (ctx.inject x uiSession x registerPendingInteraction)
//    -> follow-up entry registered, `interactive` sent; answer composition per question
//    (ideas x own words x nothing).
//  - State transition: idle -> asking (published) -> {Stardea pending -> ideas appended}* ->
//    submitted | skipped | closed (unpublished) -> busy -> done | error; busy star click
//    while /answer is pending -> aborted; deferred uiSession mount (before -> after).
//  - EP: /stardea outcomes (ideas, ok:false, network rejection); select() inputs (ours,
//    another kind, none); locale (en, zh).
//  - BVA: ideas per click 0 / 2 / 4; token usage all-zero vs present vs absent; checkbox
//    toggled once vs twice.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer from 'react-test-renderer'

const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const NS = 'dsh-smart-prompt'
const API = '/dsh-smart-prompt/api'
const FOLLOW_UP_ID = 'dsh-smart-prompt-follow-up'
const FOLLOW_UP_KIND = 'dsh-smart-prompt-follow-up'
const COMPOSER_SEAT = 'conversation.composer'
const RUN = 'run-7'
const T = { timeout: 15000 }

const ORIGINAL = '给那个接口加上限流'
const FIRST_REWRITE = '给那个接口加上限流。\n- 阈值：(TBD)'
const REWRITTEN = '给 /api/login 接口加上限流，每分钟 100 次。'
const Q1 = '限流阈值是多少？'
const Q2 = '按什么维度限流？'
const QUESTIONS = [{ id: 'q1', question: Q1 }, { id: 'q2', question: Q2 }]
const IDEAS_A = [
  { id: 'i1', text: '每分钟 100 次', source: 'web' },
  { id: 'i2', text: '每分钟 60 次', source: 'conversation' },
  { id: 'i3', text: '每秒 10 次', source: 'proposal' },
  { id: 'i4', text: '按套餐分级', source: 'proposal' },
]
const IDEAS_B = [{ id: 'i5', text: '每小时 1000 次', source: 'proposal' }, { id: 'i6', text: '突发上限 20', source: 'web' }]
const IDEAS_Q2 = [{ id: 'i7', text: '按 IP', source: 'conversation' }]
const OWN_1 = '突发可以放宽'
const OWN_2 = '按用户和 IP'
const META = { mode: 'standard', model: 'p/m', ratio: 1.4, ratioLabel: '1.4x', elapsedMs: 2100, anchors: { total: 0, kept: 0, reinjected: 0 }, note: '', contextUsed: 'none' }
const USAGE = { input: 1200, cached: 3400, output: 560 }
const NEW_LOCALE_KEYS = ['askTitle', 'askOriginal', 'askOwnWords', 'askSkip', 'askSubmit', 'askCancel', 'stardea', 'stardeaAria', 'tokens']

/** Harness convention: the translator echoes the key. */
const t = (key) => key

// ================================================================ harness

/**
 * window timers: short deferrals (<= 50 ms) run for real; longer ones (the 8 s / 12 s bubble
 * auto-hide, exit animations) are parked and never fire, so no test waits on them and no
 * bubble disappears mid-assertion.
 */
const SHORT_TIMER_MS = 50
function parkingTimers() {
  let seq = 0
  const real = new Map()
  return {
    setTimeout: (fn, ms, ...args) => {
      seq += 1
      if ((ms ?? 0) <= SHORT_TIMER_MS) real.set(seq, setTimeout(fn, ms, ...args))
      return seq
    },
    clearTimeout: (id) => { if (real.has(id)) { clearTimeout(real.get(id)); real.delete(id) } },
  }
}

async function loadClient() {
  let captured = null
  const timers = parkingTimers()
  globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }
  await import('../lib/client.js?cachebust=' + String(Date.now()) + Math.random())
  assert.ok(captured !== null, 'bundle must call window.__ModuleLoader__.load')
  return captured.factory((id) => {
    if (id === 'react') return React
    if (id === 'react-dom') return require('react-dom')
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (id === 'react-dom/client') return require('react-dom/client')
    throw new Error('unexpected external: ' + id)
  })
}

/**
 * Boot the bundle against a fake host.
 *  ui:     'full' (registerPendingInteraction) | 'bare' (uiSession without it) | 'none'
 *  inject: 'sync' (ctx.inject runs at once) | 'deferred' (env.provide() runs it) | 'get' (no ctx.inject)
 */
async function boot({ ui = 'full', inject = 'sync' } = {}) {
  const module = await loadClient()
  const env = { module, registered: [], seats: [], injected: [], precedences: [], publishes: [], uiReads: 0, locales: {}, provide: () => {} }
  const uiSession = ui === 'none' ? undefined : {}
  if (ui === 'full') {
    uiSession.registerPendingInteraction = (precedence) => {
      env.precedences.push(precedence)
      return (interaction, delegate) => {
        const record = { interaction, delegate, unpublished: 0 }
        env.publishes.push(record)
        return () => { record.unpublished += 1 }
      }
    }
  }
  const ctx = {
    slots: {
      inject(seat, fn) {
        env.seats.push(seat)
        const it = fn()
        if (it !== undefined && it !== null && typeof it.next === 'function') it.next()
        return () => {}
      },
      register(options, component) { env.registered.push({ options, component }); return () => {} },
    },
    locale: {
      register(ns, dict) { env.locales[ns] = dict; return () => {} },
      bind() { return t },
    },
    effect(fn) { return fn() },
    get(name) {
      if (name !== 'uiSession') return undefined
      env.uiReads += 1
      return inject === 'get' ? uiSession : undefined
    },
  }
  if (inject !== 'get') {
    ctx.inject = (names, callback) => {
      env.injected.push([...names])
      // Only the ui session is ever provided by this fake host (configForms never is).
      if (!names.includes('uiSession') || uiSession === undefined) return () => {}
      const inner = { ...ctx, get: (name) => (name === 'uiSession' ? uiSession : undefined) }
      const run = () => TestRenderer.act(async () => { callback(inner) })
      if (inject === 'sync') callback(inner)
      else env.provide = run
      return () => {}
    }
  }
  await TestRenderer.act(async () => { module.apply(ctx) })
  env.button = env.registered.find((r) => r.options.id === 'dsh-smart-prompt-button')
  env.bar = env.registered.find((r) => r.options.id === 'dsh-smart-prompt-bar')
  env.followUp = () => env.registered.filter((r) => r.options.id === FOLLOW_UP_ID)
  assert.ok(env.button !== undefined && env.bar !== undefined, 'the composer button and the status bar are registered')
  return env
}

const response = (body) => ({ ok: true, status: 200, json: async () => body })
const reply = (body) => () => response(body)
const askReply = reply({ ok: true, ask: { runId: RUN, questions: QUESTIONS } })
const doneReply = (text, meta = META) => reply({ ok: true, text, meta })
const ideasReply = (ideas) => reply({ ok: true, ideas })

/**
 * Global fetch stub routed by endpoint (`improve`, `stardea`, `answer`, `cancel`). A route entry
 * is a reply function, an Error (rejects), or 'hold' (resolved later with `entry.resolve(body)`).
 * An aborted signal rejects with an AbortError, like the real fetch. /cancel answers { ok: true }
 * unless scripted.
 */
function stubFetch(routes = {}) {
  const sent = []
  const original = globalThis.fetch
  globalThis.fetch = (url, init = {}) => {
    const path = String(url)
    const entry = {
      url: path,
      endpoint: path.startsWith(API + '/') ? path.slice(API.length + 1).replace(/\/$/, '') : path,
      method: init.method,
      headers: init.headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      signal: init.signal,
      resolve: null,
    }
    sent.push(entry)
    const queue = routes[entry.endpoint] ?? []
    const next = queue.length > 0 ? queue.shift() : entry.endpoint === 'cancel' ? reply({ ok: true }) : undefined
    return new Promise((resolve, reject) => {
      if (next === undefined) { reject(new Error('unexpected request: ' + path)); return }
      if (next instanceof Error) { reject(next); return }
      const abort = () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
      if (init.signal?.aborted === true) { abort(); return }
      init.signal?.addEventListener?.('abort', abort, { once: true })
      if (next === 'hold') { entry.resolve = (body) => resolve(response(body)); return }
      resolve(next())
    })
  }
  return { sent, to: (endpoint) => sent.filter((s) => s.endpoint === endpoint), restore: () => { globalThis.fetch = original } }
}

const act = (fn) => TestRenderer.act(async () => { await fn() })
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)) })
const clickEvent = () => ({ preventDefault() {}, stopPropagation() {} })
const hasClass = (node, cls) => typeof node.props.className === 'string' && node.props.className.split(/\s+/).includes(cls)
const byClass = (root, cls) => root.findAll((n) => typeof n.type === 'string' && hasClass(n, cls))
const textOf = (node) => (typeof node === 'string' ? node : node.children.map(textOf).join(''))

async function create(Component, props) {
  let renderer = null
  await act(() => { renderer = TestRenderer.create(React.createElement(Component, props)) })
  return renderer
}

/** The composer button (with its slot inject() props) over a live draft, plus the status bar. */
async function mountComposer(env, sessionId = 's1') {
  const live = { draft: ORIGINAL, written: [] }
  const actions = { setDraft: (text) => { live.draft = text; live.written.push(text) } }
  const base = env.button.options.inject(sessionId)
  const props = () => ({ ...base, sessionId, useInput: (sel) => sel({ draft: live.draft, attachmentIds: [], phase: 'plain' }), inputActions: actions, t })
  live.button = await create(env.button.component, props())
  live.bar = await create(env.bar.component, { sessionId, t })
  live.rerender = () => act(() => { live.button.update(React.createElement(env.button.component, props())) })
  live.star = () => byClass(live.button.root, 'dip-btn')[0]
  live.click = async () => { await act(() => { live.star().props.onClick(clickEvent()) }); await flush() }
  live.busy = () => live.button.root.findAll((n) => typeof n.type === 'string' && n.props['data-busy'] === 'true').length > 0
  live.bubbles = () => byClass(live.bar.root, 'dip-bar').filter((b) => b.props['data-state'] !== 'leaving')
  live.barText = () => textOf(live.bar.root)
  return live
}

/** Click the star, expect the questions to be published, and render the composer-chain panel. */
async function openPanel(env, live) {
  await live.click()
  assert.equal(env.publishes.length, 1, 'one interaction is published for the open questions')
  const record = env.publishes[0]
  const [entry] = env.followUp()
  const renderer = await create(entry.component, { matched: record.interaction, sessionId: 's1', t })
  const p = { record, renderer }
  p.root = () => byClass(renderer.root, 'dip-ask')
  p.questions = () => byClass(renderer.root, 'dip-ask-q')
  p.stardea = (i) => byClass(p.questions()[i], 'dip-stardea')[0]
  // Assumption: class dip-idea sits on the <label> (or a wrapper) that holds the checkbox.
  p.ideas = (i) => byClass(p.questions()[i], 'dip-idea')
  p.ideaTexts = (i) => p.ideas(i).map(textOf)
  p.checkbox = (i, j) => p.ideas(i)[j].findAll((n) => n.type === 'input' && n.props.type === 'checkbox')[0]
  p.words = (i) => p.questions()[i].findAll((n) => n.type === 'textarea')[0]
  p.errors = (i) => byClass(p.questions()[i], 'dip-ask-error')
  p.button = (label) => renderer.root.findAll((n) => n.type === 'button' && textOf(n).includes(label))[0]
  p.close = () => renderer.root.findAll((n) => typeof n.type === 'string' && n.props['aria-label'] === 'askCancel')[0]
  p.press = async (node) => { await act(() => { node.props.onClick(clickEvent()) }); await flush() }
  // Assumption: the checkboxes are controlled (`checked` prop) and toggled through onChange.
  p.toggle = async (i, j) => {
    const box = p.checkbox(i, j)
    const checked = box.props.checked !== true
    const event = { target: { checked }, currentTarget: { checked }, preventDefault() {}, stopPropagation() {} }
    await act(() => { (box.props.onChange ?? box.props.onClick)(event) })
  }
  p.type = async (i, value) => {
    const event = { target: { value }, currentTarget: { value } }
    const area = p.words(i)
    await act(() => { (area.props.onChange ?? area.props.onInput)(event) })
  }
  return p
}

function assertJsonPost(entry, endpoint) {
  assert.equal(entry.url, API + '/' + endpoint)
  assert.equal(entry.method, 'POST', endpoint)
  const headers = Object.fromEntries(Object.entries(entry.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]))
  assert.match(headers['content-type'] ?? '', /application\/json/, endpoint + ' content-type')
}

/** A question left without ideas and words is either left out or sent empty (contract: both mean skipped). */
function assertSkippedOrAbsent(answers, id) {
  const entry = answers.find((a) => a.id === id)
  if (entry === undefined) return
  assert.deepEqual(entry.selected ?? [], [], id + ' has no selected ideas')
  assert.equal((entry.custom ?? '').trim(), '', id + ' has no own words')
}

// ================================================================ registration (decision table)

test('SC-01 [EP registration] inject stays slots+locale; the uiSession mount registers one pending interaction and one composer-chain entry', T, async () => {
  const env = await boot()
  assert.deepEqual(env.module.inject, ['slots', 'locale'], 'uiSession is not a hard dependency')
  assert.ok(env.injected.some((names) => names.length === 1 && names[0] === 'uiSession'), JSON.stringify(env.injected))
  assert.equal(env.precedences.length, 1, 'registerPendingInteraction is called once')
  const composer = env.registered.filter((r) => r.options.name === COMPOSER_SEAT)
  assert.equal(composer.length, 1)
  assert.equal(composer[0].options.id, FOLLOW_UP_ID)
  assert.equal(composer[0].options.locale, NS)
  assert.equal(typeof composer[0].options.select, 'function')
  assert.equal(typeof composer[0].component, 'function')
  assert.ok(env.seats.includes(COMPOSER_SEAT), 'registered through ctx.slots.inject("conversation.composer", ...)')
  assert.equal(env.publishes.length, 0, 'nothing is published before questions are open')
})

test('SC-02 [Decision host capabilities] the follow-up entry and the interactive flag depend on ctx.inject x uiSession x registerPendingInteraction', T, async () => {
  const rows = [
    { name: 'ctx.inject + uiSession with registerPendingInteraction', ui: 'full', inject: 'sync', entry: 1, interactive: true },
    { name: 'no ctx.inject, ctx.get(uiSession) with registerPendingInteraction', ui: 'full', inject: 'get', entry: 1, interactive: true },
    { name: 'ctx.inject, uiSession never provided', ui: 'none', inject: 'sync', entry: 0, interactive: false },
    { name: 'no ctx.inject and no uiSession (older host)', ui: 'none', inject: 'get', entry: 0, interactive: false },
    // Assumption: without registerPendingInteraction no panel can be shown, so no questions are requested.
    { name: 'uiSession without registerPendingInteraction', ui: 'bare', inject: 'sync', entry: 0, interactive: false },
  ]
  for (const row of rows) {
    const env = await boot({ ui: row.ui, inject: row.inject })
    const net = stubFetch({ improve: [doneReply(REWRITTEN)] })
    try {
      assert.equal(env.followUp().length, row.entry, row.name + ': follow-up entries')
      const live = await mountComposer(env)
      await live.click()
      assert.equal(net.to('improve').length, 1, row.name)
      const body = net.to('improve')[0].body
      if (row.interactive) assert.equal(body.interactive, true, row.name)
      else assert.equal('interactive' in body, false, row.name + ': no interactive key')
      assert.deepEqual(live.written, [REWRITTEN], row.name + ': the refine still works')
      if (row.inject === 'get') assert.equal(env.uiReads, 1, row.name + ': ctx.get("uiSession") is read once')
    } finally { net.restore() }
  }
})

test('SC-03 [State deferred mount] before the uiSession mount runs, refines send no interactive flag; afterwards they do', T, async () => {
  const env = await boot({ inject: 'deferred' })
  const net = stubFetch({ improve: [doneReply(REWRITTEN), doneReply(REWRITTEN)] })
  try {
    assert.equal(env.followUp().length, 0, 'no entry before the mount')
    const live = await mountComposer(env)
    await live.click()
    assert.equal('interactive' in net.to('improve')[0].body, false, 'the button never waits for uiSession')
    assert.deepEqual(live.written, [REWRITTEN])

    await env.provide()
    assert.equal(env.followUp().length, 1, 'registered once the service is provided')
    assert.equal(env.precedences.length, 1)
    live.draft = ORIGINAL
    await live.rerender()
    await live.click()
    assert.equal(net.to('improve').length, 2)
    assert.equal(net.to('improve')[1].body.interactive, true)
  } finally { net.restore() }
})

// ================================================================ asking

test('SC-04 [EP ask] an interactive refine that gets questions publishes one interaction and leaves the draft untouched', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply] })
  try {
    const live = await mountComposer(env)
    await live.click()
    const sent = net.to('improve')[0]
    assertJsonPost(sent, 'improve')
    assert.deepEqual(sent.body, { sessionId: 's1', text: ORIGINAL, interactive: true })
    assert.equal(env.publishes.length, 1)
    const { interaction } = env.publishes[0]
    assert.equal(interaction.kind, FOLLOW_UP_KIND)
    assert.equal(interaction.key, RUN)
    assert.equal(interaction.sessionId, 's1')
    assert.equal(env.publishes[0].unpublished, 0, 'still open')
    assert.deepEqual(live.written, [], 'the draft is untouched while asking')
    assert.equal(live.draft, ORIGINAL)
  } finally { net.restore() }
})

test('SC-05 [EP select] select() matches only this plugin\'s interaction', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply] })
  try {
    const live = await mountComposer(env)
    await live.click()
    const { select } = env.followUp()[0].options
    const ours = select({ pendingInteraction: env.publishes[0].interaction })
    assert.ok(ours !== null && ours !== undefined, 'ours is matched')
    assert.equal(ours.kind, FOLLOW_UP_KIND)
    assert.equal(ours.key, RUN)
    for (const other of [{ kind: 'user-questions', key: RUN, sessionId: 's1' }, { kind: 'approval', key: 'x', sessionId: 's1' }, undefined, null]) {
      assert.equal(select({ pendingInteraction: other }) ?? null, null, JSON.stringify(other))
    }
  } finally { net.restore() }
})

test('SC-06 [EP plain success] an interactive refine without questions publishes nothing and writes the rewrite', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [doneReply(REWRITTEN)] })
  try {
    const live = await mountComposer(env)
    await live.click()
    assert.equal(env.publishes.length, 0)
    assert.deepEqual(live.written, [REWRITTEN])
  } finally { net.restore() }
})

test('SC-07 [EP layout] the panel shows its title, the original draft read-only, each question with a Stardea button and an own-words box, Skip, Submit and close', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply] })
  try {
    const live = await mountComposer(env)
    const p = await openPanel(env, live)
    assert.equal(p.root().length, 1, 'root element .dip-ask')
    const all = textOf(p.renderer.root)
    assert.ok(all.includes('askTitle'), 'title')
    assert.ok(all.includes('askOriginal'), 'original-draft label')
    const original = byClass(p.renderer.root, 'dip-ask-original')
    assert.equal(original.length, 1)
    const shown = original[0].type === 'textarea' || original[0].type === 'input' ? String(original[0].props.value ?? original[0].props.defaultValue) : textOf(original[0])
    assert.ok(shown.includes(ORIGINAL), 'the original draft stays visible: ' + shown)
    if (original[0].type === 'textarea' || original[0].type === 'input') assert.equal(original[0].props.readOnly, true, 'read-only')

    const questions = p.questions()
    assert.equal(questions.length, 2)
    assert.ok(textOf(questions[0]).includes(Q1))
    assert.ok(textOf(questions[1]).includes(Q2))
    for (const i of [0, 1]) {
      const star = byClass(questions[i], 'dip-stardea')
      assert.equal(star.length, 1, 'one Stardea button per question')
      assert.equal(star[0].props['aria-label'], 'stardeaAria')
      assert.ok(textOf(star[0]).includes('stardea'), 'visible label')
      assert.notEqual(star[0].props['data-busy'], 'true')
      assert.notEqual(star[0].props.disabled, true)
      assert.equal(p.ideas(i).length, 0, 'no ideas before a click')
      assert.equal(p.words(i)?.props.placeholder, 'askOwnWords')
    }
    assert.ok(p.button('askSkip') !== undefined, 'Skip')
    assert.ok(p.button('askSubmit') !== undefined, 'Submit')
    assert.ok(p.close() !== undefined, 'close button labelled askCancel')
    assert.equal(net.sent.length, 1, 'opening the panel sends nothing else')
  } finally { net.restore() }
})

// ================================================================ Stardea clicks

test('SC-08 [State pending -> ideas] a Stardea click posts runId + questionId, is busy while pending, then lists the ideas as checkboxes', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply], stardea: ['hold'] })
  try {
    const live = await mountComposer(env)
    const p = await openPanel(env, live)
    await p.press(p.stardea(0))
    const request = net.to('stardea')[0]
    assertJsonPost(request, 'stardea')
    assert.deepEqual(request.body, { runId: RUN, questionId: 'q1' })
    assert.equal(p.stardea(0).props['data-busy'], 'true', 'busy while pending')
    assert.equal(p.stardea(0).props.disabled, true, 'disabled while pending')
    assert.notEqual(p.stardea(1).props['data-busy'], 'true', 'only that question is busy')

    await act(() => { request.resolve({ ok: true, ideas: IDEAS_A }) })
    await flush()
    assert.notEqual(p.stardea(0).props['data-busy'], 'true')
    assert.notEqual(p.stardea(0).props.disabled, true)
    assert.equal(p.ideas(0).length, 4)
    p.ideaTexts(0).forEach((text, j) => assert.ok(text.includes(IDEAS_A[j].text), text))
    for (let j = 0; j < 4; j += 1) {
      const box = p.checkbox(0, j)
      assert.ok(box !== undefined, 'idea ' + String(j) + ' has a checkbox')
      assert.notEqual(box.props.checked, true, 'not selected yet')
    }
    assert.equal(p.ideas(1).length, 0, 'the other question has no ideas')
  } finally { net.restore() }
})

test('SC-09 [BVA ideas per click 4 / 2 / 0] later clicks append new ideas after the existing ones; an empty click changes nothing', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply], stardea: [ideasReply(IDEAS_A), ideasReply(IDEAS_B), ideasReply([]), ideasReply(IDEAS_Q2)] })
  try {
    const live = await mountComposer(env)
    const p = await openPanel(env, live)
    await p.press(p.stardea(0))
    assert.equal(p.ideas(0).length, 4)
    await p.press(p.stardea(0))
    const expected = [...IDEAS_A, ...IDEAS_B].map((i) => i.text)
    assert.equal(p.ideas(0).length, 6, 'appended, not replaced')
    p.ideaTexts(0).forEach((text, j) => assert.ok(text.includes(expected[j]), 'position ' + String(j) + ': ' + text))
    await p.press(p.stardea(0))
    assert.equal(p.ideas(0).length, 6, 'zero new ideas append nothing')
    await p.press(p.stardea(1))
    assert.deepEqual(net.to('stardea').map((s) => s.body), [
      { runId: RUN, questionId: 'q1' }, { runId: RUN, questionId: 'q1' }, { runId: RUN, questionId: 'q1' }, { runId: RUN, questionId: 'q2' },
    ])
    assert.equal(p.ideas(1).length, 1, 'q2 ideas go under q2')
    assert.ok(p.ideaTexts(1)[0].includes(IDEAS_Q2[0].text))
    assert.equal(p.ideas(0).length, 6, 'q1 is unchanged')
  } finally { net.restore() }
})

test('SC-10 [EP failure] a failed or rejected Stardea request shows an inline error under that question and keeps its ideas', T, async () => {
  const env = await boot()
  const net = stubFetch({
    improve: [askReply],
    stardea: [ideasReply(IDEAS_A), reply({ ok: false, code: 'UPSTREAM', message: 'gateway exploded' }), new TypeError('network down')],
  })
  try {
    const live = await mountComposer(env)
    const p = await openPanel(env, live)
    await p.press(p.stardea(0))
    assert.equal(p.errors(0).length, 0)
    await p.press(p.stardea(0))
    assert.ok(p.errors(0).length >= 1, 'ok:false -> inline .dip-ask-error')
    assert.equal(p.ideas(0).length, 4, 'existing ideas are kept')
    assert.notEqual(p.stardea(0).props['data-busy'], 'true', 'no longer busy')
    assert.equal(p.errors(1).length, 0, 'the other question shows no error')

    await p.press(p.stardea(1))
    assert.ok(p.errors(1).length >= 1, 'a rejected fetch -> inline error too')
    assert.equal(p.ideas(0).length, 4)
    assert.equal(env.publishes[0].unpublished, 0, 'the panel stays open')
    assert.deepEqual(live.written, [])
  } finally { net.restore() }
})

// ================================================================ answering

test('SC-11 [Decision submit] selected idea texts + own words per question go to /answer; the panel goes away; the star is busy; then the draft is replaced and tokens shown', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply], stardea: [ideasReply(IDEAS_A)], answer: ['hold'] })
  try {
    const live = await mountComposer(env)
    const p = await openPanel(env, live)
    await p.press(p.stardea(0))
    await p.toggle(0, 0)
    await p.toggle(0, 2)
    assert.equal(p.checkbox(0, 0).props.checked, true, 'checked after a click')
    await p.type(0, OWN_1)
    await p.type(1, OWN_2)
    await p.press(p.button('askSubmit'))

    const request = net.to('answer')[0]
    assert.ok(request !== undefined, '/answer is posted')
    assertJsonPost(request, 'answer')
    assert.equal(request.body.runId, RUN)
    const answers = request.body.answers
    // Order assumption: selected ideas are listed in display order (they were clicked in that order too).
    assert.deepEqual(answers.find((a) => a.id === 'q1'), { id: 'q1', selected: [IDEAS_A[0].text, IDEAS_A[2].text], custom: OWN_1 })
    const q2 = answers.find((a) => a.id === 'q2')
    assert.deepEqual([q2?.selected ?? [], q2?.custom], [[], OWN_2], 'own words alone answer q2')
    assert.ok(env.publishes[0].unpublished >= 1, 'unpublished on submit')
    await live.rerender()
    assert.equal(live.busy(), true, 'the composer star shows busy until the final result')
    assert.deepEqual(live.written, [])

    await act(() => { request.resolve({ ok: true, text: REWRITTEN, meta: { ...META, questions: { asked: 2, answered: 2 }, usage: USAGE } }) })
    await flush()
    assert.deepEqual(live.written, [REWRITTEN], 'the draft is replaced exactly as before')
    assert.equal(live.bubbles()[0]?.props['data-kind'], 'done')
    // Assumption: the figures are rendered by code after the `tokens` label (the harness
    // translator echoes keys, so a template-interpolated locale string would hide them).
    const text = live.barText()
    assert.ok(text.includes('1200(3400) - 560'), text)
    assert.ok(text.indexOf('tokens') !== -1 && text.indexOf('tokens') < text.indexOf('1200(3400) - 560'), 'labelled with the tokens key: ' + text)
    assert.equal(net.to('cancel').length, 0)
  } finally { net.restore() }
})

test('SC-12 [BVA toggle twice] an idea checked and unchecked again is not sent; a question with nothing is skipped', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply], stardea: [ideasReply(IDEAS_A)], answer: [doneReply(REWRITTEN)] })
  try {
    const live = await mountComposer(env)
    const p = await openPanel(env, live)
    await p.press(p.stardea(0))
    await p.toggle(0, 1)
    await p.toggle(0, 3)
    await p.toggle(0, 1)
    assert.notEqual(p.checkbox(0, 1).props.checked, true, 'unchecked again')
    await p.press(p.button('askSubmit'))
    const answers = net.to('answer')[0].body.answers
    const q1 = answers.find((a) => a.id === 'q1')
    assert.deepEqual(q1?.selected, [IDEAS_A[3].text])
    assert.equal((q1?.custom ?? '').trim(), '', 'no own words')
    assertSkippedOrAbsent(answers, 'q2')
    assert.deepEqual(live.written, [REWRITTEN])
  } finally { net.restore() }
})

test('SC-13 [EP skip] Skip posts answers: [] and the result replaces the draft', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply], stardea: [ideasReply(IDEAS_A)], answer: [doneReply(FIRST_REWRITE)] })
  try {
    const live = await mountComposer(env)
    const p = await openPanel(env, live)
    await p.press(p.stardea(0))
    await p.toggle(0, 0) // a selection made before Skip is not sent
    await p.press(p.button('askSkip'))
    assert.equal(net.to('answer').length, 1)
    assert.deepEqual(net.to('answer')[0].body, { runId: RUN, answers: [] })
    assert.ok(env.publishes[0].unpublished >= 1, 'unpublished on skip')
    assert.deepEqual(live.written, [FIRST_REWRITE])
    assert.equal(net.to('cancel').length, 0)
  } finally { net.restore() }
})

test('SC-14 [EP close] the close button posts /cancel, unpublishes, shows the failure bubble and leaves the draft untouched', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply] })
  try {
    const live = await mountComposer(env)
    const p = await openPanel(env, live)
    await p.press(p.close())
    assert.equal(net.to('cancel').length, 1)
    assertJsonPost(net.to('cancel')[0], 'cancel')
    assert.deepEqual(net.to('cancel')[0].body, { runId: RUN })
    assert.equal(net.to('answer').length, 0, 'nothing is answered')
    assert.ok(env.publishes[0].unpublished >= 1, 'unpublished on close')
    assert.deepEqual(live.written, [], 'draft untouched')
    assert.equal(live.draft, ORIGINAL)
    assert.equal(live.bubbles()[0]?.props['data-kind'], 'error', 'the failure bubble shows the cancelled message')
  } finally { net.restore() }
})

test('SC-15 [State busy -> cancelled] clicking the busy star while /answer is pending aborts that fetch; the draft is untouched', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply], answer: ['hold'] })
  try {
    const live = await mountComposer(env)
    const p = await openPanel(env, live)
    await p.type(0, OWN_1)
    await p.press(p.button('askSubmit'))
    const request = net.to('answer')[0]
    assert.ok(request.signal !== undefined && request.signal !== null, '/answer carries an AbortSignal')
    assert.equal(request.signal.aborted, false)
    await live.rerender()
    assert.equal(live.busy(), true)
    await live.click()
    assert.equal(request.signal.aborted, true, 'the /answer fetch is aborted')
    await live.rerender()
    assert.deepEqual(live.written, [])
    assert.equal(live.draft, ORIGINAL)
  } finally { net.restore() }
})

test('SC-16 [EP answer failure] a failed /answer shows the error bubble, keeps the draft and the panel stays closed', T, async () => {
  const env = await boot()
  const net = stubFetch({ improve: [askReply], answer: [reply({ ok: false, code: 'UPSTREAM', message: 'gateway exploded' })] })
  try {
    const live = await mountComposer(env)
    const p = await openPanel(env, live)
    await p.type(0, OWN_1)
    await p.press(p.button('askSubmit'))
    assert.deepEqual(live.written, [])
    assert.equal(live.bubbles()[0]?.props['data-kind'], 'error')
    assert.ok(env.publishes[0].unpublished >= 1)
    assert.equal(env.publishes.length, 1, 'not published again')
    await live.rerender()
    assert.equal(live.busy(), false, 'the star is idle again')
  } finally { net.restore() }
})

// ================================================================ token report (requirement 7)

test('SC-17 [BVA tokens] the success bubble shows "<tokens> input(cached) - output" when meta.usage is present, also all zero; nothing when absent', T, async () => {
  const rows = [
    [USAGE, 'tokens', '1200(3400) - 560'],
    [{ input: 0, cached: 0, output: 0 }, 'tokens', '0(0) - 0'],
    [{ input: 1, cached: 0, output: 1 }, 'tokens', '1(0) - 1'],
    [undefined, null, null],
  ]
  for (const [usage, label, figure] of rows) {
    const env = await boot()
    const meta = usage === undefined ? META : { ...META, usage }
    const net = stubFetch({ improve: [doneReply(REWRITTEN, meta)] })
    try {
      const live = await mountComposer(env)
      await live.click()
      assert.equal(live.bubbles()[0]?.props['data-kind'], 'done', JSON.stringify(usage))
      const text = live.barText()
      if (figure === null) {
        assert.equal(text.includes('tokens'), false, 'no token report without usage: ' + text)
        assert.doesNotMatch(text, /\d+\(\d+\) - \d+/)
      } else {
        assert.ok(text.includes(figure), JSON.stringify(usage) + ': ' + text)
        assert.ok(text.indexOf(label) < text.indexOf(figure), 'label before the figures: ' + text)
      }
    } finally { net.restore() }
  }
})

// ================================================================ locale

test('SC-18 [EP en/zh] both locales carry the panel, Stardea and token copy', T, async () => {
  const env = await boot()
  const dict = env.locales[NS]
  assert.ok(dict !== undefined, 'the plugin registers its namespace')
  for (const lang of ['en', 'zh']) {
    for (const key of NEW_LOCALE_KEYS) {
      assert.ok(typeof dict[lang]?.[key] === 'string' && dict[lang][key].length > 0, lang + '.' + key)
    }
  }
})
