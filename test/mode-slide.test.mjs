// Press-and-hold / slide "mode bar" on the composer star. Black-box, system level: the BUILT
// client bundle (lib/client.js) is booted through its public apply(ctx) against a fake host
// (slots, locale with the registered zh / en dictionaries, ctx.inject serving a fake
// configForms whose ConfigForm records every write) and rendered with react-test-renderer.
// globalThis.document exists and the bundle gets a 'react-dom' whose createPortal(el) returns el,
// so the bar renders inline. The hold timer is the global setTimeout, driven by mock.timers.
// Expectations come from the mode-bar requirements only (S1..S10).
//
// Techniques:
//  - EP: press kind (button 0 primary / button 1 / button 2 / non-primary); pointer identity
//    (pressed id / another id); availability (no configForms / loading / unavailable /
//    read-only / ready + writable); click kind (mouse detail 1 / keyboard detail 0); locale
//    (zh / en); document present / absent; star rect present / absent.
//  - BVA: hold 299 / 300 ms; open travel |dx| 15 / 16 with |dy| 0 / 15 / 16 (|dx| = |dy|);
//    selection dx 0 / 43 / 44 / 87 / 88 / 131 / 132 / 200 / 1000 and negatives from each start
//    index 0 / 1 / 2; left edge formula 7 / 8 / 9; right edge 719 / 720 / 721; viewports
//    300 / 289 / 288 / 287 / 280 / 200 wide.
//  - Decision table: switchable x opened-by (hold / slide move / release-only travel / none)
//    x release position (start segment / other segment / beyond an end) x start mode ->
//    write, shown mode, whether the following mouse click improves.
//  - State transition: idle -> pressed -> open -> released | escaped | cancelled -> idle;
//    pressed -> released / cancelled before the hold; consecutive gestures; a press while a
//    write is pending starts from the pending mode; a failed write reverts.
//
// Cases:
//  SL-01 a still press opens the bar at 300 ms, not at 299 ms; it opens on the start mode
//  SL-02 released at 299 ms or cancelled at 150 ms: the bar never opens afterwards
//  SL-03 sub-threshold and vertical moves during the hold do not stop it opening at 300 ms
//  SL-04 slide open BVA: |dx| 15 / 16 and dominance (16,15) vs (16,16), both directions
//  SL-05 travel counts from the press point; an open bar stays open back at the start
//  SL-06 moves / pointerup of another pointerId neither open, change nor release the bar
//  SL-07 button 1, button 2, non-primary pointer: never opens (hold or slide), no write
//  SL-08 not switchable (4 availability states): never opens (hold or slide), no write
//  SL-10 structure: listbox, three options in order, data-mode, svg, selection attrs, thumb
//  SL-11 the bar goes through createPortal into document.body
//  SL-12 segment labels in zh and en
//  SL-13 without globalThis.document no bar renders, nothing throws, a slide still selects
//  SL-20 placement at mid-viewport for each start index; style numbers are numbers
//  SL-21 left-edge clamp BVA (formula 7 / 8 / 9) for each start index
//  SL-22 right-edge clamp BVA (719 / 720 / 721) for each start index
//  SL-23 narrow viewports, incl. narrower than 288
//  SL-24 bottom from the star rect top, or the press clientY without a rect; placement fixed
//  SL-30 selection BVA from detailed (index 0)
//  SL-31 selection BVA from standard (index 1)
//  SL-32 selection BVA from light (index 2)
//  SL-33 vertical travel is ignored once open (selection and release)
//  SL-34 a slide-opened bar selects with the same rule as a hold-opened one
//  SL-40 release on another segment: one write, shown at once, bar closed, click swallowed
//  SL-41 release on the start segment: no write, bar closed, click swallowed
//  SL-42 release-only travel (no pointermove) BVA: slide vs plain click, selection
//  SL-43 a keyboard click improves after an opened release, a slide release and an Esc
//  SL-44 a new plain press re-arms the mouse click
//  SL-50 plain click (< 300 ms, travel < 16 or vertical): no bar, no write, improves
//  SL-51 a plain click while a refine runs cancels it
//  SL-55 decision table switchable x opened-by x release position x start mode
//  SL-60 Esc closes, writes nothing; the later release changes nothing, its click is swallowed
//  SL-61 Esc on a slide-opened bar: the release at the travelled point still writes nothing
//  SL-62 pointercancel closes, writes nothing; a stray pointerup neither
//  SL-63 the keydown listener exists while open and is removed after release / Esc / cancel
//  SL-65 setPointerCapture(pointerId) on the pressed element when the bar opens, not at press
//  SL-66 onContextMenu prevents the default only while a press is down
//  SL-70 consecutive gestures start from the mode the previous one saved
//  SL-71 a press while a write is pending starts from the pending mode
//  SL-72 a failed write reverts the star; the next bar starts from the snapshot mode
//  SL-80 the star's title second line mentions holding (zh 按住, en hold)
//  SL-81 the first-use window still opens and mentions holding (zh, en)
//  SL-82 the Revert | Retry capsule has no data-mode and never shows the bar
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer from 'react-test-renderer'

const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const T = { timeout: 60000 }
const NS = 'dsh-smart-prompt'
const BUTTON_ID = 'dsh-smart-prompt-button'
const OVERLAY_SLOT = 'conversation.input.overlay'
const CONFIG_FORMS = 'configForms'
const REMOTE_SESSION = 'remote.session'
const MODE_FIELD = 'defaultMode'
/** Left to right on the star and in the bar. */
const MODES = ['detailed', 'standard', 'light']
const DEFAULT_MODE = 'standard'
/** Gesture and layout rules of the mode bar (S1, S3, S4). */
const SLIDE = Object.freeze({ holdMs: 300, openTravelPx: 16, segmentPx: 88, padPx: 4, widthPx: 272, edgePx: 8, gapPx: 8 })
const CLS = { root: 'dip-root', star: 'dip-btn', icon: 'dip-icon', bar: 'dip-slide', seg: 'dip-slide-seg', thumb: 'dip-slide-thumb', revert: 'dip-revert', onboard: 'dip-onboard' }
const ROLE = { bar: 'listbox', seg: 'option' }
const LABEL = { zh: { detailed: '详细模式', standard: '标准', light: '轻' }, en: { detailed: 'Detailed', standard: 'Standard', light: 'Light' } }
/** New copy mentions holding the star (S10). */
const MENTIONS_HOLD = { zh: (s) => s.includes('按住'), en: (s) => /hold/i.test(s) }
const VIEWPORT = { innerWidth: 1000, innerHeight: 800 }
const PRESS = { x: 500, y: 700 }
/** Top of the star's bounding rect; differs from PRESS.y so the two sources are told apart. */
const STAR_TOP = 650
const STAR_SIZE = 32
const PRESSED_ID = 1
const OTHER_ID = 2
const MOUSE_CLICK = 1
const KEYBOARD_CLICK = 0
const ESCAPE = 'Escape'
const DRAFT = '把那个接口加上限流'
const REFINED = '为登录接口增加按 IP 的限流，每分钟 60 次。'
const META = { mode: 'standard', model: 'p/m', ratio: 1.4, ratioLabel: '1.4x', elapsedMs: 2100, anchors: { total: 0, kept: 0, reinjected: 0 }, note: '', contextUsed: 'none' }
const IMPROVE_URL = '/dsh-smart-prompt/api/improve'
/** Availability states in which switching is impossible (S1). */
const NOT_SWITCHABLE = [
  { name: 'no configForms service', form: undefined, shows: 'standard' },
  { name: 'loading', form: { status: 'loading', value: undefined, writable: true }, shows: 'standard' },
  { name: 'unavailable', form: { status: 'unavailable', value: undefined, writable: false }, shows: 'standard' },
  { name: 'ready, read-only', form: { status: 'ready', value: { defaultMode: 'light' }, writable: false }, shows: 'light' },
]

