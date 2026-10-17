// The success bubble shows once per refine, even across session navigation.
// System level: the BUILT client bundle (lib/client.js) booted through module.apply(ctx),
// components taken from the slot registrations, react-test-renderer, a stubbed global
// fetch and a manual clock behind window.setTimeout.
//
// Techniques:
//  - State transition: idle -> busy -> done(shown) -> {hidden by 8 s timer | navigated away}
//    -> back on A: still not shown; done -> busy -> done (new refine) shows once more.
//  - Decision table: navigation kind (remount, re-render with another sessionId, keyed
//    fresh instance) x return time relative to the 8 s auto-hide.
//  - EP: bubble kind (done suppressed on return / error shown again on return); first
//    observer (bar mounted before vs after the success); session (A vs B).
//  - BVA: return at 7999 ms vs 8000 ms; auto-hide at 7999 vs 8000 ms; error return at 11999 ms.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer from 'react-test-renderer'

const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** Requirement timings (ms). */
const DONE_HIDE_MS = 8000
const ERROR_HIDE_MS = 12000
/** Comfortably longer than the "short" exit animation; its exact length is not specified. */
const EXIT_SETTLE_MS = 1000

const A = 'session-a'
const B = 'session-b'
const ORIGINAL = '把那个接口加上限流'
const REWRITTEN = '为登录接口增加按 IP 的限流，每分钟 60 次。'
const RETRIED = '为 /api/login 增加按 IP 的限流，每分钟 60 次。'
const t = (key) => key

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
        const due = [...timers.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = target
    },
  }
}

/** Boot a fresh copy of the built bundle (fresh module-level store) and return its slot components. */
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
  const ctx = {
    slots: {
      inject(_seat, fn) { const it = fn(); if (it !== undefined && typeof it.next === 'function') it.next(); return () => {} },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
    locale: { register() { return () => {} }, bind() { return (key) => key } },
    effect(fn) { return fn() },
    get() { return undefined },
  }
  await TestRenderer.act(async () => { module.apply(ctx) })
  const button = registered.find((r) => r.options.id === 'dsh-smart-prompt-button').component
  const bar = registered.find((r) => r.options.id === 'dsh-smart-prompt-bar').component
  return { button, bar, clock }
}

/** Install a fetch stub answering from `replies` in order ('hold' parks the reply in `held`). */
function stubFetch(replies) {
  const sent = []
  const held = []
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body))
    const next = replies.shift()
    if (next === undefined) throw new Error('unexpected extra request')
    if (next === 'hold') return new Promise((resolve) => { held.push(resolve) })
    return next()
  }
  return { sent, held, restore: () => { globalThis.fetch = original } }
}

const meta = { mode: 'standard', model: 'p/m', ratio: 1.4, ratioLabel: '1.4x', elapsedMs: 2100, anchors: { total: 0, kept: 0, reinjected: 0 }, note: '', contextUsed: 'none' }
const okReply = (text = REWRITTEN, elapsedMs = 2100) => () => ({ json: async () => ({ ok: true, text, meta: { ...meta, elapsedMs } }) })
const failReply = () => ({ json: async () => ({ ok: false, code: 'UPSTREAM_X', message: 'gateway exploded' }) })

async function act(fn) { await TestRenderer.act(async () => { await fn() }) }
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)) })
const advance = (env, ms) => act(() => { env.clock.advance(ms) })

/**
 * The host as the plugin sees it: per-session drafts that outlive the components, one
 * composer button and one status bar overlay mounted for the active session.
 */
