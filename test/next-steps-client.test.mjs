// Next-step suggestions (client half): the star's two faces and the popover flow, against the
// BUILT bundle (lib/client.js), as the harness loads it.
//
// Requirements under test (user decisions):
//  - Empty composer: the star becomes the Stardea face (mode glyph as the corner badge); typing
//    returns it to the refine face. Disabled until the agent has replied, and while it replies.
//  - Click (popover closed): open; fetch only when nothing was made ("get" — the host returns the
//    made ones without a model call). Click with the popover open: "more", appended as a new row.
//  - Cards, two per row, spanning the composer; placeholder cards while a row is on the way.
//  - Picking puts the sentence in the composer, marks its card and keeps the popover open; typing closes it.
//  - Closing keeps the suggestions: the next click shows them again.
//  - Auto-suggest default on: suggestions are fetched and shown on their own for an empty composer,
//    unless the user closed them for that point.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer from 'react-test-renderer'

const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { act } = TestRenderer

async function loadClient() {
  let captured = null
  globalThis.window = {
    __ModuleLoader__: { load: (m) => { captured = m } },
    localStorage: { getItem: () => '1', setItem() {} },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  }
  await import('../lib/client.js?next-steps=' + String(Date.now()) + Math.random())
  return captured.factory((id) => {
    if (id === 'react') return React
    if (id === 'react-dom') return require('react-dom')
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    throw new Error('unexpected external: ' + id)
  })
}

/** A ConfigForm of the plugin entry holding `value`. */
function fakeForm(value) {
  const listeners = new Set()
  const snap = { status: 'ready', value, writable: true }
  return { getSnapshot: () => snap, subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) }, set: async () => true }
}