// ================================================================ harness

const act = (fn) => TestRenderer.act(async () => { await fn() })
const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)) })
const textOf = (node) => (typeof node === 'string' ? node : node.children.map(textOf).join(''))
const hasClass = (node, cls) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes(cls)
const byClass = (root, cls) => root.findAll((n) => typeof n.type === 'string' && hasClass(n, cls))

/** The mocked global clock of the running test. */
let clock = null

/** Every case runs with setTimeout mocked, so the 300 ms hold is driven explicitly. */
function slideTest(name, fn) {
  test(name, T, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    clock = t.mock.timers
    try { await fn(t) } finally { clock = null }
  })
}

const advance = (ms) => act(() => { clock.tick(ms) })

async function create(Component, props) {
  let renderer = null
  await act(() => { renderer = TestRenderer.create(React.createElement(Component, props)) })
  return renderer
}

const captureFlag = (options) => (typeof options === 'boolean' ? options : options?.capture === true)

/** A minimal browser window; its timers are the (mocked) global ones, as in a browser. */
function fakeWindow(viewport) {
  const listeners = []
  const win = {
    innerWidth: viewport.innerWidth,
    innerHeight: viewport.innerHeight,
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    addEventListener(type, fn, options) { listeners.push({ type, fn, capture: captureFlag(options), once: options?.once === true }) },
    removeEventListener(type, fn, options) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === captureFlag(options))
      if (i >= 0) listeners.splice(i, 1)
    },
    matchMedia: () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  }
  // Test-side helpers, not part of the browser surface.
  const count = (type) => listeners.filter((l) => l.type === type).length
  const dispatch = (type, event) => {
    for (const l of listeners.filter((x) => x.type === type)) {
      if (l.once) win.removeEventListener(type, l.fn, { capture: l.capture })
      if (typeof l.fn === 'function') l.fn(event)
      else l.fn?.handleEvent?.(event)
    }
  }
  return { win, count, dispatch }
}

function memoryStorage() {
  const entries = new Map()
  return {
    getItem: (k) => (entries.has(String(k)) ? entries.get(String(k)) : null),
    setItem: (k, v) => { entries.set(String(k), String(v)) },
    removeItem: (k) => { entries.delete(String(k)) },
    clear: () => { entries.clear() },
    key: (i) => [...entries.keys()][i] ?? null,
    get length() { return entries.size },
  }
}

/**
 * A minimal document: body is the portal target; head, createElement and querySelectorAll
 * only serve the plugin's style injection, which runs whenever a document exists.
 */
function fakeDocument(body) {
  const head = { children: [], appendChild(node) { head.children.push(node); return node } }
  return {
    body,
    head,
    createElement: (tag) => ({ tagName: String(tag).toUpperCase(), dataset: {}, textContent: '', remove() { const i = head.children.indexOf(this); if (i >= 0) head.children.splice(i, 1) } }),
    querySelectorAll: () => [],
  }
}

function installStorage(win, storage) {
  const descriptor = { configurable: true, enumerable: true, writable: true, value: storage }
  Object.defineProperty(win, 'localStorage', descriptor)
  Object.defineProperty(globalThis, 'localStorage', descriptor)
}

/** Load the built bundle as the module loader does; react-dom.createPortal renders inline. */
async function loadClient(env) {
  let captured = null
  env.win.__ModuleLoader__ = { load: (m) => { captured = m } }
  globalThis.window = env.win
  await import('../lib/client.js?slide=' + String(Date.now()) + Math.random())
  assert.ok(captured !== null, 'bundle must call window.__ModuleLoader__.load')
  const reactDom = { ...require('react-dom'), createPortal: (element, container) => { env.portals.push(container); return element } }
  return captured.factory((id) => {
    if (id === 'react') return React
    if (id === 'react-dom') return reactDom
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (id === 'react-dom/client') return require('react-dom/client')
    throw new Error('unexpected external: ' + id)
  })
}

/**
 * Fake host ConfigForm. opts.write: 'commit' (folds the value in, resolves true), 'hold'
 * (pending; settle through form.held[i]), 'false' (resolves false), 'reject' (rejects).
 */
function fakeForm(opts = {}) {
  const value = 'value' in opts ? opts.value : { defaultMode: DEFAULT_MODE }
  const listeners = new Set()
  let snap = { status: opts.status ?? 'ready', value, base: {}, user: value === undefined ? {} : { ...value }, revision: 1, writable: opts.writable ?? true }
  const form = {
    write: opts.write ?? 'commit',
    sets: [],
    unsets: [],
    mutates: [],
    held: [],
    getSnapshot: () => snap,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(field, next) {
      form.sets.push([field, next])
      if (form.write === 'false') return Promise.resolve(false)
      if (form.write === 'reject') return Promise.reject(new Error('write rejected'))
      if (form.write === 'hold') return new Promise((resolve, reject) => { form.held.push({ field, value: next, resolve, reject }) })
      return Promise.resolve().then(() => { form.setValue(field, next); return true })
    },
    unset(field) { form.unsets.push(field); return Promise.resolve(true) },
    mutate(ops, expectedRevision) { form.mutates.push({ ops, expectedRevision }); return Promise.resolve(true) },
    publish(patch) {
      snap = { ...snap, ...patch, revision: snap.revision + 1 }
      for (const listener of [...listeners]) listener()
    },
    setValue(field, next) { form.publish({ value: { ...(snap.value ?? {}), [field]: next } }) },
  }
  return form
}

const REMOTE_SESSION_FACE = { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) }

/**
 * Boot the bundle against a fake host. The translator reads the registered dictionary of
 * lang. form omitted = no configForms service. withDocument false = no globalThis.document.
 */
async function boot({ form, lang = 'zh', viewport = VIEWPORT, withDocument = true } = {}) {
  const env = { form, lang, registered: [], locales: {}, portals: [], body: { nodeName: 'BODY' } }
  Object.assign(env, fakeWindow(viewport))
  installStorage(env.win, memoryStorage())
  if (withDocument) globalThis.document = fakeDocument(env.body)
  else delete globalThis.document
  const module = await loadClient(env)
  const service = form === undefined ? undefined : {
    get: (id) => (id === NS ? form : undefined),
    whileServed: (_namespaces, register) => { const off = register(); return typeof off === 'function' ? off : () => {} },
  }
  const provided = (name) => {
    if (name === CONFIG_FORMS) return service
    if (name === REMOTE_SESSION) return REMOTE_SESSION_FACE
    return undefined
  }
  env.t = (key) => env.locales[NS]?.[lang]?.[key] ?? key
  const ctx = {
    slots: {
      inject(_seat, fn) {
        const it = fn()
        if (it !== undefined && it !== null && typeof it.next === 'function') it.next()
        return () => {}
      },
      register(options, component) { env.registered.push({ options, component }); return () => {} },
    },
    locale: { register(ns, dicts) { env.locales[ns] = dicts; return () => {} }, bind() { return env.t } },
    effect(fn) { return fn() },
    on() { return () => {} },
    get: provided,
    inject(names, callback) {
      if (service === undefined || !names.every((n) => n === CONFIG_FORMS)) return () => {}
      callback({ ...ctx, get: provided })
      return () => {}
    },
  }
  await act(() => { module.apply(ctx) })
  return env
}

function seatProps(env, entry, live, actions) {
  const base = typeof entry.options.inject === 'function' ? entry.options.inject('s1') : {}
  return { ...base, sessionId: 's1', useInput: (sel) => sel({ draft: live.draft, attachmentIds: [], phase: 'plain' }), inputActions: actions, t: env.t }
}

/**
 * Mount the composer star. live.el is the pressed div.dip-root as a DOM element: it records
 * pointer captures and (unless rect is false) reports its bounding rect.
 */