function host(env) {
  const drafts = new Map()
  const draftOf = (sid) => (drafts.has(sid) ? drafts.get(sid) : ORIGINAL)
  const actionsFor = new Map()
  const actions = (sid) => {
    if (!actionsFor.has(sid)) actionsFor.set(sid, { setDraft: (text) => { drafts.set(sid, text) } })
    return actionsFor.get(sid)
  }
  const buttonProps = (sid) => ({ sessionId: sid, useInput: (sel) => sel({ draft: draftOf(sid), phase: 'plain' }), inputActions: actions(sid), t })
  const h = { drafts, draftOf, button: null, bar: null, sid: null, barKey: 0 }

  h.mountButton = async (sid) => { await act(() => { h.button = TestRenderer.create(React.createElement(env.button, buttonProps(sid))) }) }
  h.rerenderButton = async (sid) => { await act(() => { h.button.update(React.createElement(env.button, buttonProps(sid))) }) }
  h.mountBar = async (sid) => { h.sid = sid; await act(() => { h.bar = TestRenderer.create(React.createElement(env.bar, { sessionId: sid, t })) }) }
  h.unmountAll = async () => {
    await act(() => { if (h.bar !== null) h.bar.unmount(); if (h.button !== null) h.button.unmount() })
    h.bar = null
    h.button = null
  }
  /** Open a session: a freshly mounted composer button and status bar. */
  h.open = async (sid) => { await h.mountButton(sid); await h.mountBar(sid) }

  // --- the three ways a host can take the overlay to another session and back
  h.navigate = {
    /** Leaving unmounts the overlay; returning mounts brand-new components. */
    remount: { leave: async () => { await h.unmountAll() }, back: async (sid) => { await h.open(sid) } },
    /** The same instances are re-rendered with another session id, then with A again. */
    rerender: {
      leave: async () => {
        await act(() => {
          h.bar.update(React.createElement(env.bar, { sessionId: B, t }))
          h.button.update(React.createElement(env.button, buttonProps(B)))
        })
      },
      back: async (sid) => {
        await act(() => {
          h.bar.update(React.createElement(env.bar, { sessionId: sid, t }))
          h.button.update(React.createElement(env.button, buttonProps(sid)))
        })
      },
    },
    /** Same root, but a new React key: a fresh StatusBar instance for A replaces the old one. */
    keyed: {
      leave: async () => {
        h.barKey += 1
        await act(() => { h.bar.update(React.createElement(env.bar, { key: 'k' + String(h.barKey), sessionId: B, t })) })
      },
      back: async (sid) => {
        h.barKey += 1
        await act(() => { h.bar.update(React.createElement(env.bar, { key: 'k' + String(h.barKey), sessionId: sid, t })) })
      },
    },
  }

  h.click = async () => { await act(() => h.button.root.findAllByProps({ className: 'dip-btn' })[0].props.onClick()); await flush() }
  h.capsule = (cls) => h.button.root.findAll((n) => n.props.className === cls && typeof n.type === 'string')
  h.bubbles = () => (h.bar === null ? [] : h.bar.root.findAll((n) => n.props.className === 'dip-bar'))
  h.active = (kind) => h.bubbles().filter((b) => b.props['data-kind'] === kind && b.props['data-state'] !== 'leaving')
  h.retryInBubble = () => (h.bar === null ? [] : h.bar.root.findAll((n) => n.props.className === 'dip-bar-retry' && typeof n.type === 'string'))
  return h
}

/** Assert no success bubble is visible now, nor later as time passes (no late re-appearance). */
async function assertNoDoneBubbleStays(env, h, label) {
  assert.equal(h.active('done').length, 0, label + ': no active success bubble')
  await advance(env, EXIT_SETTLE_MS)
  assert.equal(h.bubbles().filter((b) => b.props['data-kind'] === 'done').length, 0, label + ': nothing left sliding out')
  await advance(env, DONE_HIDE_MS * 3)
  assert.equal(h.bubbles().filter((b) => b.props['data-kind'] === 'done').length, 0, label + ': still nothing later')
}

/** Refine in A with the overlay mounted; the success bubble is shown once. */
async function refineInA(env, h) {
  await h.open(A)
  await h.click()
  assert.equal(h.draftOf(A), REWRITTEN)
  assert.equal(h.active('done').length, 1, 'the first mount observing the success shows it')
  assert.equal(h.active('done')[0].props['data-state'], 'entering')
}

// ================================================================ unchanged behaviour

