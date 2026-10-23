// Mode switching on the composer star (drag left / right), the first-use onboarding window and
// the settings-page drag hint. Black-box, system level: the BUILT client bundle (lib/client.js)
// is booted through its public apply(ctx) against a fake host (slots, locale, and ctx.inject
// serving a fake configForms whose ConfigForm records every write) and rendered with
// react-test-renderer. Expected outcomes come from the mode-switch requirements only (R1..R10).
//
// Techniques:
//  - EP: saved defaultMode (detailed / standard / light / missing / invalid); host availability
//    (no configForms / loading / unavailable / read-only / ready+writable); pointer button
//    (0 / 1 / 2); click kind (mouse detail 1 / keyboard detail 0); storage (working / methods
//    throw / getter throws); primitives module present / absent; locales zh / en.
//  - BVA: release travel |dx| 0 / 15 / 16 / 20 / 43 / 44 / 88 / 100 / 131 / 132 / 200 / 600 /
//    1000 in both directions (the release selects by distance, 88 px per mode from half a mode,
//    clamped at the ends); dominance |dx| = |dy| (44,44) (100,100) vs |dx| = |dy| + 1 (44,43)
//    (100,99) (-100,99).
//  - Decision table: mode x direction -> write / no write and shown mode (incl. no wrap-around);
//    configForms presence x status x writable -> switching possible / onboarding shown.
//  - State transition: drag sequences; in-flight write (optimistic) -> true / false / rejected;
//    snapshot sync; service arriving late / withdrawn; availability toggling; pointer
//    down -> up | cancel | leave; click after a drag -> suppressed, re-armed by a press;
//    onboarding never shown -> open -> dismissed (Got it / close / improve click) -> reload.
//
// The drag outcome follows the mode-bar rule (see mode-slide.test.mjs): a release >= 16 px sideways
// selects by distance, one mode per 88 px from half a segment, clamped at the ends; DRAG_PX is
// one segment, so "one drag" below still means "one step".
//
// Cases: MS-01..MS-22 star mode + gesture, MS-30..MS-34 clicks, MS-40..MS-48 onboarding,
// MS-50..MS-51 settings page, MS-60 locales.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer from 'react-test-renderer'

const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const T = { timeout: 20000 }
const NS = 'dsh-smart-prompt'
const BUTTON_ID = 'dsh-smart-prompt-button'
const SLOT = { overlay: 'conversation.input.overlay', composer: 'conversation.composer', settings: 'plugins.bundle.config' }
const CONFIG_FORMS = 'configForms'
const REMOTE_SESSION = 'remote.session'
const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'
const MODE_FIELD = 'defaultMode'
/** Left to right, as on the star (R2). */
const MODES = ['detailed', 'standard', 'light']
const DEFAULT_MODE = 'standard'
const SPARKLE_PATH = 'M8 1.2l1.35 3.9a2 2 0 001.25 1.25l3.9 1.35-3.9 1.35a2 2 0 00-1.25 1.25L8 14.8l-1.35-3.9a2 2 0 00-1.25-1.25L1.5 8.3l3.9-1.35A2 2 0 006.65 5.7L8 1.2z'
const SPARKLE_FILL = 'currentColor'
/** Smallest horizontal travel that is a drag (R5). */
const DRAG_MIN_PX = 16
/** One mode-bar segment: a release this far sideways selects the neighbouring mode (S4). */
const SEGMENT_PX = 88
/** Smallest travel that leaves the start segment: half a segment (S4). */
const STEP_MIN_PX = SEGMENT_PX / 2
/** A drag of one segment: one step toward detailed (left) or light (right). */
const DRAG_PX = SEGMENT_PX
const HINT_KEY = { detailed: 'modeDetailedHint', standard: 'modeStandardHint', light: 'modeLightHint' }
const NEW_KEYS = ['starDragHint', 'onboardingTitle', 'onboardingDrag', 'onboardingDefault', 'onboardingSettings', 'onboardingDismiss', 'onboardingClose', 'settingsModeDragHint']
const KEY = { drag: 'onboardingDrag', dismiss: 'onboardingDismiss', close: 'onboardingClose', settingsHint: 'settingsModeDragHint' }
const DRAFT = '把那个接口加上限流'
const REFINED = '为登录接口增加按 IP 的限流，每分钟 60 次。'
const META = { mode: 'standard', model: 'p/m', ratio: 1.4, ratioLabel: '1.4x', elapsedMs: 2100, anchors: { total: 0, kept: 0, reinjected: 0 }, note: '', contextUsed: 'none' }
const IMPROVE_URL = '/dsh-smart-prompt/api/improve'
const ORIGIN = { x: 200, y: 300 }
const MOUSE_CLICK = 1
const KEYBOARD_CLICK = 0
/** window timers up to this run for real; longer ones (bubble auto-hide) are parked. */
const REAL_TIMER_MAX_MS = 1000

// ================================================================ harness

const act = (fn) => TestRenderer.act(async () => { await fn() })
const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)) })
const textOf = (node) => (typeof node === 'string' ? node : node.children.map(textOf).join(''))
const hasClass = (node, cls) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes(cls)
const byClass = (root, cls) => root.findAll((n) => typeof n.type === 'string' && hasClass(n, cls))
const within = (node, ancestor) => { for (let p = node.parent; p !== null && p !== undefined; p = p.parent) if (p === ancestor) return true; return false }
/** The drawing of an svg: its element types, path data and transforms, in order. */
const glyph = (svg) => JSON.stringify(svg.findAll((n) => typeof n.type === 'string' && n !== svg).map((n) => [n.type, n.props.d ?? n.props.points ?? null, n.props.transform ?? null]))
const pathsOf = (svg) => svg.findAll((n) => n.type === 'path')

async function create(Component, props) {
  let renderer = null
  await act(() => { renderer = TestRenderer.create(React.createElement(Component, props)) })
  return renderer
}

function windowTimers() {
  let seq = 0
  const running = new Map()
  return {
    setTimeout: (fn, ms, ...args) => {
      seq += 1
      const id = seq
      if ((ms ?? 0) <= REAL_TIMER_MAX_MS) running.set(id, setTimeout(() => { running.delete(id); fn(...args) }, ms))
      return id
    },
    clearTimeout: (id) => { if (running.has(id)) { clearTimeout(running.get(id)); running.delete(id) } },
  }
}

/** A working localStorage; reuse the same object across loads to simulate a reload. */
function memoryStorage() {
  const entries = new Map()
  return {
    entries,
    getItem: (k) => (entries.has(String(k)) ? entries.get(String(k)) : null),
    setItem: (k, v) => { entries.set(String(k), String(v)) },
    removeItem: (k) => { entries.delete(String(k)) },
    clear: () => { entries.clear() },
    key: (i) => [...entries.keys()][i] ?? null,
    get length() { return entries.size },
  }
}