async function mountStar(env, { rect = true } = {}) {
  const entry = env.registered.find((r) => r.options.id === BUTTON_ID)
  assert.ok(entry !== undefined, 'the composer star is registered')
  const live = { env, draft: DRAFT, captures: [], at: { ...PRESS } }
  live.el = {
    setPointerCapture: (id) => { live.captures.push(id) },
    releasePointerCapture() {},
    hasPointerCapture: (id) => live.captures.includes(id),
  }
  if (rect) {
    const left = PRESS.x - STAR_SIZE / 2
    live.el.getBoundingClientRect = () => ({ top: STAR_TOP, bottom: STAR_TOP + STAR_SIZE, left, right: left + STAR_SIZE, width: STAR_SIZE, height: STAR_SIZE, x: left, y: STAR_TOP })
  }
  const actions = { setDraft: (text) => { live.draft = text } }
  const props = () => seatProps(env, entry, live, actions)
  live.renderer = await create(entry.component, props())
  live.rerender = () => act(() => { live.renderer.update(React.createElement(entry.component, props())) })
  live.root = () => byClass(live.renderer.root, CLS.root)[0]
  live.star = () => byClass(live.renderer.root, CLS.star)[0]
  live.icon = () => byClass(live.star(), CLS.icon)[0]
  return live
}

/** Mount every overlay-slot entry; dialogs() lists the onboarding windows they render. */
async function mountOverlays(env) {
  const live = { draft: DRAFT }
  const renderers = []
  for (const entry of env.registered.filter((r) => r.options.name === OVERLAY_SLOT)) {
    renderers.push(await create(entry.component, seatProps(env, entry, live, { setDraft() {} })))
  }
  return { dialogs: () => renderers.flatMap((r) => byClass(r.root, CLS.onboard)) }
}

// ---------------------------------------------------------------- pointer gestures

/** A pointer event as the browser shapes it; moves report button -1 with buttons 1. */
function pointerEvent(live, type, x, y, { pointerId = PRESSED_ID, button = 0, buttons = 1, isPrimary = true, pointerType = 'mouse' } = {}) {
  return { type, pointerId, clientX: x, clientY: y, button, buttons, isPrimary, pointerType, currentTarget: live.el, target: live.el, preventDefault() {}, stopPropagation() {}, persist() {} }
}

/**
 * Deliver a pointer event on the star: to div.dip-root's React handler, then (bubbling) to
 * window listeners of that type, as a browser does. strict requires the React handler.
 */
async function deliver(live, prop, type, event, strict) {
  const fn = live.root()?.props[prop]
  if (strict) assert.equal(typeof fn, 'function', '.dip-root carries ' + prop)
  await act(() => {
    if (typeof fn === 'function') fn(event)
    live.env.dispatch(type, event)
  })
}

/** Press at (x, y) (default PRESS); later moves / releases are relative to this point. */
async function down(live, { x = PRESS.x, y = PRESS.y, ...opts } = {}) {
  live.at = { x, y }
  await deliver(live, 'onPointerDown', 'pointerdown', pointerEvent(live, 'pointerdown', x, y, { buttons: 1, ...opts }), true)
}

async function move(live, dx, dy = 0, opts = {}) {
  await deliver(live, 'onPointerMove', 'pointermove', pointerEvent(live, 'pointermove', live.at.x + dx, live.at.y + dy, { button: -1, buttons: 1, ...opts }), false)
}

async function up(live, dx = 0, dy = 0, opts = {}) {
  await deliver(live, 'onPointerUp', 'pointerup', pointerEvent(live, 'pointerup', live.at.x + dx, live.at.y + dy, { button: 0, buttons: 0, ...opts }), false)
  await settle()
}

async function cancel(live, dx = 0, dy = 0, opts = {}) {
  await deliver(live, 'onPointerCancel', 'pointercancel', pointerEvent(live, 'pointercancel', live.at.x + dx, live.at.y + dy, { button: -1, buttons: 0, ...opts }), false)
  await settle()
}

/** Press and keep still for the hold time: the bar opens. */
async function holdOpen(live, pressAt) { await down(live, pressAt); await advance(SLIDE.holdMs) }

async function escape(env) {
  await act(() => { env.dispatch('keydown', { type: 'keydown', key: ESCAPE, code: ESCAPE, preventDefault() {}, stopPropagation() {} }) })
  await settle()
}

async function click(live, detail) {
  await act(() => { live.star().props.onClick({ detail, button: 0, preventDefault() {}, stopPropagation() {} }) })
  await settle()
}

/** A plain mouse click: press, release on the spot (< 300 ms), click. */
async function plainClick(live) { await down(live); await up(live); await click(live, MOUSE_CLICK) }

function stubFetch({ hold = false } = {}) {
  const sent = []
  const original = globalThis.fetch
  globalThis.fetch = (url, init = {}) => {
    sent.push({ url: String(url), signal: init.signal })
    if (!hold) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, text: REFINED, meta: META }) })
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener?.('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })), { once: true })
    })
  }
  return { improves: () => sent.filter((s) => s.url === IMPROVE_URL), restore: () => { globalThis.fetch = original } }
}

/** Run fn with a fetch stub installed. */
async function withFetch(fn, opts) {
  const net = stubFetch(opts)
  try { return await fn(net) } finally { net.restore() }
}

// ---------------------------------------------------------------- oracle and assertions

const indexOf = (mode) => MODES.indexOf(mode)
const thumbTransform = (mode) => 'translateX(' + String(indexOf(mode) * SLIDE.segmentPx) + 'px)'

const bars = (live) => byClass(live.renderer.root, CLS.bar)

function assertClosed(live, message) { assert.equal(bars(live).length, 0, message + ': no mode bar') }

function readBar(live, message) {
  const found = bars(live)
  assert.equal(found.length, 1, message + ': exactly one div.dip-slide')
  const [bar] = found
  return { bar, segs: byClass(bar, CLS.seg), thumbs: byClass(bar, CLS.thumb) }
}

/** The bar is open with selected as the only selected segment, the thumb under it. */
function assertOpen(live, selected, message) {
  const { segs, thumbs } = readBar(live, message)
  assert.deepEqual(segs.map((s) => s.props['data-mode']), MODES, message + ': segments detailed, standard, light')
  assert.deepEqual(segs.map((s) => s.props['data-selected']), MODES.map((m) => String(m === selected)), message + ': data-selected on ' + selected)
  assert.deepEqual(segs.map((s) => s.props['aria-selected']), MODES.map((m) => m === selected), message + ': aria-selected on ' + selected)
  assert.equal(thumbs.length, 1, message + ': one thumb')
  assert.equal(thumbs[0].props.style?.transform, thumbTransform(selected), message + ': thumb under ' + selected)
}

function assertPlacement(live, { left, bottom, originX }, message) {
  const style = readBar(live, message).bar.props.style ?? {}
  assert.equal(typeof style.left, 'number', message + ': left is a number')
  assert.equal(typeof style.bottom, 'number', message + ': bottom is a number')
  assert.equal(style.left, left, message + ': left')
  assert.equal(style.bottom, bottom, message + ': bottom')
  assert.equal(style.transformOrigin, String(originX) + 'px 100%', message + ': transformOrigin')
}

function assertShows(live, mode, message) {
  assert.ok(live.root() !== undefined && live.star() !== undefined, message + ': the star is rendered')
  assert.equal(live.root().props['data-mode'], mode, message + ': div.dip-root data-mode')
  assert.equal(live.icon()?.props['data-mode'], mode, message + ': svg.dip-icon data-mode')
}

function assertWrites(form, modes, message) {
  assert.deepEqual(form.sets, modes.map((m) => [MODE_FIELD, m]), message + ': form.set calls')
  assert.equal(form.unsets.length, 0, message + ': no unset')
  assert.equal(form.mutates.length, 0, message + ': no mutate')
}

/** A switchable star with mode saved, mounted. */
async function starOn(mode, formOpts = {}, bootOpts = {}) {
  const form = fakeForm({ value: { defaultMode: mode }, ...formOpts })
  const env = await boot({ form, ...bootOpts })
  return { form, env, live: await mountStar(env) }
}