test('SN-01 [BVA 8 s / State done->leaving->gone] the success bubble is shown until 7999 ms, slides out at 8000 ms, then is gone', async () => {
  const env = await bootClient()
  const net = stubFetch([okReply()])
  try {
    const h = host(env)
    await refineInA(env, h)
    await advance(env, DONE_HIDE_MS - 1)
    assert.equal(h.active('done').length, 1, 'still shown at 7999 ms')
    await advance(env, 1)
    const after = h.bubbles()
    assert.equal(after.length, 1, 'kept mounted for its exit animation at 8000 ms')
    assert.equal(after[0].props['data-state'], 'leaving')
    await advance(env, EXIT_SETTLE_MS)
    assert.equal(h.bar.toJSON(), null, 'gone after the exit animation')
    await h.rerenderButton(A)
    assert.equal(h.capsule('dip-revert').length, 1, 'the auto-hide leaves the Revert | Retry capsule in place')
  } finally { net.restore() }
})

test('SN-02 [EP first observer] a success that finished while no overlay was mounted is shown by the first overlay mount, once', async () => {
  const env = await bootClient()
  const net = stubFetch([okReply()])
  try {
    const h = host(env)
    await h.mountButton(A)
    await h.click()
    assert.equal(h.draftOf(A), REWRITTEN)
    await h.mountBar(A)
    assert.equal(h.active('done').length, 1, 'the first mount that observes the success shows it')
    await h.navigate.remount.leave()
    await h.navigate.remount.back(A)
    await assertNoDoneBubbleStays(env, h, 'second mount')
  } finally { net.restore() }
})

// ================================================================ decision table: navigation x return time

/**
 * stayMs: time spent on A after the success before leaving; awayMs: time spent away.
 * Return time = stayMs + awayMs relative to the success.
 */
const RETURN_TIMES = [
  { name: 'returns immediately (0 ms)', stayMs: 0, awayMs: 0 },
  { name: 'returns at 3000 ms, before the auto-hide', stayMs: 1000, awayMs: 2000 },
  { name: 'returns at 7999 ms, just before the auto-hide', stayMs: 0, awayMs: DONE_HIDE_MS - 1 },
  { name: 'leaves at 7999 ms while shown, returns at once', stayMs: DONE_HIDE_MS - 1, awayMs: 0 },
  { name: 'returns at 8000 ms, away during the auto-hide boundary', stayMs: 0, awayMs: DONE_HIDE_MS },
  { name: 'leaves after the auto-hide (8000 ms + exit), returns at once', stayMs: DONE_HIDE_MS + EXIT_SETTLE_MS, awayMs: 0 },
  { name: 'returns much later (60 s)', stayMs: 2000, awayMs: 58000 },
]

for (const kind of ['remount', 'rerender', 'keyed']) {
  for (const when of RETURN_TIMES) {
    test(`SN-DT [${kind}] ${when.name}: the same refine's success bubble is not shown again`, async () => {
      const env = await bootClient()
      const net = stubFetch([okReply()])
      try {
        const h = host(env)
        await refineInA(env, h)
        await advance(env, when.stayMs)
        await h.navigate[kind].leave()
        await advance(env, when.awayMs)
        await h.navigate[kind].back(A)
        await assertNoDoneBubbleStays(env, h, kind + ' / ' + when.name)
        assert.equal(net.sent.length, 1, 'navigation sends nothing')
      } finally { net.restore() }
    })
  }
}

test('SN-03 [State] going away and back repeatedly never brings the success bubble back', async () => {
  const env = await bootClient()
  const net = stubFetch([okReply()])
  try {
    const h = host(env)
    await refineInA(env, h)
    for (const kind of ['rerender', 'keyed', 'remount', 'rerender', 'remount']) {
      await h.navigate[kind].leave()
      await advance(env, 500)
      await h.navigate[kind].back(A)
      assert.equal(h.active('done').length, 0, 'after ' + kind)
    }
    await assertNoDoneBubbleStays(env, h, 'after repeated navigation')
  } finally { net.restore() }
})

// ================================================================ composer capsule survives navigation