/** Storage whose methods throw (storage disabled by the browser). */
function throwingStorage() {
  const deny = () => { throw new Error('SecurityError: storage is disabled') }
  return { getItem: deny, setItem: deny, removeItem: deny, clear: deny, key: deny, get length() { return 0 } }
}

/** Marker: reading window.localStorage itself throws. */
const STORAGE_GETTER_THROWS = Symbol('storage getter throws')

function installStorage(win, storage) {
  // window === globalThis in a browser, so the storage is reachable both ways.
  const descriptor = storage === STORAGE_GETTER_THROWS
    ? { configurable: true, enumerable: true, get() { throw new Error('SecurityError: access to localStorage is denied') } }
    : { configurable: true, enumerable: true, writable: true, value: storage }
  Object.defineProperty(win, 'localStorage', descriptor)
  Object.defineProperty(globalThis, 'localStorage', descriptor)
}

/** Load the built bundle as the module loader does; primitives null leaves the module out. */
async function loadClient({ storage, primitives }) {
  let captured = null
  const timers = windowTimers()
  const win = {
    __ModuleLoader__: { load: (m) => { captured = m } },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  }
  installStorage(win, storage)
  globalThis.window = win
  await import('../lib/client.js?cachebust=' + String(Date.now()) + Math.random())
  assert.ok(captured !== null, 'bundle must call window.__ModuleLoader__.load')
  return captured.factory((id) => {
    if (id === 'react') return React
    if (id === 'react-dom') return require('react-dom')
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (id === 'react-dom/client') return require('react-dom/client')
    if (id === PRIMITIVES_MODULE && primitives !== null) return primitives
    throw new Error('unexpected external: ' + id)
  })
}

/**
 * Fake host ConfigForm for the plugin entry. opts.write decides what set() does:
 *  'commit' - the host folds the value in (snapshot published) and resolves true;
 *  'hold'   - pending; the test settles it through form.held[i].resolve / reject;
 *  'false'  - resolves false; 'reject' - rejects.
 * opts.value may be given explicitly as undefined (nothing loaded).
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
    /** Host side: replace snapshot fields and notify the subscribers. */
    publish(patch) {
      snap = { ...snap, ...patch, revision: snap.revision + 1 }
      for (const listener of [...listeners]) listener()
    },
    setValue(field, next) { form.publish({ value: { ...(snap.value ?? {}), [field]: next } }) },
  }
  return form
}

/** The configForms service: get(entry) hands out the one ConfigForm of this plugin. */
function configFormsService(form) {
  return {
    get: (id) => (id === NS ? form : undefined),
    whileServed: (_namespaces, register) => { const off = register(); return typeof off === 'function' ? off : () => {} },
  }
}

/**
 * Host primitives stub. The form model reads the ConfigForm snapshot (re-projecting when it
 * changes) and, like the host model, save() writes every staged field through the ConfigForm.
 */
function fakePrimitives() {
  class SettingsFormModel {
    constructor(scope) {
      this.scope = scope
      this.staged = new Map()
      this.listeners = new Set()
      this.fire = () => {}
      this.off = scope.subscribe(() => this.fire())
    }
    bind(project) {
      let snap = project()
      this.fire = () => { snap = project(); for (const l of [...this.listeners]) l() }
      return { getSnapshot: () => snap, subscribe: (l) => { this.listeners.add(l); return () => { this.listeners.delete(l) } } }
    }
    shell() {
      const s = this.scope.getSnapshot()
      return { available: s.status === 'ready', writable: s.writable === true, dirty: this.staged.size > 0, invalid: false, saving: false, failed: false }
    }
    field(name) {
      const saved = this.scope.getSnapshot().value?.[name]
      const text = this.staged.has(name) ? this.staged.get(name) : saved === undefined || saved === null ? '' : String(saved)
      return { text, overridden: false, invalid: false }
    }
    actions() {
      return {
        edit: (field, text) => { this.staged.set(field, text); this.fire() },
        resetField: (field) => { this.staged.delete(field); this.fire() },
        save: () => {
          const staged = [...this.staged]
          this.staged.clear()
          for (const [field, text] of staged) void this.scope.set(field, text)
          this.fire()
        },
        discard: () => { this.staged.clear(); this.fire() },
      }
    }
    dispose() { this.off() }
  }
  return {
    SettingsFormModel,
    settingsTextField: (field) => ({ field }),
    settingsNumberField: (field) => ({ field }),
    SettingsForm: (props) => React.createElement('form', { 'data-invalid': String(props.state.invalid) }, props.children),
    SegmentedControl: (props) => React.createElement('div', { 'data-segmented': props.id, 'data-value': props.value, 'data-options': props.options.map((o) => o.value).join(',') }),
    Switch: (props) => React.createElement('button', { role: 'switch', 'aria-checked': props.checked, 'aria-label': props.label, disabled: props.disabled, onClick: () => props.onChange(!props.checked) }),
  }
}

const REMOTE_SESSION_FACE = { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) }

/**
 * Boot the bundle against a fake host. The translator echoes locale keys.
 *  form       - the ConfigForm configForms serves; omitted = no configForms service at all.
 *  deferred   - configForms is provided later, through env.provide().
 *  storage    - window.localStorage (memoryStorage(), throwingStorage() or STORAGE_GETTER_THROWS).
 *  primitives - the primitives module; null = not available.
 * uiSession is never served, so no composer-seat entry exists.
 */
async function boot({ form, deferred = false, storage = memoryStorage(), primitives = fakePrimitives() } = {}) {
  const module = await loadClient({ storage, primitives })
  const service = form === undefined ? undefined : configFormsService(form)
  const env = { module, form, storage, primitives, registered: [], seats: [], locales: {}, injected: [], served: service !== undefined && !deferred, pending: [], disposers: [] }
  const provided = (name) => {
    if (name === CONFIG_FORMS) return env.served ? service : undefined
    if (name === REMOTE_SESSION) return REMOTE_SESSION_FACE
    return undefined
  }
  env.t = (k) => k
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
    locale: { register(ns, dicts) { env.locales[ns] = dicts; return () => {} }, bind() { return env.t } },
    effect(fn) { return fn() },
    on() { return () => {} },
    get: provided,
    inject(names, callback) {
      env.injected.push([...names])
      // This host only ever serves configForms (and only when the test gives a form).
      if (service === undefined || !names.every((n) => n === CONFIG_FORMS)) return () => {}
      // The inner context is disposed (its effects undone) when the service is withdrawn.
      const inner = {
        ...ctx,
        get: provided,
        effect: (fn) => { const off = fn(); if (typeof off === 'function') env.disposers.push(off); return off },
        on: (event, fn) => { if (event === 'dispose') env.disposers.push(fn); return () => {} },
      }
      const run = () => { callback(inner) }
      if (env.served) run()
      else env.pending.push(run)
      return () => {}
    },
  }
  await act(() => { module.apply(ctx) })
  env.provide = () => act(() => { env.served = true; for (const run of env.pending.splice(0)) run() })
  env.withdraw = () => act(() => { env.served = false; for (const off of env.disposers.splice(0).reverse()) off() })
  return env
}