// ================================================================ S1 opening

slideTest('SL-01 [BVA hold] a still press opens the bar at 300 ms, not at 299 ms; it opens on the start mode (each start)', async () => {
  for (const mode of MODES) {
    const { live, form } = await starOn(mode)
    await down(live)
    assertClosed(live, mode + ': at press')
    await advance(SLIDE.holdMs - 1)
    assertClosed(live, mode + ': held 299 ms')
    await advance(1)
    assertOpen(live, mode, mode + ': held 300 ms')
    await up(live)
    assertWrites(form, [], mode + ': released on the start segment')
  }
})

slideTest('SL-02 [BVA hold / State] released at 299 ms, or cancelled at 150 ms: the bar never opens afterwards', async () => {
  const released = await starOn('standard')
  await down(released.live)
  await advance(SLIDE.holdMs - 1)
  await up(released.live)
  await advance(SLIDE.holdMs * 3)
  assertClosed(released.live, 'released at 299 ms, then 900 ms more')
  assertWrites(released.form, [], 'released at 299 ms')

  const cancelled = await starOn('standard')
  await down(cancelled.live)
  await advance(SLIDE.holdMs / 2)
  await cancel(cancelled.live)
  await advance(SLIDE.holdMs * 3)
  assertClosed(cancelled.live, 'cancelled at 150 ms, then 900 ms more')
  assertWrites(cancelled.form, [], 'cancelled at 150 ms')
})

slideTest('SL-03 [State hold] moves below the slide threshold and vertical moves do not stop the bar opening 300 ms after the press', async () => {
  const { live } = await starOn('standard')
  await down(live)
  await advance(100)
  await move(live, SLIDE.openTravelPx - 1, 0)
  await advance(100)
  await move(live, 0, 40)
  assertClosed(live, 'at 200 ms after small and vertical moves')
  await advance(SLIDE.holdMs - 200 - 1)
  assertClosed(live, 'at 299 ms')
  await advance(1)
  assertOpen(live, 'standard', 'at 300 ms from the press')
})

slideTest('SL-04 [BVA slide] a pointermove opens it at |dx| >= 16 with |dx| > |dy| (15/16, dominance), both directions', async () => {
  const rows = [
    { dx: 15, dy: 0, opens: false }, { dx: -15, dy: 0, opens: false },
    { dx: 16, dy: 0, opens: true }, { dx: -16, dy: 0, opens: true },
    { dx: 16, dy: 15, opens: true }, { dx: -16, dy: -15, opens: true },
    { dx: 16, dy: 16, opens: false }, { dx: -16, dy: 16, opens: false },
    { dx: 40, dy: -40, opens: false }, { dx: 0, dy: 60, opens: false },
  ]
  for (const row of rows) {
    const name = '(' + String(row.dx) + ',' + String(row.dy) + ')'
    const { live } = await starOn('standard')
    await down(live)
    await move(live, row.dx, row.dy)
    if (row.opens) assertOpen(live, 'standard', name + ' opens on the start mode')
    else assertClosed(live, name + ' does not open')
  }
})

slideTest('SL-05 [State slide] travel counts from the press point; once open, the bar stays open back at the start', async () => {
  const { live, form } = await starOn('detailed')
  await down(live, { x: 300, y: 600 })
  await move(live, 10, 30)
  await move(live, 15, -2)
  assertClosed(live, '15 px from the press point')
  await move(live, 16, -2)
  assertOpen(live, 'detailed', '16 px from the press point')
  await move(live, 0, 0)
  assertOpen(live, 'detailed', 'back at the press point')
  await move(live, 0, 80)
  assertOpen(live, 'detailed', 'straight down once open')
  await up(live, 0, 80)
  assertClosed(live, 'released')
  assertWrites(form, [], 'released on the start segment')
})

slideTest('SL-06 [EP pointer id] moves and pointerup of another pointerId neither open, change nor release the bar', async () => {
  const { live, form } = await starOn('standard')
  await down(live)
  await move(live, 100, 0, { pointerId: OTHER_ID })
  assertClosed(live, 'another pointer travelled 100 px')
  await advance(SLIDE.holdMs)
  assertOpen(live, 'standard', 'the pressed pointer held 300 ms')
  await move(live, -200, 0, { pointerId: OTHER_ID })
  assertOpen(live, 'standard', 'another pointer at -200 px does not select')
  await up(live, -200, 0, { pointerId: OTHER_ID })
  assertOpen(live, 'standard', 'pointerup of another pointer does not release')
  assertWrites(form, [], 'another pointer')
  await move(live, 88, 0)
  assertOpen(live, 'light', 'the pressed pointer still selects')
  await up(live, 88, 0)
  assertClosed(live, 'the pressed pointer releases')
  assertWrites(form, ['light'], 'the pressed pointer releases')
})

slideTest('SL-07 [EP press kind] button 1, button 2 or a non-primary pointer never opens the bar (hold or slide) and writes nothing', async () => {
  const kinds = [
    { name: 'button 1', press: { button: 1, buttons: 4 }, same: {} },
    { name: 'button 2', press: { button: 2, buttons: 2 }, same: {} },
    { name: 'non-primary touch', press: { pointerId: 3, isPrimary: false, pointerType: 'touch' }, same: { pointerId: 3, isPrimary: false, pointerType: 'touch' } },
  ]
  for (const kind of kinds) {
    const { live, form } = await starOn('standard')
    await down(live, kind.press)
    await advance(SLIDE.holdMs)
    assertClosed(live, kind.name + ': held 300 ms')
    await move(live, -100, 0, kind.same)
    assertClosed(live, kind.name + ': slid 100 px')
    await up(live, -100, 0, kind.same)
    assertWrites(form, [], kind.name)
    assertShows(live, 'standard', kind.name)
  }
})

slideTest('SL-08 [EP availability] not switchable (no form / loading / unavailable / read-only): never opens by hold or slide, no write', async () => {
  for (const row of NOT_SWITCHABLE) {
    const form = row.form === undefined ? undefined : fakeForm(row.form)
    const live = await mountStar(await boot({ form }))
    await holdOpen(live)
    assertClosed(live, row.name + ': held 300 ms')
    await up(live)
    await down(live)
    await move(live, -100, 0)
    assertClosed(live, row.name + ': slid -100 px')
    await move(live, 200, 0)
    await up(live, 200, 0)
    assertClosed(live, row.name + ': released')
    if (form !== undefined) assertWrites(form, [], row.name)
    assertShows(live, row.shows, row.name)
  }
})

// ================================================================ S2 rendering

slideTest('SL-10 [EP structure] listbox; three option spans in order with data-mode, own svg, selection attributes; the thumb under the start', async () => {
  for (const mode of MODES) {
    const { live } = await starOn(mode)
    await holdOpen(live)
    const { bar, segs, thumbs } = readBar(live, mode)
    assert.equal(bar.type, 'div', mode + ': the bar is a div')
    assert.equal(bar.props.role, ROLE.bar, mode + ': role listbox')
    assert.equal(segs.length, 3, mode + ': three segments')
    for (const seg of segs) {
      const own = seg.props['data-mode']
      assert.equal(seg.type, 'span', own + ' segment is a span')
      assert.equal(seg.props.role, ROLE.seg, own + ' segment has role option')
      const svgs = seg.findAll((n) => n.type === 'svg')
      assert.ok(svgs.length >= 1, own + ' segment has an svg icon')
      assert.equal(svgs[0].props['data-mode'], own, own + ' segment icon data-mode')
    }
    assert.equal(thumbs[0]?.type, 'span', mode + ': the thumb is a span')
    assertOpen(live, mode, mode + ' start')
  }
})