for (const kind of ['remount', 'rerender']) {
  test(`SN-04 [${kind}] the Revert | Retry capsule is still shown after navigating back while the draft holds the refined text`, async () => {
    const env = await bootClient()
    const net = stubFetch([okReply()])
    try {
      const h = host(env)
      await refineInA(env, h)
      await h.navigate[kind].leave()
      await advance(env, 3000)
      await h.navigate[kind].back(A)
      if (kind === 'rerender') await h.rerenderButton(A)
      assert.equal(h.capsule('dip-revert').length, 1)
      assert.equal(h.capsule('dip-retry').length, 1)
      assert.equal(h.active('done').length, 0, 'but no success bubble')

      await act(() => { h.capsule('dip-revert')[0].props.onClick() })
      assert.equal(h.draftOf(A), ORIGINAL, 'Revert still restores the original draft after navigation')
    } finally { net.restore() }
  })
}

// ================================================================ a NEW refine shows its bubble again, once

test('SN-05 [State done->busy->done] Retry from the capsule after navigating back shows the success bubble once more, then not again', async () => {
  const env = await bootClient()
  const net = stubFetch([okReply(), okReply(RETRIED, 3300)])
  try {
    const h = host(env)
    await refineInA(env, h)
    await h.navigate.remount.leave()
    await advance(env, DONE_HIDE_MS + EXIT_SETTLE_MS)
    await h.navigate.remount.back(A)
    assert.equal(h.active('done').length, 0)

    await act(() => { h.capsule('dip-retry')[0].props.onClick() })
    await flush()
    assert.equal(net.sent.length, 2)
    assert.equal(net.sent[1].text, ORIGINAL, 'Retry regenerates from the original draft')
    assert.equal(h.draftOf(A), RETRIED)
    assert.equal(h.active('done').length, 1, 'the new refine shows its own success bubble')

    await h.navigate.remount.leave()
    await h.navigate.remount.back(A)
    await assertNoDoneBubbleStays(env, h, 'after the retried refine')
  } finally { net.restore() }
})

test('SN-06 [State] a new click after Revert, with the overlay kept from navigation, shows the success bubble once more', async () => {
  const env = await bootClient()
  const net = stubFetch([okReply(), okReply(REWRITTEN, 2100)])
  try {
    const h = host(env)
    await refineInA(env, h)
    await h.navigate.rerender.leave()
    await h.navigate.rerender.back(A)
    await h.rerenderButton(A)
    assert.equal(h.active('done').length, 0)

    await act(() => { h.capsule('dip-revert')[0].props.onClick() })
    await h.rerenderButton(A)
    await h.click()
    assert.equal(net.sent.length, 2)
    // Same reply text and meta as the first refine: only the fact that it is a new refine differs.
    assert.equal(h.active('done').length, 1, 'a new refine in the same session shows its bubble')

    await h.navigate.rerender.leave()
    await h.navigate.rerender.back(A)
    await assertNoDoneBubbleStays(env, h, 'after the second refine')
  } finally { net.restore() }
})

test('SN-07 [State] a new refine that finishes while A is away is shown on return, once', async () => {
  const env = await bootClient()
  const net = stubFetch([okReply(), 'hold'])
  try {
    const h = host(env)
    await refineInA(env, h)
    await advance(env, DONE_HIDE_MS + EXIT_SETTLE_MS)
    await h.rerenderButton(A)
    await act(() => { h.capsule('dip-retry')[0].props.onClick() })
    // Leave before the reply lands: nobody observes this success yet.
    await h.navigate.remount.leave()
    assert.equal(net.held.length, 1, 'the retry is in flight')
    await act(() => { net.held[0](okReply(RETRIED, 3300)()) })
    await flush()
    assert.equal(h.draftOf(A), RETRIED)
    await h.navigate.remount.back(A)
    assert.equal(h.active('done').length, 1, 'the first mount observing the new success shows it')
    await h.navigate.remount.leave()
    await h.navigate.remount.back(A)
    await assertNoDoneBubbleStays(env, h, 'second return')
  } finally { net.restore() }
})

// ================================================================ error bubbles keep their behaviour