/** Seat props of a session-scoped composer entry. */
function seatProps(env, entry, sessionId, live, actions) {
  const base = typeof entry.options.inject === 'function' ? entry.options.inject(sessionId) : {}
  return { ...base, sessionId, useInput: (sel) => sel({ draft: live.draft, attachmentIds: [], phase: 'plain' }), inputActions: actions, t: env.t }
}

/** Mount the composer star over a live draft. */
async function mountStar(env, sessionId = 's1') {
  const entry = env.registered.find((r) => r.options.id === BUTTON_ID)
  assert.ok(entry !== undefined, 'the composer star is registered')
  const live = { draft: DRAFT }
  const actions = { setDraft: (text) => { live.draft = text } }
  live.renderer = await create(entry.component, seatProps(env, entry, sessionId, live, actions))
  live.root = () => byClass(live.renderer.root, 'dip-root')[0]
  live.star = () => byClass(live.renderer.root, 'dip-btn')[0]
  live.icon = () => byClass(live.star(), 'dip-icon')[0]
  live.unmount = () => act(() => { live.renderer.unmount() })
  return live
}

/** Mount every overlay-slot entry; dialogs() lists the onboarding windows they render. */
async function mountOverlays(env, sessionId = 's1') {
  const live = { draft: DRAFT }
  const renderers = []
  for (const entry of env.registered.filter((r) => r.options.name === SLOT.overlay)) {
    renderers.push(await create(entry.component, seatProps(env, entry, sessionId, live, { setDraft() {} })))
  }
  return { renderers, dialogs: () => renderers.flatMap((r) => byClass(r.root, 'dip-onboard')) }
}

/** Mount the plugin settings section with a reactive settings hook, as the host does. */
async function mountSection(env) {
  const entry = env.registered.find((r) => r.options.name === SLOT.settings)
  assert.ok(entry !== undefined, 'the settings section is registered while configForms serves the entry')
  const face = entry.options.inject()
  const store = face.hooks.smartPromptSettings
  const useSmartPromptSettings = (selector) => selector(React.useSyncExternalStore(store.subscribe, store.getSnapshot))
  const props = { ...face, view: 'page', t: env.t, useSmartPromptSettings }
  delete props.hooks
  const renderer = await create(entry.component, props)
  const control = (value) => renderer.root.findAll((n) => n.type === env.primitives.SegmentedControl && n.props.options.some((o) => o.value === value))[0]
  return { face, renderer, modeControl: () => control('detailed'), sourceControl: () => control('conversation') }
}

// ---------------------------------------------------------------- gestures and clicks

function pointer(x, y, { button = 0, pointerId = 1 } = {}) {
  const capture = { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false } }
  return { pointerId, clientX: x, clientY: y, button, isPrimary: true, pointerType: 'mouse', currentTarget: capture, target: capture, preventDefault() {}, stopPropagation() {} }
}

function handler(live, name) {
  const fn = live.root().props[name]
  assert.equal(typeof fn, 'function', '.dip-root carries ' + name)
  return fn
}

const at = (dx, dy, opts) => pointer(ORIGIN.x + dx, ORIGIN.y + dy, opts)

async function press(live, opts) { await act(() => { handler(live, 'onPointerDown')(at(0, 0, opts)) }) }

/** A real pointer moves before it is released; a move handler, if any, sees the travel too. */
async function moveTo(live, dx, dy, opts) {
  const move = live.root().props.onPointerMove
  if (typeof move === 'function') await act(() => { move(at(dx, dy, opts)) })
}

async function release(live, dx, dy = 0, opts) {
  await moveTo(live, dx, dy, opts)
  await act(() => { handler(live, 'onPointerUp')(at(dx, dy, opts)) })
  await settle()
}

async function drag(live, dx, dy = 0, opts) { await press(live, opts); await release(live, dx, dy, opts) }

async function click(live, detail) {
  await act(() => { live.star().props.onClick({ detail, button: 0, preventDefault() {}, stopPropagation() {} }) })
  await settle()
}

/** A mouse click as a browser delivers it: pointerdown, pointerup (travel dx), click. */
async function pressAndClick(live, dx = 0) { await drag(live, dx); await click(live, MOUSE_CLICK) }

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
  return { sent, improves: () => sent.filter((s) => s.url === IMPROVE_URL), restore: () => { globalThis.fetch = original } }
}

// ---------------------------------------------------------------- assertions

function assertShows(live, mode, message) {
  assert.ok(live.star() !== undefined, message + ': the star is rendered')
  assert.equal(live.star().props['data-mode'], mode, message + ': button data-mode')
  assert.ok(live.icon() !== undefined, message + ': the star has its dip-icon svg')
  assert.equal(live.icon().type, 'svg', message + ': the icon is an svg')
  assert.equal(live.icon().props['data-mode'], mode, message + ': svg data-mode')
}

/** Every write went through form.set(defaultMode, ...), with exactly these values in order. */
function assertWrites(form, modes, message) {
  assert.deepEqual(form.sets.map(([field, value]) => [field, value]), modes.map((m) => [MODE_FIELD, m]), message + ': form.set calls')
  assert.equal(form.unsets.length, 0, message + ': no unset')
  assert.equal(form.mutates.length, 0, message + ': no mutate')
}

/** The star's glyph for each mode, each read from a fresh load with that mode saved. */
async function learnGlyphs() {
  const glyphs = {}
  for (const mode of MODES) {
    const live = await mountStar(await boot({ form: fakeForm({ value: { defaultMode: mode } }) }))
    assertShows(live, mode, 'learning the ' + mode + ' glyph')
    glyphs[mode] = glyph(live.icon())
    await live.unmount()
  }
  return glyphs
}

/** The onboarding rows: the smallest elements holding exactly one mode description and an icon. */
function modeRows(dialog) {
  const modeOf = (n) => { const text = textOf(n); const hits = MODES.filter((m) => text.includes(HINT_KEY[m])); return hits.length === 1 ? hits[0] : null }
  const candidates = dialog.findAll((n) => typeof n.type === 'string' && modeOf(n) !== null && n.findAll((c) => c.type === 'svg').length > 0)
  return candidates
    .filter((n) => !candidates.some((c) => c !== n && within(c, n)))
    .map((n) => ({ mode: modeOf(n), glyphs: n.findAll((c) => c.type === 'svg').map(glyph) }))
}