slideTest('SL-11 [EP portal] the bar is rendered with createPortal into document.body', async () => {
  const { live, env } = await starOn('standard')
  await holdOpen(live)
  assertOpen(live, 'standard', 'open')
  assert.ok(env.portals.length >= 1, 'createPortal was used')
  assert.ok(env.portals.every((container) => container === env.body), 'every portal targets document.body')
})

slideTest('SL-12 [EP locale] segment labels: zh 详细 / 标准 / 轻量, en Detailed / Standard / Light', async () => {
  // Mode-bar labels only (user decision); settings-page mode names are unchanged.
  const BAR_LABEL = { zh: { detailed: '详细', standard: '标准', light: '轻量' }, en: { detailed: 'Detailed', standard: 'Standard', light: 'Light' } }
  for (const lang of ['zh', 'en']) {
    const { live } = await starOn('standard', {}, { lang })
    await holdOpen(live)
    for (const seg of readBar(live, lang).segs) {
      const mode = seg.props['data-mode']
      assert.ok(textOf(seg).includes(BAR_LABEL[lang][mode]), lang + ' ' + mode + ' label "' + BAR_LABEL[lang][mode] + '" in "' + textOf(seg) + '"')
    }
  }
})

slideTest('SL-13 [EP no document] without globalThis.document no bar is rendered and nothing throws; a slide release still selects by distance', async () => {
  try {
    const { live, form, env } = await starOn('standard', {}, { withDocument: false })
    await holdOpen(live)
    assertClosed(live, 'held 300 ms without a document')
    assert.equal(env.portals.length, 0, 'no portal without a document')
    await move(live, -100, 0)
    assertClosed(live, 'slid without a document')
    await up(live, -100, 0)
    assertWrites(form, ['detailed'], 'released 100 px left of standard')
    assertShows(live, 'detailed', 'released 100 px left of standard')
  } finally {
    globalThis.document = fakeDocument({ nodeName: 'BODY' })
  }
})

// ================================================================ S3 placement

/** Fresh star per row; each row presses at its own x with its own start mode. */
async function placementRows(viewport, rows, label) {
  for (const row of rows) {
    const { live } = await starOn(row.mode, {}, { viewport })
    const name = label + ' ' + row.mode + ' pressX ' + String(row.x)
    await holdOpen(live, { x: row.x, y: PRESS.y })
    assertPlacement(live, { left: row.left, bottom: viewport.innerHeight - STAR_TOP + SLIDE.gapPx, originX: row.x - row.left }, name)
    await up(live)
  }
}

slideTest('SL-20 [EP placement] mid-viewport press: left / bottom / transformOrigin for start index 0 / 1 / 2', async () => {
  // left = pressX - 4 - (i + 0.5) * 88: 500 - 48, 500 - 136, 500 - 224; bottom = 800 - 650 + 8.
  await placementRows(VIEWPORT, [
    { mode: 'detailed', x: 500, left: 452 },
    { mode: 'standard', x: 500, left: 364 },
    { mode: 'light', x: 500, left: 276 },
  ], 'mid')
})

slideTest('SL-21 [BVA left edge] left = max(8, ...): formula 7 / 8 / 9 and far past the edge, each start index', async () => {
  await placementRows(VIEWPORT, [
    { mode: 'detailed', x: 55, left: 8 }, { mode: 'detailed', x: 56, left: 8 }, { mode: 'detailed', x: 57, left: 9 },
    { mode: 'standard', x: 143, left: 8 }, { mode: 'standard', x: 144, left: 8 }, { mode: 'standard', x: 145, left: 9 },
    { mode: 'light', x: 231, left: 8 }, { mode: 'light', x: 232, left: 8 }, { mode: 'light', x: 233, left: 9 },
    { mode: 'standard', x: 10, left: 8 }, { mode: 'light', x: 100, left: 8 },
  ], 'left edge')
})

slideTest('SL-22 [BVA right edge] left = min(..., innerWidth - 280): formula 719 / 720 / 721 and far past the edge, each start index', async () => {
  await placementRows(VIEWPORT, [
    { mode: 'detailed', x: 767, left: 719 }, { mode: 'detailed', x: 768, left: 720 }, { mode: 'detailed', x: 769, left: 720 },
    { mode: 'standard', x: 855, left: 719 }, { mode: 'standard', x: 856, left: 720 }, { mode: 'standard', x: 857, left: 720 },
    { mode: 'light', x: 943, left: 719 }, { mode: 'light', x: 944, left: 720 }, { mode: 'light', x: 945, left: 720 },
    { mode: 'detailed', x: 990, left: 720 },
  ], 'right edge')
})

slideTest('SL-23 [BVA narrow viewport] innerWidth 300 / 289 / 288 / 287 / 280 / 200: the right cap applies, then never below 8', async () => {
  const rows = [
    { width: 300, mode: 'standard', x: 150, left: 14 },
    { width: 289, mode: 'standard', x: 200, left: 9 },
    { width: 288, mode: 'standard', x: 200, left: 8 },
    { width: 287, mode: 'standard', x: 200, left: 8 },
    { width: 280, mode: 'standard', x: 140, left: 8 },
    { width: 200, mode: 'detailed', x: 10, left: 8 },
    { width: 200, mode: 'standard', x: 100, left: 8 },
    { width: 200, mode: 'light', x: 190, left: 8 },
  ]
  for (const row of rows) {
    await placementRows({ innerWidth: row.width, innerHeight: VIEWPORT.innerHeight }, [row], 'width ' + String(row.width))
  }
})

slideTest('SL-24 [EP star top] bottom = innerHeight - rect.top + 8; without getBoundingClientRect the press clientY; placement fixed while sliding', async () => {
  const tall = { innerWidth: 1000, innerHeight: 900 }
  const withRect = await starOn('standard', {}, { viewport: tall })
  await holdOpen(withRect.live, { x: 500, y: 660 })
  const placed = { left: 364, bottom: tall.innerHeight - STAR_TOP + SLIDE.gapPx, originX: 136 }
  assertPlacement(withRect.live, placed, 'rect top 650 (press clientY 660), innerHeight 900')
  for (const [dx, dy] of [[200, 0], [-200, -300], [44, 90]]) {
    await move(withRect.live, dx, dy)
    assertPlacement(withRect.live, placed, 'after moving to (' + String(dx) + ',' + String(dy) + ')')
  }

  const env = await boot({ form: fakeForm() })
  const noRect = await mountStar(env, { rect: false })
  await holdOpen(noRect, { x: 500, y: 700 })
  assertPlacement(noRect, { left: 364, bottom: 800 - 700 + 8, originX: 136 }, 'no rect, press clientY 700')
  await up(noRect)
  await holdOpen(noRect, { x: 500, y: 300 })
  assertPlacement(noRect, { left: 364, bottom: 800 - 300 + 8, originX: 136 }, 'no rect, press clientY 300')
})

// ================================================================ S4 selection

/** One hold-opened gesture from start; after each move the bar shows the expected selection. */
async function selectionWalk(start, steps, releaseWrites) {
  const { live, form } = await starOn(start)
  await holdOpen(live)
  assertOpen(live, start, start + ' at open')
  for (const [dx, selected] of steps) {
    await move(live, dx, 0)
    assertOpen(live, selected, start + ' dx ' + String(dx))
  }
  const [lastDx, lastSelected] = steps[steps.length - 1]
  await up(live, lastDx, 0)
  assertClosed(live, start + ' released')
  assertWrites(form, releaseWrites, start + ' released at dx ' + String(lastDx))
  assertShows(live, lastSelected, start + ' released at dx ' + String(lastDx))
}

slideTest('SL-30 [BVA selection from detailed] 43 / 44, 87 / 88, 131 / 132, 200, 1000 right; -44 / -200 clamp at detailed', async () => {
  await selectionWalk('detailed', [
    [0, 'detailed'], [43, 'detailed'], [44, 'standard'], [87, 'standard'], [88, 'standard'], [131, 'standard'],
    [132, 'light'], [200, 'light'], [1000, 'light'], [-44, 'detailed'], [-200, 'detailed'], [88, 'standard'],
  ], ['standard'])
})

