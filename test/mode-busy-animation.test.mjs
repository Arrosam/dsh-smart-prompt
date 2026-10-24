// Running animation per mode on the composer star (R1..R7). Black-box, system level: the BUILT
// client bundle (lib/client.js) is booted through its public apply(ctx) against a fake host
// (slots, locale, ctx.inject serving a fake configForms) and rendered with react-test-renderer.
// A fake document captures the injected <style> text, which is parsed into rules, @keyframes and
// @media blocks. A tiny matcher (compound selectors of tag / .class / [attr="v"] with descendant
// and child combinators) evaluates the rules naming a running keyframe against the rendered tree,
// so "which animation runs" is observed on the real markup, not on CSS text alone.
// Busy = an /improve request is in flight after a plain click on the star (fetch held pending).
//
// Techniques:
//  - EP: mode (detailed / standard / light) x busy state (idle / busy); glyph location (star /
//    mode bar segment / first-use window row).
//  - Decision table: mode x busy -> set of running keyframes matched on the rendered star.
//  - State transition: idle -> busy -> done (success) | done (error) | cancelled (click while
//    busy); idle mode switch (hold + slide) -> busy in the new mode.
//
// Cases:
//  BA-01 R1 a busy-scoped rule spins only .dip-icon[data-mode="standard"] with dip-icon-spin
//  BA-02 R1 no rule applies dip-icon-spin to the detailed / light icon or the pen / ink parts
//  BA-03 R2 detailed star svg: g.dip-glyph-pen, path.dip-glyph-ink pathLength 1, plain page path(s)
//  BA-04 R2 busy-scoped .dip-glyph-pen dip-pen-write and .dip-glyph-ink dip-ink-draw, same duration, infinite
//  BA-05 R2 @keyframes dip-pen-write uses translate; @keyframes dip-ink-draw uses stroke-dashoffset
//  BA-06 R3 busy-scoped .dip-icon[data-mode="light"] dip-bolt-strike infinite; keyframes change opacity and scale
//  BA-07 R4 the three running keyframes differ pairwise; every selector naming them has [data-busy="true"]
//  BA-08 R6 prefers-reduced-motion lists .dip-icon, .dip-glyph-pen, .dip-glyph-ink with animation:none
//  BA-09 Decision mode x busy -> running keyframes matched on the rendered star (6 rules)
//  BA-10 State idle -> busy -> cancelled per mode: data-busy flips, svg data-mode stays the mode
//  BA-11 State idle -> busy -> done (success) per mode: busy while pending, nothing busy afterwards
//  BA-12 State idle -> busy -> done (error) per mode: the star is back idle in the same mode
//  BA-13 State idle mode switch (hold + slide) then a rewrite runs the new mode's animation only
//  BA-14 R7 mode bar segment glyphs: same structure as the star glyph, no busy state
//  BA-15 R7 first-use window row glyphs: same structure as the star glyph, no busy state
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
const SLIDE = Object.freeze({ holdMs: 300, segmentPx: 88 })
const CLS = { root: 'dip-root', star: 'dip-btn', icon: 'dip-icon', bar: 'dip-slide', seg: 'dip-slide-seg', onboard: 'dip-onboard', pen: 'dip-glyph-pen', ink: 'dip-glyph-ink' }
const BUSY_SEL = '[data-busy="true"]'
const KF = { spin: 'dip-icon-spin', pen: 'dip-pen-write', ink: 'dip-ink-draw', bolt: 'dip-bolt-strike' }
const RUNNING = [KF.pen, KF.ink, KF.bolt]
/** Decision table: the keyframes running on the star per mode while busy; none while idle. */
const RUNS_WHEN_BUSY = { standard: [KF.spin], detailed: [KF.ink, KF.pen], light: [KF.bolt] }
const VIEWPORT = { innerWidth: 1000, innerHeight: 800 }
const PRESS = { x: 500, y: 700 }
const STAR_TOP = 650
const STAR_SIZE = 32
const PRESSED_ID = 1
const MOUSE_CLICK = 1
const ESCAPE = 'Escape'
const DRAFT = '把那个接口加上限流'
const REFINED = '为登录接口增加按 IP 的限流，每分钟 60 次。'
const META = { mode: 'standard', model: 'p/m', ratio: 1.4, ratioLabel: '1.4x', elapsedMs: 2100, anchors: { total: 0, kept: 0, reinjected: 0 }, note: '', contextUsed: 'none' }
const IMPROVE_URL = '/dsh-smart-prompt/api/improve'
const HINT_KEY = { detailed: 'modeDetailedHint', standard: 'modeStandardHint', light: 'modeLightHint' }

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
  await import('../lib/client.js?busyanim=' + String(Date.now()) + Math.random())
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