const pressButton = (node) => act(() => { node.props.onClick({ detail: MOUSE_CLICK, button: 0, preventDefault() {}, stopPropagation() {} }) })

// ================================================================ star: mode shown (R3, R7)

test('MS-01 [EP saved mode] the star and its svg show the saved defaultMode: detailed / standard / light', T, async () => {
  for (const mode of MODES) {
    const live = await mountStar(await boot({ form: fakeForm({ value: { defaultMode: mode } }) }))
    assertShows(live, mode, 'saved ' + mode)
  }
})

test('MS-02 [EP standard icon] the standard icon is the original sparkle: one path, exact d, fill currentColor', T, async () => {
  const live = await mountStar(await boot({ form: fakeForm({ value: { defaultMode: 'standard' } }) }))
  assertShows(live, 'standard', 'standard')
  const paths = pathsOf(live.icon())
  assert.equal(paths.length, 1, 'a single path')
  assert.equal(paths[0].props.d, SPARKLE_PATH)
  assert.equal(paths[0].props.fill, SPARKLE_FILL)
})

test('MS-03 [EP invalid / missing] a missing or invalid defaultMode shows standard', T, async () => {
  const values = [{}, { defaultMode: 'turbo' }, { defaultMode: 'Light' }, { defaultMode: '' }, { defaultMode: 42 }, { defaultMode: null }, undefined]
  for (const value of values) {
    const live = await mountStar(await boot({ form: fakeForm({ value }) }))
    assertShows(live, DEFAULT_MODE, 'value ' + JSON.stringify(value))
  }
})

/**
 * R7: detailed (a stretched star on a paper) and light (a bolt) are other glyphs. A stretched star
 * may reuse the sparkle outline under a transform, so the check is: the icon draws a path whose d
 * is not the sparkle, and the whole glyph differs from the standard one.
 */
function assertOwnGlyph(svg, glyphs, mode) {
  assert.ok(pathsOf(svg).some((p) => p.props.d !== SPARKLE_PATH), mode + ' draws a path that is not the sparkle')
  assert.notEqual(glyph(svg), glyphs.standard, mode + ' is not the standard sparkle glyph')
}

test('MS-04 [EP icons] detailed and light are their own glyphs (a path d other than the sparkle); all three differ', T, async () => {
  const glyphs = await learnGlyphs()
  for (const mode of ['detailed', 'light']) {
    const live = await mountStar(await boot({ form: fakeForm({ value: { defaultMode: mode } }) }))
    assertOwnGlyph(live.icon(), glyphs, mode)
  }
  assert.equal(new Set(Object.values(glyphs)).size, 3, 'detailed, standard and light are three different glyphs')
})

// ================================================================ star: availability (R3)

test('MS-05 [Decision availability] switching only with configForms ready AND writable; otherwise no write and the saved mode (or standard)', T, async () => {
  const rows = [
    { name: 'no configForms service', form: undefined, shows: 'standard' },
    { name: 'loading (writable true)', form: { status: 'loading', value: undefined, writable: true }, shows: 'standard' },
    { name: 'unavailable', form: { status: 'unavailable', value: undefined, writable: false }, shows: 'standard' },
    { name: 'ready, read-only', form: { status: 'ready', value: { defaultMode: 'light' }, writable: false }, shows: 'light' },
  ]
  for (const row of rows) {
    const form = row.form === undefined ? undefined : fakeForm(row.form)
    const live = await mountStar(await boot({ form }))
    assertShows(live, row.shows, row.name)
    await drag(live, -DRAG_PX)
    assertShows(live, row.shows, row.name + ' after a left drag')
    await drag(live, DRAG_PX)
    assertShows(live, row.shows, row.name + ' after a right drag')
    if (form !== undefined) assertWrites(form, [], row.name)
  }
  // Control row: ready + writable switches.
  const form = fakeForm({ value: { defaultMode: 'light' } })
  const live = await mountStar(await boot({ form }))
  await drag(live, -DRAG_PX)
  assertWrites(form, ['standard'], 'ready + writable')
  assertShows(live, 'standard', 'ready + writable')
})

// ================================================================ star: drag outcome (R2, R3)

test('MS-06 [Decision mode x direction] a one-segment drag steps toward detailed (left) / light (right); no wrap-around, no write at the ends', T, async () => {
  const rows = [
    { value: { defaultMode: 'detailed' }, dx: -DRAG_PX, write: null, shows: 'detailed' },
    { value: { defaultMode: 'detailed' }, dx: DRAG_PX, write: 'standard', shows: 'standard' },
    { value: { defaultMode: 'standard' }, dx: -DRAG_PX, write: 'detailed', shows: 'detailed' },
    { value: { defaultMode: 'standard' }, dx: DRAG_PX, write: 'light', shows: 'light' },
    { value: { defaultMode: 'light' }, dx: -DRAG_PX, write: 'standard', shows: 'standard' },
    { value: { defaultMode: 'light' }, dx: DRAG_PX, write: null, shows: 'light' },
    // The active mode falls back to standard, and a drag steps from it.
    { value: {}, dx: -DRAG_PX, write: 'detailed', shows: 'detailed' },
    { value: { defaultMode: 'turbo' }, dx: DRAG_PX, write: 'light', shows: 'light' },
  ]
  for (const row of rows) {
    const name = JSON.stringify(row.value) + (row.dx < 0 ? ' drag left' : ' drag right')
    const form = fakeForm({ value: row.value })
    const live = await mountStar(await boot({ form }))
    await drag(live, row.dx)
    assertWrites(form, row.write === null ? [] : [row.write], name)
    assertShows(live, row.shows, name)
  }
})

test('MS-07 [BVA travel] from standard a release steps from |dx| 44 (half a segment): 0 / 15 / 16 / 20 / 43 keep standard, 44 steps (both directions)', T, async () => {
  const rows = [
    { dx: 0, write: null }, { dx: DRAG_MIN_PX - 1, write: null }, { dx: DRAG_MIN_PX, write: null },
    { dx: STEP_MIN_PX - 1, write: null }, { dx: STEP_MIN_PX, write: 'light' },
    { dx: -(DRAG_MIN_PX - 1), write: null }, { dx: -DRAG_MIN_PX, write: null }, { dx: -20, write: null },
    { dx: -(STEP_MIN_PX - 1), write: null }, { dx: -STEP_MIN_PX, write: 'detailed' },
  ]
  for (const row of rows) {
    const form = fakeForm()
    const live = await mountStar(await boot({ form }))
    await drag(live, row.dx)
    assertWrites(form, row.write === null ? [] : [row.write], 'dx ' + String(row.dx))
    assertShows(live, row.write ?? DEFAULT_MODE, 'dx ' + String(row.dx))
  }
})