slideTest('SL-31 [BVA selection from standard] ±43 / ±44 symmetric; ±131 / ±132 / ±200 clamp at the ends; back to 0', async () => {
  await selectionWalk('standard', [
    [43, 'standard'], [44, 'light'], [-43, 'standard'], [-44, 'detailed'], [131, 'light'], [-131, 'detailed'],
    [132, 'light'], [-132, 'detailed'], [200, 'light'], [-200, 'detailed'], [0, 'standard'],
  ], [])
})

slideTest('SL-32 [BVA selection from light] -43 / -44, -131 / -132, -200, -1000 left; 44 / 200 clamp at light', async () => {
  await selectionWalk('light', [
    [-43, 'light'], [-44, 'standard'], [-131, 'standard'], [-132, 'detailed'], [-200, 'detailed'],
    [44, 'light'], [200, 'light'], [-1000, 'detailed'],
  ], ['detailed'])
})

slideTest('SL-33 [EP vertical ignored once open] selection and release use dx only, whatever dy', async () => {
  const { live, form } = await starOn('standard')
  await holdOpen(live)
  const steps = [[88, -300, 'light'], [0, 500, 'standard'], [-88, 88, 'detailed'], [43, -43, 'standard'], [-50, -1000, 'detailed']]
  for (const [dx, dy, selected] of steps) {
    await move(live, dx, dy)
    assertOpen(live, selected, '(' + String(dx) + ',' + String(dy) + ')')
  }
  await up(live, -50, -1000)
  assertWrites(form, ['detailed'], 'released at (-50,-1000)')
  assertShows(live, 'detailed', 'released at (-50,-1000)')
})

slideTest('SL-34 [EP slide-opened selection] a bar opened by a slide selects by the same rule (from each start)', async () => {
  const rows = [
    { start: 'detailed', steps: [[16, 'detailed'], [44, 'standard'], [132, 'light']], writes: ['light'] },
    { start: 'standard', steps: [[-16, 'standard'], [-43, 'standard'], [-44, 'detailed']], writes: ['detailed'] },
    { start: 'light', steps: [[-20, 'light'], [-131, 'standard']], writes: ['standard'] },
  ]
  for (const row of rows) {
    const { live, form } = await starOn(row.start)
    await down(live)
    for (const [dx, selected] of row.steps) {
      await move(live, dx, 0)
      assertOpen(live, selected, row.start + ' slid to ' + String(dx))
    }
    await up(live, row.steps[row.steps.length - 1][0], 0)
    assertWrites(form, row.writes, row.start)
  }
})

// ================================================================ S5 release

slideTest('SL-40 [State release on another segment] exactly one write, the star shows it at once (write pending), bar closed, click swallowed', async () => {
  await withFetch(async (net) => {
    const { live, form } = await starOn('standard', { write: 'hold' })
    await holdOpen(live)
    await move(live, -88, 0)
    await up(live, -88, 0)
    assertClosed(live, 'released')
    assertWrites(form, ['detailed'], 'released on detailed')
    assertShows(live, 'detailed', 'while the write is pending')
    await click(live, MOUSE_CLICK)
    assert.equal(net.improves().length, 0, 'the click after the release does not improve')
    await act(() => { form.setValue(MODE_FIELD, 'detailed'); form.held[0].resolve(true) })
    await settle()
    assertShows(live, 'detailed', 'after the write landed')
    assertWrites(form, ['detailed'], 'still one write')
  })
})

slideTest('SL-41 [State release on the start segment] after wandering, a release back on the start: no write, bar closed, click swallowed', async () => {
  await withFetch(async (net) => {
    const { live, form } = await starOn('light')
    await holdOpen(live)
    await move(live, -100, 0)
    assertOpen(live, 'standard', 'wandered to standard')
    await move(live, -43, 0)
    await up(live, -43, 0)
    assertClosed(live, 'released')
    assertWrites(form, [], 'released on light')
    assertShows(live, 'light', 'released on light')
    await click(live, MOUSE_CLICK)
    assert.equal(net.improves().length, 0, 'the click after an opened bar does not improve')
  })
})

slideTest('SL-42 [BVA release-only travel] a pointerup with no pointermove: slide vs plain click by |dx| >= 16 and |dx| > |dy|; selection by distance', async () => {
  const rows = [
    { dx: 15, dy: 0, writes: [], improves: 1 },
    { dx: -15, dy: 0, writes: [], improves: 1 },
    { dx: 16, dy: 0, writes: [], improves: 0 },
    { dx: -16, dy: 0, writes: [], improves: 0 },
    { dx: 16, dy: 16, writes: [], improves: 1 },
    { dx: 16, dy: 15, writes: [], improves: 0 },
    { dx: 43, dy: 0, writes: [], improves: 0 },
    { dx: 44, dy: 43, writes: ['light'], improves: 0 },
    { dx: -44, dy: 44, writes: [], improves: 1 },
    { dx: -100, dy: 0, writes: ['detailed'], improves: 0 },
    { dx: 200, dy: -10, writes: ['light'], improves: 0 },
  ]
  for (const row of rows) {
    const name = 'standard, up at (' + String(row.dx) + ',' + String(row.dy) + ')'
    await withFetch(async (net) => {
      const { live, form } = await starOn('standard')
      await down(live)
      await up(live, row.dx, row.dy)
      assertClosed(live, name)
      assertWrites(form, row.writes, name)
      assertShows(live, row.writes[0] ?? 'standard', name)
      await click(live, MOUSE_CLICK)
      assert.equal(net.improves().length, row.improves, name + ': improves after the mouse click')
    })
  }
})

slideTest('SL-43 [EP keyboard click] a keyboard click (detail 0) improves after an opened release, a slide release and an Esc', async () => {
  const gestures = [
    { name: 'hold-opened, released on start', run: async (live) => { await holdOpen(live); await up(live) } },
    { name: 'slide release that wrote', run: async (live) => { await down(live); await move(live, 100, 0); await up(live, 100, 0) } },
    { name: 'escaped', run: async (live, env) => { await holdOpen(live); await escape(env); await up(live) } },
  ]
  for (const gesture of gestures) {
    await withFetch(async (net) => {
      const { live, env } = await starOn('standard')
      await gesture.run(live, env)
      await click(live, KEYBOARD_CLICK)
      assert.equal(net.improves().length, 1, gesture.name + ': the keyboard click improves')
    })
  }
})

slideTest('SL-44 [State click re-arm] after a swallowed click a new plain press re-arms the mouse click', async () => {
  await withFetch(async (net) => {
    const { live } = await starOn('standard')
    await holdOpen(live)
    await up(live)
    await click(live, MOUSE_CLICK)
    assert.equal(net.improves().length, 0, 'swallowed after the opened bar')
    await plainClick(live)
    assert.equal(net.improves().length, 1, 'a new plain press + click improves')
  })
})

// ================================================================ S6 plain click

slideTest('SL-50 [EP plain click] release at 299 ms with travel (0,0), 15 sideways or mostly vertical: no bar, no write, the click improves', async () => {
  for (const [dx, dy] of [[0, 0], [15, 0], [-15, 4], [10, 40]]) {
    const name = 'travel (' + String(dx) + ',' + String(dy) + ') at 299 ms'
    await withFetch(async (net) => {
      const { live, form } = await starOn('standard')
      await down(live)
      await move(live, dx, dy)
      await advance(SLIDE.holdMs - 1)
      assertClosed(live, name)
      await up(live, dx, dy)
      await advance(SLIDE.holdMs)
      assertClosed(live, name + ', after release')
      await click(live, MOUSE_CLICK)
      assert.equal(net.improves().length, 1, name + ': improves')
      assertWrites(form, [], name)
    })
  }
})