for (const kind of ['remount', 'rerender']) {
  test(`SN-08 [EP error / BVA 11999 ms, ${kind}] an error bubble is shown again when coming back within 12 s, with its Retry button`, async () => {
    const env = await bootClient()
    const net = stubFetch([failReply])
    try {
      const h = host(env)
      await h.open(A)
      await h.click()
      assert.equal(h.active('error').length, 1)
      await h.navigate[kind].leave()
      await advance(env, ERROR_HIDE_MS - 1)
      await h.navigate[kind].back(A)
      assert.equal(h.active('error').length, 1, 'the error is shown again')
      assert.equal(h.retryInBubble().length, 1, 'with its Retry button')
      assert.equal(h.draftOf(A), ORIGINAL, 'the draft is untouched')
    } finally { net.restore() }
  })
}

test('SN-09 [BVA 12000 ms] an error bubble left mounted auto-clears at 12000 ms and is not shown on return', async () => {
  const env = await bootClient()
  const net = stubFetch([failReply])
  try {
    const h = host(env)
    await h.open(A)
    await h.click()
    await advance(env, ERROR_HIDE_MS - 1)
    assert.equal(h.active('error').length, 1, 'still shown at 11999 ms')
    await advance(env, 1)
    assert.equal(h.active('error').length, 0, 'auto-cleared at 12000 ms')
    await advance(env, EXIT_SETTLE_MS)
    await h.navigate.remount.leave()
    await h.navigate.remount.back(A)
    assert.equal(h.bar.toJSON(), null)
  } finally { net.restore() }
})

test('SN-10 [State error->busy->done] a failed refine retried from the bubble shows success once; navigation does not repeat it', async () => {
  const env = await bootClient()
  const net = stubFetch([failReply, okReply()])
  try {
    const h = host(env)
    await h.open(A)
    await h.click()
    await act(() => { h.retryInBubble()[0].props.onClick({ preventDefault() {}, stopPropagation() {} }) })
    await flush()
    assert.equal(h.draftOf(A), REWRITTEN)
    assert.equal(h.active('done').length, 1)
    await h.navigate.remount.leave()
    await h.navigate.remount.back(A)
    await assertNoDoneBubbleStays(env, h, 'after a retried failure')
  } finally { net.restore() }
})

// ================================================================ sessions are independent

test('SN-11 [EP session] B shows its own success bubble after A\'s was shown; returning to A shows nothing', async () => {
  const env = await bootClient()
  const net = stubFetch([okReply(), okReply()])
  try {
    const h = host(env)
    await refineInA(env, h)
    await h.navigate.remount.leave()
    await h.open(B)
    await h.click()
    assert.equal(h.draftOf(B), REWRITTEN)
    assert.deepEqual(net.sent.map((s) => s.sessionId), [A, B])
    assert.equal(h.active('done').length, 1, 'B shows its own success bubble (same text as A)')

    await h.navigate.remount.leave()
    await h.open(A)
    await assertNoDoneBubbleStays(env, h, 'back on A')

    await h.navigate.remount.leave()
    await h.open(B)
    await assertNoDoneBubbleStays(env, h, 'back on B')
  } finally { net.restore() }
})

test('SN-12 [EP session, rerender] a B success that finished while A was shown appears when the overlay switches to B', async () => {
  const env = await bootClient()
  const net = stubFetch([okReply(), okReply()])
  try {
    const h = host(env)
    // B refines first through its own composer, with no overlay showing B.
    await h.mountButton(B)
    await h.click()
    await act(() => { h.button.unmount() })
    await refineInA(env, h)
    await h.navigate.rerender.leave() // overlay now shows B
    assert.equal(h.active('done').length, 1, 'B\'s success is shown on the first overlay render for B')
    await h.navigate.rerender.back(A)
    assert.equal(h.active('done').length, 0, 'A\'s already shown success stays hidden')
    await h.navigate.rerender.leave()
    assert.equal(h.active('done').length, 0, 'and B\'s is not repeated either')
  } finally { net.restore() }
})