test('MS-08 [BVA distance] the release selects by distance (one mode per 88 px from 44) and clamps at the ends', T, async () => {
  const rows = [
    { from: 'standard', dx: -100, write: 'detailed' },
    { from: 'detailed', dx: 100, write: 'standard' },
    { from: 'detailed', dx: 131, write: 'standard' },
    { from: 'detailed', dx: 132, write: 'light' },
    { from: 'detailed', dx: 200, write: 'light' },
    { from: 'detailed', dx: 600, write: 'light' },
    { from: 'light', dx: -131, write: 'standard' },
    { from: 'light', dx: -132, write: 'detailed' },
    { from: 'light', dx: -1000, write: 'detailed' },
    { from: 'standard', dx: 1000, write: 'light' },
    { from: 'standard', dx: -600, write: 'detailed' },
  ]
  for (const row of rows) {
    const form = fakeForm({ value: { defaultMode: row.from } })
    const live = await mountStar(await boot({ form }))
    await drag(live, row.dx)
    assertWrites(form, [row.write], row.from + ' dx ' + String(row.dx))
    assertShows(live, row.write, row.from + ' dx ' + String(row.dx))
  }
})

test('MS-09 [BVA dominance] a drag needs |dx| > |dy|: (44,44) no, (44,43) yes, (100,100) no, (100,99) yes, (16,40) no, (-100,99) yes, (-100,-100) no, (0,60) no', T, async () => {
  const rows = [
    { dx: STEP_MIN_PX, dy: STEP_MIN_PX, write: null }, { dx: STEP_MIN_PX, dy: STEP_MIN_PX - 1, write: 'light' },
    { dx: 100, dy: 100, write: null }, { dx: 100, dy: 99, write: 'light' }, { dx: DRAG_MIN_PX, dy: 40, write: null },
    { dx: -100, dy: 99, write: 'detailed' }, { dx: -100, dy: -100, write: null }, { dx: 0, dy: 60, write: null },
  ]
  for (const row of rows) {
    const name = '(' + String(row.dx) + ',' + String(row.dy) + ')'
    const form = fakeForm()
    const live = await mountStar(await boot({ form }))
    await drag(live, row.dx, row.dy)
    assertWrites(form, row.write === null ? [] : [row.write], name)
    assertShows(live, row.write ?? DEFAULT_MODE, name)
  }
})

test('MS-10 [EP pointer button] only the primary button (0) drags; 1 and 2 do not', T, async () => {
  for (const [button, write] of [[1, null], [2, null], [0, 'light']]) {
    const form = fakeForm()
    const live = await mountStar(await boot({ form }))
    await drag(live, DRAG_PX, 0, { button })
    assertWrites(form, write === null ? [] : [write], 'button ' + String(button))
    assertShows(live, write ?? DEFAULT_MODE, 'button ' + String(button))
  }
})

test('MS-11 [State cancel] pointercancel aborts the gesture: no write, a stray pointerup after it neither; the next drag works', T, async () => {
  const form = fakeForm()
  const live = await mountStar(await boot({ form }))
  await press(live)
  await moveTo(live, 60, 0)
  await act(() => { handler(live, 'onPointerCancel')(at(60, 0)) })
  await settle()
  assertWrites(form, [], 'after pointercancel')
  assertShows(live, DEFAULT_MODE, 'after pointercancel')
  await act(() => { handler(live, 'onPointerUp')(at(60, 0)) })
  await settle()
  assertWrites(form, [], 'a pointerup after the cancel')
  await drag(live, DRAG_PX)
  assertWrites(form, ['light'], 'a fresh drag after the cancel')
  assertShows(live, 'light', 'a fresh drag after the cancel')
})

test('MS-12 [State leave] up then leave is one drag = one step; leave then up is at most one step; a short leave is no drag', T, async () => {
  // Browser order with pointer capture: pointerup, then pointerleave.
  const upFirst = fakeForm()
  const a = await mountStar(await boot({ form: upFirst }))
  await press(a)
  await release(a, DRAG_PX)
  await act(() => { handler(a, 'onPointerLeave')(at(DRAG_PX, 0)) })
  await settle()
  assertWrites(upFirst, ['light'], 'up then leave')
  assertShows(a, 'light', 'up then leave')

  // Leave while still pressed, then up: still a single drag (whether leave ends it or not).
  const leaveFirst = fakeForm()
  const b = await mountStar(await boot({ form: leaveFirst }))
  await press(b)
  await moveTo(b, DRAG_PX, 0)
  await act(() => { handler(b, 'onPointerLeave')(at(DRAG_PX, 0)) })
  await act(() => { handler(b, 'onPointerUp')(at(DRAG_PX, 0)) })
  await settle()
  assert.ok(leaveFirst.sets.length <= 1, 'one drag writes at most once: ' + JSON.stringify(leaveFirst.sets))
  assertWrites(leaveFirst, leaveFirst.sets.length === 0 ? [] : ['light'], 'leave then up')
  assertShows(b, leaveFirst.sets.length === 0 ? DEFAULT_MODE : 'light', 'leave then up')

  // Below the threshold nothing happens, whatever the order.
  const short = fakeForm()
  const c = await mountStar(await boot({ form: short }))
  await press(c)
  await moveTo(c, 5, 0)
  await act(() => { handler(c, 'onPointerLeave')(at(5, 0)) })
  await act(() => { handler(c, 'onPointerUp')(at(5, 0)) })
  await settle()
  assertWrites(short, [], 'short leave')
})

test('MS-13 [State sequence] detailed -right-> standard -right-> light -right-> (end) -left-> standard', T, async () => {
  const form = fakeForm({ value: { defaultMode: 'detailed' } })
  const live = await mountStar(await boot({ form }))
  const steps = [[DRAG_PX, 'standard'], [DRAG_PX, 'light'], [DRAG_PX, 'light'], [-DRAG_PX, 'standard']]
  for (const [dx, shows] of steps) {
    await drag(live, dx)
    assertShows(live, shows, 'step to ' + shows)
    assert.equal(form.getSnapshot().value.defaultMode, shows, 'the saved mode follows')
  }
  assertWrites(form, ['standard', 'light', 'standard'], 'the end-of-range drag writes nothing')
})

// ================================================================ star: in-flight writes (R3)