slideTest('SL-51 [State busy] a plain click while a refine runs cancels it and starts nothing new', async () => {
  await withFetch(async (net) => {
    const { live } = await starOn('standard')
    await plainClick(live)
    assert.equal(net.improves().length, 1, 'the first click starts a refine')
    assert.equal(net.improves()[0].signal?.aborted, false, 'in flight')
    // Pointer handlers while busy are not specified; press and release when they exist.
    await deliver(live, 'onPointerDown', 'pointerdown', pointerEvent(live, 'pointerdown', PRESS.x, PRESS.y), false)
    await deliver(live, 'onPointerUp', 'pointerup', pointerEvent(live, 'pointerup', PRESS.x, PRESS.y, { buttons: 0 }), false)
    await click(live, MOUSE_CLICK)
    assert.equal(net.improves().length, 1, 'nothing new starts')
    assert.equal(net.improves()[0].signal?.aborted, true, 'the refine is cancelled')
  }, { hold: true })
})

// ================================================================ decision table

/**
 * switchable x opened-by x release position x start mode.
 * open: 'hold' (300 ms, then move to dx), 'slide' (move to dx), 'release' (pointerup at dx only),
 * 'none' (short release). improves: the following mouse click's improve count (null = not
 * specified for a star that cannot switch).
 */
slideTest('SL-55 [Decision] switchable x opened-by x release position x start mode -> write, shown mode, click', async () => {
  const S = undefined
  const rows = [
    { start: 'standard', avail: S, open: 'hold', dx: 0, writes: [], improves: 0 },
    { start: 'standard', avail: S, open: 'hold', dx: 88, writes: ['light'], improves: 0 },
    { start: 'standard', avail: S, open: 'hold', dx: -88, writes: ['detailed'], improves: 0 },
    { start: 'detailed', avail: S, open: 'hold', dx: 176, writes: ['light'], improves: 0 },
    { start: 'light', avail: S, open: 'hold', dx: -176, writes: ['detailed'], improves: 0 },
    { start: 'light', avail: S, open: 'hold', dx: 88, writes: [], improves: 0 },
    { start: 'detailed', avail: S, open: 'hold', dx: -200, writes: [], improves: 0 },
    { start: 'detailed', avail: S, open: 'slide', dx: 20, writes: [], improves: 0 },
    { start: 'detailed', avail: S, open: 'slide', dx: 100, writes: ['standard'], improves: 0 },
    { start: 'light', avail: S, open: 'slide', dx: -100, writes: ['standard'], improves: 0 },
    { start: 'standard', avail: S, open: 'slide', dx: -300, writes: ['detailed'], improves: 0 },
    { start: 'standard', avail: S, open: 'release', dx: -100, writes: ['detailed'], improves: 0 },
    { start: 'standard', avail: S, open: 'release', dx: 20, writes: [], improves: 0 },
    { start: 'light', avail: S, open: 'release', dx: 44, writes: [], improves: 0 },
    { start: 'detailed', avail: S, open: 'release', dx: 132, writes: ['light'], improves: 0 },
    { start: 'standard', avail: S, open: 'none', dx: 10, writes: [], improves: 1 },
    { start: 'light', avail: S, open: 'none', dx: -15, writes: [], improves: 1 },
    { start: 'light', avail: NOT_SWITCHABLE[3], open: 'hold', dx: -88, writes: [], improves: null },
    { start: 'standard', avail: NOT_SWITCHABLE[0], open: 'slide', dx: -100, writes: [], improves: null },
    { start: 'standard', avail: NOT_SWITCHABLE[1], open: 'release', dx: 100, writes: [], improves: null },
    { start: 'standard', avail: NOT_SWITCHABLE[2], open: 'hold', dx: 88, writes: [], improves: null },
  ]
  for (const row of rows) {
    const switchable = row.avail === undefined
    const name = (switchable ? 'switchable ' + row.start : row.avail.name) + ', ' + row.open + ' to ' + String(row.dx)
    await withFetch(async (net) => {
      const form = switchable ? fakeForm({ value: { defaultMode: row.start } }) : row.avail.form === undefined ? undefined : fakeForm(row.avail.form)
      const live = await mountStar(await boot({ form }))
      await down(live)
      if (row.open === 'hold') await advance(SLIDE.holdMs)
      if (row.open === 'hold' || row.open === 'slide') {
        await move(live, row.dx, 0)
        if (switchable) assertOpen(live, row.writes[0] ?? row.start, name + ': open before the release')
        else assertClosed(live, name + ': never opens')
      }
      await up(live, row.dx, 0)
      assertClosed(live, name + ': after the release')
      if (form !== undefined) assertWrites(form, row.writes, name)
      assertShows(live, row.writes[0] ?? (switchable ? row.start : row.avail.shows), name)
      if (row.improves !== null) {
        await click(live, MOUSE_CLICK)
        assert.equal(net.improves().length, row.improves, name + ': improves after the mouse click')
      }
    })
  }
})

// ================================================================ S7 cancel

slideTest('SL-60 [State Esc] Esc closes the bar and writes nothing; the later release changes nothing and its click is swallowed', async () => {
  await withFetch(async (net) => {
    const { live, form, env } = await starOn('standard')
    await holdOpen(live)
    await move(live, -88, 0)
    assertOpen(live, 'detailed', 'detailed selected')
    await escape(env)
    assertClosed(live, 'after Esc')
    assertWrites(form, [], 'after Esc')
    await move(live, 88, 0)
    assertClosed(live, 'a move after Esc does not reopen')
    await up(live, 88, 0)
    assertClosed(live, 'released after Esc')
    assertWrites(form, [], 'released after Esc')
    assertShows(live, 'standard', 'released after Esc')
    await click(live, MOUSE_CLICK)
    assert.equal(net.improves().length, 0, 'the click after an escaped bar does not improve')
    await plainClick(live)
    assert.equal(net.improves().length, 1, 'the next plain press re-arms the click')
  })
})

slideTest('SL-61 [State Esc after a slide] Esc on a slide-opened bar: the release at the travelled point still writes nothing', async () => {
  await withFetch(async (net) => {
    const { live, form, env } = await starOn('standard')
    await down(live)
    await move(live, -100, 0)
    assertOpen(live, 'detailed', 'slid to detailed')
    await escape(env)
    assertClosed(live, 'after Esc')
    await up(live, -100, 0)
    assertWrites(form, [], 'released 100 px left after Esc')
    assertShows(live, 'standard', 'released 100 px left after Esc')
    await click(live, MOUSE_CLICK)
    assert.equal(net.improves().length, 0, 'its click is swallowed')
  })
})

slideTest('SL-62 [State pointercancel] pointercancel closes the bar and writes nothing; a stray pointerup neither; the next gesture works', async () => {
  for (const opener of ['hold', 'slide']) {
    const { live, form } = await starOn('standard')
    await down(live)
    if (opener === 'hold') await advance(SLIDE.holdMs)
    await move(live, 88, 0)
    assertOpen(live, 'light', opener + ': light selected')
    await cancel(live, 88, 0)
    assertClosed(live, opener + ': after pointercancel')
    assertWrites(form, [], opener + ': after pointercancel')
    await up(live, 88, 0)
    assertWrites(form, [], opener + ': a stray pointerup after the cancel')
    assertShows(live, 'standard', opener + ': after the cancel')
    await holdOpen(live)
    await move(live, -88, 0)
    await up(live, -88, 0)
    assertWrites(form, ['detailed'], opener + ': the next gesture')
  }
})