/** Boot the bundle; `form` serves configForms (the auto-suggest default lives there). */
async function boot(form) {
  const module = await loadClient()
  const registered = []
  const configForms = form !== undefined ? { get: () => form, whileServed: () => () => {} } : undefined
  const ctx = {
    slots: {
      inject(_seat, fn) { const it = fn(); if (it !== undefined && typeof it.next === 'function') it.next(); return () => {} },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
    locale: { register() { return () => {} }, bind() { return (k) => k } },
    effect(fn) { return fn() },
    get: (name) => (name === 'configForms' ? configForms : undefined),
    inject(names, apply) { if (names.includes('configForms') && configForms !== undefined) apply(ctx) },
  }
  await act(async () => { module.apply(ctx) })
  const byId = (id) => registered.find((r) => r.options.id === id).component
  return { button: byId('dsh-smart-prompt-button'), popover: byId('dsh-smart-prompt-suggest') }
}

/** A composer whose draft and agent activity the test changes. */
function composer(sessionId, session = { running: false, blank: false }) {
  const state = { draft: '', session, writes: [] }
  const props = () => ({
    sessionId,
    useInput: (selector) => selector({ draft: state.draft, phase: 'plain' }),
    useSession: (selector) => selector(state.session),
    inputActions: { setDraft: (text) => { state.writes.push(text); state.draft = text } },
    t: (k) => k,
  })
  return { state, props }
}

/** Scripted /suggest host; every request body is recorded. */
function stubFetch(replies) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    // A reply may be a promise, so a test can hold the request open.
    const next = await (replies.shift() ?? { ok: false, code: 'UPSTREAM' })
    return { json: async () => next }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const A = ['Add tests for the limiter', 'Log blocked requests']
const B = ['Load-test the endpoint', 'Make the limit configurable']

async function mountBoth(env, c) {
  let button, popover
  await act(async () => {
    button = TestRenderer.create(React.createElement(env.button, c.props()))
    popover = TestRenderer.create(React.createElement(env.popover, { sessionId: c.props().sessionId, useInput: c.props().useInput, t: (k) => k }))
  })
  const rerender = () => act(async () => {
    button.update(React.createElement(env.button, c.props()))
    popover.update(React.createElement(env.popover, { sessionId: c.props().sessionId, useInput: c.props().useInput, t: (k) => k }))
  })
  const root = () => button.root.findAllByProps({ className: 'dip-root' })[0]
  const star = () => button.root.findAllByProps({ className: 'dip-btn' })[0]
  const click = () => act(async () => { star().props.onClick({ detail: 0 }) })
  const items = () => popover.root.findAll((n) => n.type === 'button' && n.props.className === 'dip-suggest-item')
  const placeholders = () => popover.root.findAll((n) => n.props['data-loading'] === 'true')
  const open = () => popover.root.findAllByProps({ className: 'dip-suggest' }).length === 1
  return { button, popover, rerender, root, star, click, items, placeholders, open }
}

test('NC-1 empty composer: Stardea face with the mode badge; typing returns to the refine face', async () => {
  const env = await boot()
  const c = composer('nc1')
  const ui = await mountBoth(env, c)
  assert.equal(ui.root().props['data-face'], 'suggest')
  assert.equal(ui.star().props['aria-label'], 'suggestAria')
  assert.equal(ui.star().props.disabled, false)
  assert.equal(ui.button.root.findAllByProps({ className: 'dip-icon' }).length, 1, 'the mode glyph stays, as the badge')
  c.state.draft = 'Add rate limiting'
  await ui.rerender()
  assert.equal(ui.root().props['data-face'], 'refine')
  assert.equal(ui.star().props['aria-label'], 'buttonAria')
})

test('NC-2 disabled before the first reply and while the agent replies', async () => {
  const env = await boot()
  const blank = await mountBoth(env, composer('nc2a', { running: false, blank: true }))
  assert.equal(blank.star().props.disabled, true)
  assert.equal(blank.star().props.title, 'suggestWaitTitle')
  const running = await mountBoth(env, composer('nc2b', { running: true, blank: false }))
  assert.equal(running.star().props.disabled, true)
})

test('NC-3 click opens and fetches; pick writes the sentence and keeps it open; click again appends a row', async () => {
  const env = await boot()
  let release
  const held = new Promise((resolve) => { release = () => resolve({ ok: true, key: 'k1', suggestions: A }) })
  const host = stubFetch([held, { ok: true, key: 'k1', suggestions: [...A, ...B] }])
  try {
    const c = composer('nc3')
    const ui = await mountBoth(env, c)
    await ui.click()
    assert.equal(ui.placeholders().length, 2, 'two placeholder cards while the first row is on the way')
    release()
    await flush()
    assert.equal(ui.placeholders().length, 0)
    assert.deepEqual(host.calls.map((x) => [x.url, x.body]), [['/dsh-smart-prompt/api/suggest', { sessionId: 'nc3', request: 'get' }]])
    assert.ok(ui.open())
    assert.deepEqual(ui.items().map((i) => i.children[0]), A)

    await act(async () => { ui.items()[1].props.onClick() })
    await ui.rerender()
    assert.deepEqual(c.state.writes, [A[1]])
    assert.ok(ui.open(), 'the popover stays open after a pick (user decision)')
    assert.deepEqual(ui.items().map((i) => i.props['aria-pressed']), [false, true], 'the picked card is marked')
    assert.equal(ui.root().props['data-face'], 'refine', 'the composer now holds text')

    // Clear the composer again and click with the popover open: three more.
    c.state.draft = ''
    await ui.rerender()
    await ui.click()
    await flush()
    assert.equal(host.calls[1].body.request, 'more')
    assert.deepEqual(ui.items().map((i) => i.children[0]), [...A, ...B], 'the new row lands below the first')
  } finally { host.restore() }
})

test('NC-4 closing keeps the suggestions; the next click shows them again; typing closes the popover', async () => {
  const env = await boot()
  const host = stubFetch([{ ok: true, key: 'k1', suggestions: A }, { ok: true, key: 'k1', suggestions: A }])
  try {
    const c = composer('nc4')
    const ui = await mountBoth(env, c)
    await ui.click()
    await flush()
    const close = ui.popover.root.findAllByProps({ className: 'dip-onboard-close' })[0]
    await act(async () => { close.props.onClick() })
    assert.equal(ui.open(), false)
    await ui.click()
    assert.ok(ui.open())
    assert.deepEqual(ui.items().map((i) => i.children[0]), A, 'shown at once, before the host replies')
    assert.equal(ui.placeholders().length, 0, 'no placeholder row for a reopen')
    await flush()
    assert.equal(host.calls[1].body.request, 'get', 'a reopen never asks for more; the host answers from what it made')

    c.state.draft = 'something else entirely'
    await ui.rerender()
    assert.equal(ui.open(), false, 'typing closes it')
  } finally { host.restore() }
})

test('NC-5 auto-suggest on: shown on their own for an empty composer, not after the user closed them', async () => {
  const env = await boot(fakeForm({ autoSuggest: true }))
  const host = stubFetch([{ ok: true, key: 'k1', suggestions: A }, { ok: true, key: 'k1', suggestions: A }])
  try {
    const c = composer('nc5')
    const ui = await mountBoth(env, c)
    await flush()
    assert.equal(host.calls.length, 1)
    assert.ok(ui.open(), 'opened without a click')
    await act(async () => { ui.popover.root.findAllByProps({ className: 'dip-onboard-close' })[0].props.onClick() })
    // The agent replies again for the same point (no new key): it stays closed.
    c.state.session = { running: true, blank: false }
    await ui.rerender()
    c.state.session = { running: false, blank: false }
    await ui.rerender()
    await flush()
    assert.equal(ui.open(), false)
  } finally { host.restore() }
})

test('NC-6 auto-suggest off (default): nothing is fetched until the click', async () => {
  const env = await boot(fakeForm({}))
  const host = stubFetch([])
  try {
    await mountBoth(env, composer('nc6'))
    await flush()
    assert.equal(host.calls.length, 0)
  } finally { host.restore() }
})

test('NC-7 a failure shows its note and keeps earlier suggestions', async () => {
  const env = await boot()
  const host = stubFetch([{ ok: true, key: 'k1', suggestions: A }, { ok: false, code: 'TIMEOUT', message: 'host copy' }])
  try {
    const c = composer('nc7')
    const ui = await mountBoth(env, c)
    await ui.click()
    await flush()
    await ui.click()
    await flush()
    assert.deepEqual(ui.items().map((i) => i.children[0]), A)
    // The echo translator has no copy for err_TIMEOUT, so refine.ts falls back to the host's message.
    assert.equal(ui.popover.root.findAllByProps({ role: 'alert' })[0].children[0], 'host copy')
  } finally { host.restore() }
})