test('MS-14 [State in flight] the star shows the new mode at once; a second quick drag steps from it', T, async () => {
  const form = fakeForm({ value: { defaultMode: 'detailed' }, write: 'hold' })
  const live = await mountStar(await boot({ form }))
  await drag(live, DRAG_PX)
  assertShows(live, 'standard', 'first write pending')
  await drag(live, DRAG_PX)
  assertShows(live, 'light', 'second write pending: stepped from standard, not from the saved detailed')
  assertWrites(form, ['standard', 'light'], 'two quick drags')
  // The host folds the writes in.
  await act(() => { form.setValue(MODE_FIELD, 'light'); for (const w of form.held) w.resolve(true) })
  await settle()
  assertShows(live, 'light', 'after both writes landed')
})

test('MS-15 [State write fails] a write resolving false or rejecting returns the star to the snapshot mode', T, async () => {
  const rows = [
    { name: 'pending, then false', write: 'hold', finish: (f) => f.held[0].resolve(false) },
    { name: 'pending, then rejected', write: 'hold', finish: (f) => f.held[0].reject(new Error('write denied')) },
    { name: 'false at once', write: 'false' },
    { name: 'rejected at once', write: 'reject' },
  ]
  for (const row of rows) {
    const form = fakeForm({ write: row.write })
    const live = await mountStar(await boot({ form }))
    await drag(live, DRAG_PX)
    assertWrites(form, ['light'], row.name)
    if (row.finish !== undefined) {
      assertShows(live, 'light', row.name + ': while pending')
      await act(() => { row.finish(form) })
      await settle()
    }
    assertShows(live, DEFAULT_MODE, row.name + ': back to the snapshot')
  }
})

test('MS-16 [State write lands] a successful write folded in by the host keeps the mode; later snapshots still win', T, async () => {
  const form = fakeForm({ write: 'hold' })
  const live = await mountStar(await boot({ form }))
  await drag(live, DRAG_PX)
  await act(() => { form.setValue(MODE_FIELD, 'light'); form.held[0].resolve(true) })
  await settle()
  assertShows(live, 'light', 'folded in')
  await act(() => { form.setValue(MODE_FIELD, 'detailed') })
  assertShows(live, 'detailed', 'a later snapshot change after the write')
})

// ================================================================ star: sync (R4)

test('MS-17 [State sync] snapshot changes (settings page, other sessions) update every star, icon included', T, async () => {
  const glyphs = await learnGlyphs()
  const form = fakeForm()
  const env = await boot({ form })
  const s1 = await mountStar(env, 's1')
  const s2 = await mountStar(env, 's2')
  for (const mode of ['detailed', 'light', 'standard']) {
    await act(() => { form.setValue(MODE_FIELD, mode) })
    for (const live of [s1, s2]) {
      assertShows(live, mode, 'external save of ' + mode)
      assert.equal(glyph(live.icon()), glyphs[mode], 'the ' + mode + ' icon')
    }
  }
  await act(() => { form.setValue(MODE_FIELD, 'bogus') })
  assertShows(s1, DEFAULT_MODE, 'an invalid saved value')
  // A drag in one session reaches the other through the shared snapshot.
  await drag(s1, DRAG_PX)
  assertShows(s2, 'light', 'the other session follows the drag')
})

test('MS-18 [State availability] loading -> ready+writable -> read-only -> writable -> unavailable', T, async () => {
  const form = fakeForm({ status: 'loading', value: undefined, writable: true })
  const live = await mountStar(await boot({ form }))
  await drag(live, DRAG_PX)
  assertWrites(form, [], 'loading')
  assertShows(live, DEFAULT_MODE, 'loading')

  await act(() => { form.publish({ status: 'ready', value: { defaultMode: 'light' }, writable: true }) })
  assertShows(live, 'light', 'ready')
  await drag(live, -DRAG_PX)
  assertWrites(form, ['standard'], 'ready + writable')

  await act(() => { form.publish({ writable: false }) })
  await drag(live, -DRAG_PX)
  assertWrites(form, ['standard'], 'read-only: no new write')
  assertShows(live, 'standard', 'read-only shows the saved mode')

  await act(() => { form.publish({ writable: true }) })
  await drag(live, -DRAG_PX)
  assertWrites(form, ['standard', 'detailed'], 'writable again')

  await act(() => { form.publish({ status: 'unavailable', writable: false }) })
  await drag(live, DRAG_PX)
  assertWrites(form, ['standard', 'detailed'], 'unavailable: no new write')
})

test('MS-19 [State late service] configForms provided after the star mounted: standard and inert before, saved mode and switching after', T, async () => {
  const form = fakeForm({ value: { defaultMode: 'light' } })
  const env = await boot({ form, deferred: true })
  assert.ok(env.injected.some((names) => names.length === 1 && names[0] === CONFIG_FORMS), 'the plugin waits for configForms with ctx.inject')
  const live = await mountStar(env)
  assertShows(live, DEFAULT_MODE, 'before the service exists')
  await drag(live, -DRAG_PX)
  assertWrites(form, [], 'before the service exists')
  await env.provide()
  await settle()
  assertShows(live, 'light', 'once provided')
  await drag(live, -DRAG_PX)
  assertWrites(form, ['standard'], 'once provided')
})

test('MS-20 [State withdrawn service] when configForms goes away the star shows standard and a drag writes nothing', T, async () => {
  const form = fakeForm({ value: { defaultMode: 'light' } })
  const env = await boot({ form })
  const live = await mountStar(env)
  assertShows(live, 'light', 'served')
  await env.withdraw()
  await settle()
  assertShows(live, DEFAULT_MODE, 'withdrawn')
  await drag(live, -DRAG_PX)
  assertWrites(form, [], 'withdrawn')
})

test('MS-21 [State reload] the icon matches the mode after a drag and after a reload with the mode saved', T, async () => {
  const glyphs = await learnGlyphs()
  const first = fakeForm()
  const live1 = await mountStar(await boot({ form: first }))
  await drag(live1, -DRAG_PX)
  assertWrites(first, ['detailed'], 'the drag')
  assertShows(live1, 'detailed', 'after the drag')
  const afterDrag = glyph(live1.icon())
  assertOwnGlyph(live1.icon(), glyphs, 'detailed after the drag')
  assert.equal(afterDrag, glyphs.detailed, 'the detailed icon after the drag')

  // Reload: a fresh bundle whose ConfigForm already holds the saved mode.
  const live2 = await mountStar(await boot({ form: fakeForm({ value: { ...first.getSnapshot().value } }) }))
  assertShows(live2, 'detailed', 'after a reload')
  assert.equal(glyph(live2.icon()), afterDrag, 'the same detailed icon after the reload')
})

test('MS-22 [EP primitives absent] without the primitives module (no settings section) the star still shows and switches the mode', T, async () => {
  const form = fakeForm({ value: { defaultMode: 'light' } })
  const env = await boot({ form, primitives: null })
  assert.equal(env.registered.some((r) => r.options.name === SLOT.settings), false, 'no settings section without the primitives')
  const live = await mountStar(env)
  assertShows(live, 'light', 'saved mode')
  await drag(live, -DRAG_PX)
  assertWrites(form, ['standard'], 'drag')
  assertShows(live, 'standard', 'drag')
})