slideTest('SL-63 [State keydown listener] a window keydown listener exists while open and is removed after release, Esc and pointercancel', async () => {
  const closers = [
    { name: 'release', close: (live) => up(live) },
    { name: 'Esc', close: (live, env) => escape(env) },
    { name: 'pointercancel', close: (live) => cancel(live) },
  ]
  for (const closer of closers) {
    const { live, env } = await starOn('standard')
    const baseline = env.count('keydown')
    await holdOpen(live)
    assertOpen(live, 'standard', closer.name + ': open')
    assert.ok(env.count('keydown') > baseline, closer.name + ': a keydown listener is registered while open')
    await closer.close(live, env)
    assertClosed(live, closer.name + ': closed')
    assert.equal(env.count('keydown'), baseline, closer.name + ': the keydown listener is removed')
  }
})

// ================================================================ S8 pointer capture, S9 context menu

slideTest('SL-65 [State capture] setPointerCapture(pointerId) on the pressed element when the bar opens (hold or slide), never at press', async () => {
  const id = 7
  const held = await starOn('standard')
  await down(held.live, { pointerId: id })
  assert.deepEqual(held.live.captures, [], 'hold: nothing captured at press')
  await advance(SLIDE.holdMs - 1)
  assert.deepEqual(held.live.captures, [], 'hold: nothing captured at 299 ms')
  await advance(1)
  assertOpen(held.live, 'standard', 'hold: open')
  assert.deepEqual(held.live.captures, [id], 'hold: captured on open')

  const slid = await starOn('standard')
  await down(slid.live, { pointerId: id })
  await move(slid.live, 15, 0, { pointerId: id })
  assert.deepEqual(slid.live.captures, [], 'slide: nothing captured below the threshold')
  await move(slid.live, 16, 0, { pointerId: id })
  assertOpen(slid.live, 'standard', 'slide: open')
  assert.deepEqual(slid.live.captures, [id], 'slide: captured on open')

  const clicked = await starOn('standard')
  await down(clicked.live, { pointerId: id })
  assert.deepEqual(clicked.live.captures, [], 'plain click: nothing captured at press')
  await up(clicked.live, 0, 0, { pointerId: id })
  assert.deepEqual(clicked.live.captures, [], 'plain click: nothing captured at release')
})

slideTest('SL-66 [State context menu] onContextMenu prevents the default while a press is down (before and after the bar opens), not otherwise', async () => {
  const { live } = await starOn('standard')
  const contextMenu = () => {
    let prevented = 0
    const event = { type: 'contextmenu', button: 2, clientX: PRESS.x, clientY: PRESS.y, currentTarget: live.el, target: live.el, preventDefault: () => { prevented += 1 }, stopPropagation() {} }
    const fn = live.root().props.onContextMenu
    if (typeof fn === 'function') fn(event)
    return prevented > 0
  }
  assert.equal(contextMenu(), false, 'no press: not prevented')
  await down(live)
  assert.equal(contextMenu(), true, 'pressed: prevented')
  await advance(SLIDE.holdMs)
  assertOpen(live, 'standard', 'open')
  assert.equal(contextMenu(), true, 'bar open: prevented')
  await up(live)
  assert.equal(contextMenu(), false, 'released: not prevented')
})

// ================================================================ state transitions across gestures

slideTest('SL-70 [State consecutive] each gesture starts from the mode the previous one saved (selection and placement)', async () => {
  await withFetch(async (net) => {
    const { live, form, env } = await starOn('standard')
    await holdOpen(live)
    await move(live, -88, 0)
    await up(live, -88, 0)
    assertShows(live, 'detailed', 'first gesture')
    await holdOpen(live)
    assertOpen(live, 'detailed', 'second gesture starts on detailed')
    assertPlacement(live, { left: 452, bottom: 800 - STAR_TOP + 8, originX: 48 }, 'second gesture placed for start index 0')
    await move(live, 176, 0)
    await up(live, 176, 0)
    assertShows(live, 'light', 'second gesture')
    await holdOpen(live)
    assertOpen(live, 'light', 'third gesture starts on light')
    await escape(env)
    await up(live)
    assertWrites(form, ['detailed', 'light'], 'two writes, the escaped gesture none')
    await plainClick(live)
    assert.equal(net.improves().length, 1, 'then a plain click improves')
  })
})

slideTest('SL-71 [State pending write] a press while a write is pending starts from the pending mode', async () => {
  const { live, form } = await starOn('detailed', { write: 'hold' })
  await holdOpen(live)
  await move(live, 88, 0)
  await up(live, 88, 0)
  assertShows(live, 'standard', 'first write pending')
  await holdOpen(live)
  assertOpen(live, 'standard', 'second press starts on the pending standard')
  assertPlacement(live, { left: 364, bottom: 800 - STAR_TOP + 8, originX: 136 }, 'placed for start index 1')
  await move(live, 88, 0)
  assertOpen(live, 'light', 'one segment right of the pending mode')
  await up(live, 88, 0)
  assertWrites(form, ['standard', 'light'], 'two writes')
  assertShows(live, 'light', 'second write pending')
  await act(() => { form.setValue(MODE_FIELD, 'light'); for (const w of form.held) w.resolve(true) })
  await settle()
  assertShows(live, 'light', 'both writes landed')
})

slideTest('SL-72 [State write fails] a write resolving false or rejecting reverts the star; the next bar starts from the snapshot mode', async () => {
  for (const write of ['false', 'reject']) {
    const { live, form } = await starOn('standard', { write })
    await holdOpen(live)
    await move(live, -88, 0)
    await up(live, -88, 0)
    assertWrites(form, ['detailed'], write)
    assertShows(live, 'standard', write + ': back to the snapshot')
    await holdOpen(live)
    assertOpen(live, 'standard', write + ': the next bar starts on standard')
    await up(live)
  }
})

// ================================================================ S10 still true

slideTest('SL-80 [EP copy] the star title second line mentions holding: zh 按住, en hold', async () => {
  for (const lang of ['zh', 'en']) {
    const { live } = await starOn('standard', {}, { lang })
    const title = live.star().props.title
    assert.equal(typeof title, 'string', lang + ': the star has a title')
    const lines = title.split('\n')
    assert.ok(lines.length >= 2, lang + ': the title has a second line: ' + JSON.stringify(title))
    assert.ok(MENTIONS_HOLD[lang](lines[1]), lang + ': the second line mentions holding: ' + JSON.stringify(lines[1]))
  }
})

slideTest('SL-81 [State onboarding] the first-use window still opens with the star and its text mentions holding (zh, en)', async () => {
  for (const lang of ['zh', 'en']) {
    const env = await boot({ form: fakeForm(), lang })
    const overlays = await mountOverlays(env)
    assert.equal(overlays.dialogs().length, 0, lang + ': not before the star')
    await mountStar(env)
    await settle()
    const dialogs = overlays.dialogs()
    assert.equal(dialogs.length, 1, lang + ': one onboarding window')
    assert.ok(MENTIONS_HOLD[lang](textOf(dialogs[0])), lang + ': the onboarding text mentions holding')
  }
})

slideTest('SL-82 [State capsule] after a refine the Revert | Retry capsule has no data-mode and never shows the bar', async () => {
  await withFetch(async (net) => {
    const { live, form } = await starOn('standard')
    await plainClick(live)
    assert.equal(net.improves().length, 1, 'the click improves')
    await live.rerender()
    assert.equal(live.draft, REFINED, 'the draft was refined')
    assert.equal(byClass(live.renderer.root, CLS.revert).length, 1, 'the capsule shows Revert')
    assert.equal(byClass(live.renderer.root, CLS.star).length, 0, 'the star is replaced')
    const withMode = live.renderer.root.findAll((n) => typeof n.type === 'string' && n.props['data-mode'] !== undefined)
    assert.equal(withMode.length, 0, 'no element of the capsule carries data-mode')
    const root = live.root()
    if (root !== undefined && typeof root.props.onPointerDown === 'function') {
      await down(live)
      await advance(SLIDE.holdMs)
      await move(live, -100, 0)
      assertClosed(live, 'hold + slide on the capsule')
      await up(live, -100, 0)
    }
    assertClosed(live, 'capsule')
    assertWrites(form, [], 'capsule')
  })
})