// ---------------------------------------------------------------- network

/**
 * fetch stub: every /improve stays pending until settled via net.finish(i, reply) or aborted by
 * its AbortSignal (then rejects with AbortError, as a browser does).
 */
function stubFetch() {
  const sent = []
  const original = globalThis.fetch
  globalThis.fetch = (url, init = {}) => {
    const entry = { url: String(url), signal: init.signal }
    sent.push(entry)
    if (entry.url !== IMPROVE_URL) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
    return new Promise((resolve, reject) => {
      entry.resolve = resolve
      init.signal?.addEventListener?.('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })), { once: true })
    })
  }
  const improves = () => sent.filter((s) => s.url === IMPROVE_URL)
  return {
    improves,
    finish: (i, body) => act(async () => { improves()[i].resolve({ ok: true, status: 200, json: async () => body }) }).then(settle),
    restore: () => { globalThis.fetch = original },
  }
}

async function withFetch(fn) {
  const net = stubFetch()
  try { return await fn(net) } finally { net.restore() }
}

const SUCCESS = { ok: true, text: REFINED, meta: META }
const FAILURE = { ok: false, code: 'UPSTREAM_X', message: 'gateway exploded' }

// ---------------------------------------------------------------- stylesheet

/** The injected stylesheet text: every element appended to document.head with text. */
function injectedCss() {
  const css = globalThis.document.head.children.map((n) => n.textContent ?? '').join('\n')
  assert.ok(css.length > 0, 'the plugin injected a <style> into document.head')
  return css
}

/** Top-level blocks of a stylesheet: { prelude, body } with brace matching. */
function blocks(text) {
  const out = []
  let depth = 0
  let start = 0
  let open = -1
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') { if (depth === 0) open = i; depth += 1 }
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) { out.push({ prelude: text.slice(start, open).trim(), body: text.slice(open + 1, i) }); start = i + 1 }
    }
  }
  return out
}

/** Parsed sheet: style rules (selectors + declarations, incl. those inside @media), keyframes, media. */
function parseCss(css) {
  const rules = []
  const keyframes = {}
  const media = []
  const addRules = (list, where) => {
    for (const b of list) {
      if (b.prelude.startsWith('@keyframes')) keyframes[b.prelude.replace('@keyframes', '').trim()] = b.body
      else if (b.prelude.startsWith('@media')) { media.push({ query: b.prelude, rules: blocks(b.body).map(toRule) }); addRules(blocks(b.body), b.prelude) }
      else if (!b.prelude.startsWith('@')) rules.push({ ...toRule(b), where })
    }
  }
  addRules(blocks(css), null)
  return { rules, keyframes, media }
}

function toRule(b) {
  return { selectors: b.prelude.split(',').map((s) => s.trim()).filter(Boolean), decls: b.body, animation: (/(?:^|;)\s*animation(?:-name)?\s*:\s*([^;]*)/.exec(b.body) ?? [])[1]?.trim() ?? null }
}

const namesKeyframes = (rule, name) => rule.animation !== null && new RegExp('(^|[\\s,])' + name + '($|[\\s,])').test(rule.animation)
const rulesNaming = (sheet, name) => sheet.rules.filter((r) => r.where === null && namesKeyframes(r, name))
const durationOf = (animation) => (/(^|\s)(\d*\.?\d+m?s)(\s|$)/.exec(animation) ?? [])[2] ?? null
const toMs = (d) => (d.endsWith('ms') ? Number(d.slice(0, -2)) : Number(d.slice(0, -1)) * 1000)