// ================================================================ clicks (R6)

test('MS-30 [EP click without a drag] press + release with dx 0 or 15, then a mouse click: one improve, no mode write', T, async () => {
  for (const dx of [0, DRAG_MIN_PX - 1]) {
    const net = stubFetch()
    try {
      const form = fakeForm()
      const live = await mountStar(await boot({ form }))
      await pressAndClick(live, dx)
      assert.equal(net.improves().length, 1, 'dx ' + String(dx) + ': the click improves')
      assertWrites(form, [], 'dx ' + String(dx))
    } finally { net.restore() }
  }
})

test('MS-31 [State click after drag] the mouse click following a 16 px drag (no step) does not improve; a press without drag re-arms the click', T, async () => {
  const net = stubFetch()
  try {
    const form = fakeForm()
    const live = await mountStar(await boot({ form }))
    await drag(live, DRAG_MIN_PX)
    await click(live, MOUSE_CLICK)
    assert.equal(net.improves().length, 0, 'the click after the drag is swallowed')
    assertWrites(form, [], 'a 16 px drag stays on its start segment')
    assertShows(live, DEFAULT_MODE, 'a 16 px drag stays on its start segment')
    await pressAndClick(live, 0)
    assert.equal(net.improves().length, 1, 'a later normal click improves again')
  } finally { net.restore() }
})

test('MS-32 [EP keyboard click] a keyboard click (detail 0) improves even right after a drag', T, async () => {
  const net = stubFetch()
  try {
    const live = await mountStar(await boot({ form: fakeForm() }))
    await drag(live, -DRAG_PX)
    await click(live, KEYBOARD_CLICK)
    assert.equal(net.improves().length, 1)
  } finally { net.restore() }
})

test('MS-33 [State busy] a click without a drag still cancels a refine in flight', T, async () => {
  const net = stubFetch({ hold: true })
  try {
    const live = await mountStar(await boot({ form: fakeForm() }))
    await pressAndClick(live, 0)
    assert.equal(net.improves().length, 1, 'the first click starts a refine')
    assert.equal(net.improves()[0].signal?.aborted, false, 'in flight')
    // Pointer handlers while busy are not specified; press and release when they exist.
    for (const name of ['onPointerDown', 'onPointerUp']) {
      const fn = live.root().props[name]
      if (typeof fn === 'function') await act(() => { fn(at(0, 0)) })
    }
    await click(live, MOUSE_CLICK)
    assert.equal(net.improves().length, 1, 'the second click starts nothing new')
    assert.equal(net.improves()[0].signal?.aborted, true, 'the second click cancels the refine')
  } finally { net.restore() }
})

test('MS-34 [Decision click after an end-of-range drag] a drag that cannot step (left on detailed) is still a drag: its click does not improve', T, async () => {
  const net = stubFetch()
  try {
    const form = fakeForm({ value: { defaultMode: 'detailed' } })
    const live = await mountStar(await boot({ form }))
    await drag(live, -DRAG_PX)
    assertWrites(form, [], 'no wrap-around')
    await click(live, MOUSE_CLICK)
    assert.equal(net.improves().length, 0, 'the click after the drag is swallowed')
    await pressAndClick(live, 0)
    assert.equal(net.improves().length, 1, 'a later normal click improves')
  } finally { net.restore() }
})

// ================================================================ onboarding (R8)

test('MS-40 [State first use] the window opens when the star is first shown (ready + writable), as an overlay dialog, and is recorded', T, async () => {
  const env = await boot({ form: fakeForm() })
  const overlays = await mountOverlays(env)
  assert.equal(overlays.dialogs().length, 0, 'not before the star is shown')
  const before = env.storage.entries.size
  await mountStar(env)
  await settle()
  const dialogs = overlays.dialogs()
  assert.equal(dialogs.length, 1, 'one onboarding window in the overlay slot')
  assert.equal(dialogs[0].props.role, 'dialog')
  assert.ok(env.storage.entries.size > before, 'showing it is recorded in localStorage')
  assert.equal(env.registered.some((r) => r.options.name === SLOT.composer), false, 'it does not take the composer seat')
  assert.equal(env.seats.includes(SLOT.composer), false, 'no conversation.composer entry is injected')
})

test('MS-41 [EP content] drag explanation, one row per mode (detailed, standard, light) with its icon and description, Got it and close', T, async () => {
  const glyphs = await learnGlyphs()
  const env = await boot({ form: fakeForm() })
  await mountStar(env)
  const overlays = await mountOverlays(env)
  const [dialog] = overlays.dialogs()
  assert.ok(dialog !== undefined, 'the onboarding window is open')
  const text = textOf(dialog)
  assert.ok(text.includes(KEY.drag), 'the drag explanation (onboardingDrag)')
  for (const mode of MODES) assert.equal(text.split(HINT_KEY[mode]).length - 1, 1, HINT_KEY[mode] + ' appears exactly once')
  const rows = modeRows(dialog)
  assert.deepEqual(rows.map((r) => r.mode), MODES, 'rows in the order detailed, standard, light')
  for (const row of rows) assert.ok(row.glyphs.includes(glyphs[row.mode]), row.mode + ' row carries the ' + row.mode + ' icon')
  const gotIt = dialog.findAll((n) => n.type === 'button' && textOf(n).includes(KEY.dismiss))
  assert.equal(gotIt.length, 1, 'one "Got it" button (onboardingDismiss)')
  const close = dialog.findAll((n) => typeof n.type === 'string' && n.props['aria-label'] === KEY.close)
  assert.equal(close.length, 1, 'one close control labelled onboardingClose')
  assert.equal(close[0].type, 'button', 'the close control is a button')
})

test('MS-42 [State Got it] "Got it" hides it; it does not reopen when the star is shown again, nor after a reload', T, async () => {
  const storage = memoryStorage()
  const env = await boot({ form: fakeForm(), storage })
  const live = await mountStar(env)
  const overlays = await mountOverlays(env)
  const [dialog] = overlays.dialogs()
  assert.ok(dialog !== undefined, 'open')
  await pressButton(dialog.findAll((n) => n.type === 'button' && textOf(n).includes(KEY.dismiss))[0])
  await settle()
  assert.equal(overlays.dialogs().length, 0, 'hidden by Got it')
  await live.unmount()
  await mountStar(env)
  await settle()
  assert.equal(overlays.dialogs().length, 0, 'the star shown again does not reopen it')

  const reload = await boot({ form: fakeForm(), storage })
  await mountStar(reload)
  assert.equal((await mountOverlays(reload)).dialogs().length, 0, 'never again after a reload')
})