/** The sheet of a freshly booted bundle. */
async function sheet() {
  await boot({ form: fakeForm() })
  return parseCss(injectedCss())
}

// ---------------------------------------------------------------- selector matcher

/** Parse one compound selector: tag?, .class*, [attr="v"]*. Returns null when unsupported. */
function parseCompound(text) {
  const re = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/
  const m = re.exec(text)
  if (m === null) return null
  const classes = [...m[2].matchAll(/\.([\w-]+)/g)].map((x) => x[1])
  const attrs = [...m[2].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((x) => ({ name: x[1], value: x[2] }))
  return { tag: m[1] ?? null, classes, attrs }
}

/** Parse a selector into [{ combinator, compound }] (descendant ' ' and child '>'). */
function parseSelector(sel) {
  const tokens = sel.replace(/\s*>\s*/g, ' > ').split(/\s+/)
  const parts = []
  let combinator = ' '
  for (const tok of tokens) {
    if (tok === '>') { combinator = '>'; continue }
    const compound = parseCompound(tok)
    if (compound === null) return null
    parts.push({ combinator, compound })
    combinator = ' '
  }
  return parts
}

const matchesCompound = (node, c) => typeof node.type === 'string'
  && (c.tag === null || node.type === c.tag)
  && c.classes.every((cls) => hasClass(node, cls))
  && c.attrs.every((a) => (a.value === undefined ? node.props[a.name] !== undefined : String(node.props[a.name]) === a.value))

/** Host-element parent in the test renderer tree. */
function hostParent(node) {
  let p = node.parent
  while (p !== null && typeof p.type !== 'string') p = p.parent
  return p
}

function matchesFrom(node, parts, index) {
  if (!matchesCompound(node, parts[index].compound)) return false
  if (index === 0) return true
  const viaChild = parts[index].combinator === '>'
  for (let p = hostParent(node); p !== null; p = hostParent(p)) {
    if (matchesFrom(p, parts, index - 1)) return true
    if (viaChild) return false
  }
  return false
}

/** Every host element of the tree that the selector matches. */
function matching(root, sel) {
  const parts = parseSelector(sel)
  assert.ok(parts !== null && parts.length > 0, 'selector understood by the test matcher: ' + sel)
  return root.findAll((n) => typeof n.type === 'string' && matchesFrom(n, parts, parts.length - 1))
}

/** The running keyframes (spin + the three) whose rules match some element of the tree. */
function runningOn(root, parsed) {
  const names = [KF.spin, ...RUNNING]
  return names.filter((name) => rulesNaming(parsed, name).some((r) => r.selectors.some((s) => matching(root, s).length > 0))).sort()
}

// ---------------------------------------------------------------- star helpers

const busyOf = (live) => live.root()?.props['data-busy']
const anyBusy = (live) => live.renderer.root.findAll((n) => typeof n.type === 'string' && n.props['data-busy'] === 'true').length > 0

function assertShows(live, mode, message) {
  assert.ok(live.root() !== undefined && live.star() !== undefined, message + ': the star is rendered')
  assert.equal(live.root().props['data-mode'], mode, message + ': div.dip-root data-mode')
  assert.equal(live.icon()?.props['data-mode'], mode, message + ': svg.dip-icon data-mode')
}

async function starOn(mode) {
  const form = fakeForm({ value: { defaultMode: mode } })
  const env = await boot({ form })
  return { form, env, live: await mountStar(env) }
}

/** Structure of a glyph svg: element type, class, pathLength, d, transform of every descendant. */
const structure = (svg) => JSON.stringify(svg.findAll((n) => typeof n.type === 'string' && n !== svg)
  .map((n) => [n.type, n.props.className ?? null, n.props.pathLength ?? null, n.props.d ?? null, n.props.transform ?? null]))

/** R2 structure of a detailed glyph svg. */
function assertDetailedGlyph(svg, message) {
  assert.equal(svg.type, 'svg', message + ': an svg')
  assert.equal(svg.props['data-mode'], 'detailed', message + ': data-mode detailed')
  const pens = byClass(svg, CLS.pen)
  assert.equal(pens.length, 1, message + ': one .dip-glyph-pen')
  assert.equal(pens[0].type, 'g', message + ': .dip-glyph-pen is a <g>')
  assert.ok(pens[0].findAll((n) => n.type === 'path').length >= 1, message + ': the pen group draws a path')
  const inks = byClass(svg, CLS.ink)
  assert.equal(inks.length, 1, message + ': one .dip-glyph-ink')
  assert.equal(inks[0].type, 'path', message + ': .dip-glyph-ink is a <path>')
  assert.equal(String(inks[0].props.pathLength), '1', message + ': ink pathLength 1')
  const inPen = new Set(pens[0].findAll((n) => n.type === 'path'))
  const page = svg.findAll((n) => n.type === 'path' && !inPen.has(n) && !hasClass(n, CLS.ink) && !hasClass(n, CLS.pen))
  assert.ok(page.length >= 1, message + ': the page is drawn by other path(s) without those classes')
}

/** A star in mode, a plain click starts a rewrite that stays pending. */
async function busyStar(net, mode) {
  const s = await starOn(mode)
  assertShows(s.live, mode, mode + ' idle')
  assert.equal(busyOf(s.live), 'false', mode + ': idle data-busy false')
  await plainClick(s.live)
  assert.equal(net.improves().length, 1, mode + ': the click starts a rewrite')
  return s
}

// ================================================================ stylesheet (R1..R6)

slideTest('BA-01 [EP standard x busy] a [data-busy="true"]-scoped rule spins .dip-icon[data-mode="standard"] with dip-icon-spin', async () => {
  const parsed = await sheet()
  const hits = rulesNaming(parsed, KF.spin).flatMap((r) => r.selectors).filter((s) => s.includes(BUSY_SEL) && s.includes('.dip-icon[data-mode="standard"]'))
  assert.ok(hits.length >= 1, 'a busy rule spins the standard icon; selectors naming spin: ' + JSON.stringify(rulesNaming(parsed, KF.spin).flatMap((r) => r.selectors)))
  assert.ok(parsed.keyframes[KF.spin] !== undefined, '@keyframes dip-icon-spin exists')
})

slideTest('BA-02 [EP detailed / light x busy] no rule applies dip-icon-spin to the detailed or light icon or the pen / ink parts', async () => {
  const parsed = await sheet()
  for (const sel of rulesNaming(parsed, KF.spin).flatMap((r) => r.selectors)) {
    if (sel.includes('.dip-icon')) assert.ok(sel.includes('.dip-icon[data-mode="standard"]'), 'a spin rule targeting .dip-icon is limited to standard: ' + sel)
    assert.ok(!/data-mode="(detailed|light)"/.test(sel), 'spin never names detailed / light: ' + sel)
    assert.ok(!sel.includes(CLS.pen) && !sel.includes(CLS.ink) && !/\bsvg\b/.test(sel), 'spin never targets the glyph parts or bare svg: ' + sel)
  }
})

slideTest('BA-03 [EP detailed structure] the detailed star svg: g.dip-glyph-pen, path.dip-glyph-ink pathLength 1, and plain page path(s)', async () => {
  const { live } = await starOn('detailed')
  assertShows(live, 'detailed', 'detailed')
  assertDetailedGlyph(live.icon(), 'star')
  for (const mode of ['standard', 'light']) {
    const other = await starOn(mode)
    assert.equal(byClass(other.live.icon(), CLS.pen).length + byClass(other.live.icon(), CLS.ink).length, 0, mode + ' glyph has no pen / ink parts')
  }
})

slideTest('BA-04 [EP detailed x busy] busy-scoped .dip-glyph-pen dip-pen-write and .dip-glyph-ink dip-ink-draw: same duration, infinite', async () => {
  const parsed = await sheet()
  const pen = rulesNaming(parsed, KF.pen).filter((r) => r.selectors.some((s) => s.includes(BUSY_SEL) && s.includes('.' + CLS.pen)))
  const ink = rulesNaming(parsed, KF.ink).filter((r) => r.selectors.some((s) => s.includes(BUSY_SEL) && s.includes('.' + CLS.ink)))
  assert.equal(pen.length >= 1, true, 'a busy rule animates .dip-glyph-pen with dip-pen-write')
  assert.equal(ink.length >= 1, true, 'a busy rule animates .dip-glyph-ink with dip-ink-draw')
  for (const [name, r] of [['pen', pen[0]], ['ink', ink[0]]]) assert.match(r.animation, /(^|\s)infinite(\s|$)/, name + ' is infinite: ' + r.animation)
  const dp = durationOf(pen[0].animation)
  const di = durationOf(ink[0].animation)
  assert.ok(dp !== null && di !== null, 'both declare a duration: ' + pen[0].animation + ' | ' + ink[0].animation)
  assert.equal(toMs(dp), toMs(di), 'pen and ink share a duration')
})

slideTest('BA-05 [EP keyframes] @keyframes dip-pen-write uses translate; @keyframes dip-ink-draw uses stroke-dashoffset', async () => {
  const parsed = await sheet()
  assert.ok(parsed.keyframes[KF.pen] !== undefined, '@keyframes dip-pen-write exists')
  assert.match(parsed.keyframes[KF.pen], /translate/, 'dip-pen-write uses translate')
  assert.ok(parsed.keyframes[KF.ink] !== undefined, '@keyframes dip-ink-draw exists')
  assert.match(parsed.keyframes[KF.ink], /stroke-dashoffset/, 'dip-ink-draw uses stroke-dashoffset')
})

slideTest('BA-06 [EP light x busy] busy-scoped .dip-icon[data-mode="light"] dip-bolt-strike infinite; keyframes change opacity and scale', async () => {
  const parsed = await sheet()
  const bolt = rulesNaming(parsed, KF.bolt).filter((r) => r.selectors.some((s) => s.includes(BUSY_SEL) && s.includes('.dip-icon[data-mode="light"]')))
  assert.ok(bolt.length >= 1, 'a busy rule animates the light icon with dip-bolt-strike')
  assert.match(bolt[0].animation, /(^|\s)infinite(\s|$)/, 'infinite: ' + bolt[0].animation)
  const kf = parsed.keyframes[KF.bolt]
  assert.ok(kf !== undefined, '@keyframes dip-bolt-strike exists')
  assert.match(kf, /opacity\s*:/, 'changes opacity')
  assert.match(kf, /scale/, 'changes scale')
})

slideTest('BA-07 [R4] the three running keyframes differ pairwise; every selector naming them contains [data-busy="true"]', async () => {
  const parsed = await sheet()
  assert.equal(new Set(RUNNING).size, 3, 'pen / ink / bolt names differ')
  assert.ok(!RUNNING.includes(KF.spin), 'none of them is the spin')
  for (const name of RUNNING) {
    const sels = rulesNaming(parsed, name).flatMap((r) => r.selectors)
    assert.ok(sels.length >= 1, name + ' is used')
    for (const s of sels) assert.ok(s.includes(BUSY_SEL), name + ' only while busy: ' + s)
    // the shorthand of the rule naming one running keyframe names no other
    for (const r of rulesNaming(parsed, name)) for (const other of RUNNING.filter((o) => o !== name)) assert.ok(!namesKeyframes(r, other), name + ' rule does not also run ' + other)
  }
})

slideTest('BA-08 [R6] prefers-reduced-motion lists .dip-icon, .dip-glyph-pen, .dip-glyph-ink with animation:none', async () => {
  const parsed = await sheet()
  const reduced = parsed.media.filter((m) => /prefers-reduced-motion:\s*reduce/.test(m.query))
  assert.ok(reduced.length >= 1, 'a prefers-reduced-motion: reduce block exists')
  const none = reduced.flatMap((m) => m.rules).filter((r) => /(^|;)\s*animation\s*:\s*none/.test(r.decls))
  const listed = new Set(none.flatMap((r) => r.selectors))
  for (const sel of ['.dip-icon', '.dip-glyph-pen', '.dip-glyph-ink']) assert.ok(listed.has(sel), sel + ' has animation:none under reduced motion; listed: ' + JSON.stringify([...listed]))
})

// ================================================================ rendered behaviour (R1..R5)

slideTest('BA-09 [Decision mode x busy] the running keyframes matched on the rendered star: none idle; spin / pen+ink / bolt busy', async () => {
  await withFetch(async (net) => {
    for (const mode of MODES) {
      const before = net.improves().length
      const { live } = await starOn(mode)
      const parsed = parseCss(injectedCss())
      assert.deepEqual(runningOn(live.renderer.root, parsed), [], mode + ' x idle: nothing runs')
      await plainClick(live)
      assert.equal(net.improves().length, before + 1, mode + ': rewrite started')
      assert.equal(busyOf(live), 'true', mode + ' x busy: data-busy true')
      assert.deepEqual(runningOn(live.renderer.root, parsed), [...RUNS_WHEN_BUSY[mode]].sort(), mode + ' x busy: running keyframes')
      if (mode === 'detailed') {
        assert.ok(matching(live.renderer.root, rulesNaming(parsed, KF.pen).flatMap((r) => r.selectors)[0]).every((n) => hasClass(n, CLS.pen)), 'pen-write lands on the pen group')
        assert.ok(matching(live.renderer.root, rulesNaming(parsed, KF.ink).flatMap((r) => r.selectors)[0]).every((n) => hasClass(n, CLS.ink)), 'ink-draw lands on the ink path')
      }
      await click(live, MOUSE_CLICK) // cancel, leave idle
      assert.deepEqual(runningOn(live.renderer.root, parsed), [], mode + ' x idle after cancel: nothing runs')
    }
  })
})

slideTest('BA-10 [State idle->busy->cancelled] per mode: data-busy true then false on a click while busy; svg data-mode stays the mode', async () => {
  await withFetch(async (net) => {
    for (const mode of MODES) {
      const before = net.improves().length
      const { live } = await starOn(mode)
      await plainClick(live)
      assert.equal(busyOf(live), 'true', mode + ': busy')
      assertShows(live, mode, mode + ' busy')
      await click(live, MOUSE_CLICK)
      assert.equal(net.improves().length, before + 1, mode + ': cancel starts nothing new')
      assert.equal(net.improves()[before].signal?.aborted, true, mode + ': the request is aborted')
      assert.equal(busyOf(live), 'false', mode + ': idle after cancel')
      assertShows(live, mode, mode + ' after cancel')
      assert.equal(live.draft, DRAFT, mode + ': draft untouched')
    }
  })
})

slideTest('BA-11 [State idle->busy->done success] per mode: busy while pending, then no element is busy', async () => {
  await withFetch(async (net) => {
    for (const mode of MODES) {
      const before = net.improves().length
      const { live } = await starOn(mode)
      await plainClick(live)
      assert.equal(busyOf(live), 'true', mode + ': busy while pending')
      assertShows(live, mode, mode + ' busy')
      await net.finish(before, { ...SUCCESS, meta: { ...META, mode } })
      await live.rerender()
      assert.equal(live.draft, REFINED, mode + ': refined')
      assert.equal(anyBusy(live), false, mode + ': nothing busy after completion')
      // On success the star gives way to the Revert | Retry capsule (no star, no data-busy); when the star is shown it is idle.
      if (live.star() !== undefined) assert.equal(busyOf(live), 'false', mode + ': the star dip-root data-busy false')
    }
  })
})

slideTest('BA-12 [State idle->busy->done error] per mode: the star is back with data-busy false and the same mode', async () => {
  await withFetch(async (net) => {
    for (const mode of MODES) {
      const before = net.improves().length
      const { live } = await starOn(mode)
      await plainClick(live)
      assert.equal(busyOf(live), 'true', mode + ': busy while pending')
      await net.finish(before, FAILURE)
      await live.rerender()
      assert.equal(busyOf(live), 'false', mode + ': idle after a failed rewrite')
      assertShows(live, mode, mode + ' after error')
    }
  })
})

slideTest('BA-13 [State idle switch -> busy] after a hold + slide switch while idle, a rewrite runs the new mode animation only', async () => {
  await withFetch(async (net) => {
    for (const [start, dx, target] of [['standard', SLIDE.segmentPx, 'light'], ['standard', -SLIDE.segmentPx, 'detailed'], ['light', -2 * SLIDE.segmentPx, 'detailed'], ['detailed', SLIDE.segmentPx, 'standard']]) {
      const { live, form } = await starOn(start)
      const parsed = parseCss(injectedCss())
      await down(live)
      await advance(SLIDE.holdMs)
      await move(live, dx, 0)
      await up(live, dx, 0)
      await click(live, MOUSE_CLICK) // the click ending the gesture is swallowed
      assert.deepEqual(form.sets, [[MODE_FIELD, target]], start + '->' + target + ': one write')
      assertShows(live, target, start + '->' + target + ' idle')
      assert.equal(busyOf(live), 'false', 'idle after the switch')
      const before = net.improves().length
      await plainClick(live)
      assert.equal(net.improves().length, before + 1, start + '->' + target + ': rewrite started')
      assert.equal(busyOf(live), 'true', 'busy')
      assertShows(live, target, start + '->' + target + ' busy')
      assert.deepEqual(runningOn(live.renderer.root, parsed), [...RUNS_WHEN_BUSY[target]].sort(), start + '->' + target + ': runs the ' + target + ' animation')
      await click(live, MOUSE_CLICK)
      assert.equal(busyOf(live), 'false', 'cancelled')
      assertShows(live, target, start + '->' + target + ' after cancel')
    }
  })
})

// ================================================================ other glyph locations (R7)

slideTest('BA-14 [EP mode bar] segment glyphs have the star glyph structure (detailed: pen / ink / page) and no busy state', async () => {
  const star = {}
  for (const mode of MODES) star[mode] = structure((await starOn(mode)).live.icon())
  const { live } = await starOn('standard')
  await down(live)
  await advance(SLIDE.holdMs)
  const bar = byClass(live.renderer.root, CLS.bar)
  assert.equal(bar.length, 1, 'the bar is open')
  const segs = byClass(bar[0], CLS.seg)
  assert.deepEqual(segs.map((s) => s.props['data-mode']), MODES, 'three segments')
  for (const seg of segs) {
    const mode = seg.props['data-mode']
    const svg = seg.findAll((n) => n.type === 'svg')[0]
    assert.ok(svg !== undefined, mode + ' segment svg')
    assert.equal(structure(svg), star[mode], mode + ' segment glyph has the star structure')
    if (mode === 'detailed') assertDetailedGlyph(svg, 'segment')
  }
  const busyInBar = bar[0].findAll((n) => typeof n.type === 'string' && n.props['data-busy'] !== undefined)
  assert.equal(busyInBar.length, 0, 'nothing in the bar carries data-busy')
  assert.equal(busyOf(live), 'false', 'the star is not busy while the bar is open')
  await escape(live.env)
})

slideTest('BA-15 [EP first-use window] row glyphs have the star glyph structure and no busy state', async () => {
  const star = {}
  for (const mode of MODES) star[mode] = structure((await starOn(mode)).live.icon())
  const env = await boot({ form: fakeForm() })
  const overlays = await mountOverlays(env)
  await mountStar(env)
  await settle()
  const dialogs = overlays.dialogs()
  assert.equal(dialogs.length, 1, 'the first-use window is shown')
  const svgs = dialogs[0].findAll((n) => n.type === 'svg' && MODES.includes(n.props['data-mode']))
  for (const mode of MODES) {
    const own = svgs.filter((s) => s.props['data-mode'] === mode)
    assert.ok(own.length >= 1, mode + ' row glyph present')
    for (const svg of own) assert.equal(structure(svg), star[mode], mode + ' row glyph has the star structure')
    if (mode === 'detailed') assertDetailedGlyph(own[0], 'first-use row')
  }
  assert.equal(dialogs[0].findAll((n) => typeof n.type === 'string' && n.props['data-busy'] !== undefined).length, 0, 'nothing in the window carries data-busy')
})