test('MS-43 [State close] the close button hides it', T, async () => {
  const env = await boot({ form: fakeForm() })
  await mountStar(env)
  const overlays = await mountOverlays(env)
  const close = overlays.dialogs()[0]?.findAll((n) => typeof n.type === 'string' && n.props['aria-label'] === KEY.close)[0]
  assert.ok(close !== undefined, 'open, with its close button')
  await pressButton(close)
  await settle()
  assert.equal(overlays.dialogs().length, 0)
})

test('MS-44 [State improve click] clicking the star to improve hides it (and improves)', T, async () => {
  const net = stubFetch()
  try {
    const env = await boot({ form: fakeForm() })
    const live = await mountStar(env)
    const overlays = await mountOverlays(env)
    assert.equal(overlays.dialogs().length, 1, 'open')
    await pressAndClick(live, 0)
    assert.equal(net.improves().length, 1, 'the click improves')
    assert.equal(overlays.dialogs().length, 0, 'and hides the onboarding window')
  } finally { net.restore() }
})

test('MS-45 [State reload without dismissing] once shown it never appears in a later load, even if never dismissed', T, async () => {
  const storage = memoryStorage()
  const env = await boot({ form: fakeForm(), storage })
  await mountStar(env)
  assert.equal((await mountOverlays(env)).dialogs().length, 1, 'shown in the first load')
  const reload = await boot({ form: fakeForm(), storage })
  await mountStar(reload)
  assert.equal((await mountOverlays(reload)).dialogs().length, 0, 'not shown in the reload')
})

test('MS-46 [Decision availability] not shown without configForms, while loading, unavailable or read-only; a later ready load shows it', T, async () => {
  const storage = memoryStorage()
  const rows = [
    { name: 'no configForms', form: undefined },
    { name: 'loading', form: { status: 'loading', value: undefined, writable: true } },
    { name: 'unavailable', form: { status: 'unavailable', value: undefined, writable: false } },
    { name: 'ready, read-only', form: { status: 'ready', value: { defaultMode: 'standard' }, writable: false } },
  ]
  for (const row of rows) {
    const env = await boot({ form: row.form === undefined ? undefined : fakeForm(row.form), storage })
    await mountStar(env)
    assert.equal((await mountOverlays(env)).dialogs().length, 0, row.name)
  }
  const ready = await boot({ form: fakeForm(), storage })
  await mountStar(ready)
  assert.equal((await mountOverlays(ready)).dialogs().length, 1, 'nothing was recorded while it could not show; ready + writable shows it')
})

test('MS-47 [State loading -> ready] a star shown while loading opens the window once the form becomes ready and writable', T, async () => {
  const form = fakeForm({ status: 'loading', value: undefined, writable: false })
  const env = await boot({ form })
  await mountStar(env)
  const overlays = await mountOverlays(env)
  assert.equal(overlays.dialogs().length, 0, 'loading')
  await act(() => { form.publish({ status: 'ready', value: { defaultMode: 'standard' }, writable: true }) })
  await settle()
  assert.equal(overlays.dialogs().length, 1, 'ready + writable while the star is shown')
})

test('MS-48 [EP storage unavailable] storage methods throwing, or the storage getter throwing: no window; the star still switches', T, async () => {
  for (const [name, storage] of [['methods throw', throwingStorage()], ['getter throws', STORAGE_GETTER_THROWS]]) {
    const form = fakeForm()
    const env = await boot({ form, storage })
    const live = await mountStar(env)
    assert.equal((await mountOverlays(env)).dialogs().length, 0, name + ': no onboarding window')
    await drag(live, DRAG_PX)
    assertWrites(form, ['light'], name + ': drag still switches')
    assertShows(live, 'light', name)
  }
})

// ================================================================ settings page (R9)

test('MS-50 [EP settings hint] the mode row shows the settingsModeDragHint hint; the model row does not', T, async () => {
  const env = await boot({ form: fakeForm({ value: { defaultMode: 'standard', modelSource: 'conversation' } }) })
  const section = await mountSection(env)
  assert.ok(textOf(section.renderer.root).includes(KEY.settingsHint), 'the section shows settingsModeDragHint')
  const modeControl = section.modeControl()
  assert.ok(modeControl !== undefined, 'the mode SegmentedControl is rendered')
  let row = modeControl.parent
  while (row !== null && !textOf(row).includes(KEY.settingsHint)) row = row.parent
  assert.ok(row !== null, 'an ancestor of the mode control holds the hint')
  assert.equal(row.findAll((n) => n === section.sourceControl()).length, 0, 'the hint sits in the mode row, not around the model row')
})

test('MS-51 [State settings <-> star] setMode + save writes defaultMode and the star follows; a drag shows on the settings page', T, async () => {
  const form = fakeForm({ value: { defaultMode: 'standard', modelSource: 'conversation' } })
  const env = await boot({ form })
  const live = await mountStar(env)
  const section = await mountSection(env)
  assert.equal(section.modeControl().props.value, 'standard', 'both start on the saved mode')
  await act(() => { section.face.setMode('light') })
  await act(() => { section.face.save() })
  await settle()
  assertWrites(form, ['light'], 'save from the settings page')
  assertShows(live, 'light', 'the star follows the settings page')
  assert.equal(section.modeControl().props.value, 'light')
  await drag(live, -DRAG_PX)
  assertWrites(form, ['light', 'standard'], 'then a drag')
  assert.equal(section.modeControl().props.value, 'standard', 'the settings page follows the drag')
})

// ================================================================ locales (R10)

test('MS-60 [EP locales] zh and en define every new key with non-empty copy; the hold copy says 按住 / "hold" and the English copy names "Got it"', T, async () => {
  const env = await boot({ form: fakeForm() })
  const dicts = env.locales[NS]
  assert.ok(dicts !== undefined, 'the bundle registers its dictionaries')
  for (const lang of ['zh', 'en']) {
    for (const key of [...NEW_KEYS, ...Object.values(HINT_KEY)]) {
      assert.ok(typeof dicts[lang]?.[key] === 'string' && dicts[lang][key].trim().length > 0, lang + '.' + key)
    }
  }
  // The mode is picked by press-and-hold / slide on the mode bar, so the gesture copy names the hold.
  for (const key of ['starDragHint', 'onboardingDrag', 'settingsModeDragHint']) {
    assert.ok(dicts.zh[key].includes('按住'), 'zh.' + key + ' mentions 按住')
    assert.match(dicts.en[key], /hold/i, 'en.' + key + ' mentions hold')
  }
  assert.match(dicts.en.onboardingDismiss, /got it/i)
})
