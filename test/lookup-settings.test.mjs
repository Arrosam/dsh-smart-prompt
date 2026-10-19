// Session-lookup settings (Config + readLiveSettings, the client settings section and its
// locale copy) and the composer button's draft attachments (lib/client.js).
//
// Techniques:
//  - BVA: sessionLookupRounds -1 / 0 / 10 / 11; non-integer 2.5; client field '', '0',
//    '10', '-1', '11', '2.5'.
//  - EP: readLiveSettings inputs (missing, valid plain, out-of-range plain, non-number);
//    locale (en, zh); attachments (none, some, serializer rejects, service missing).
//  - State transition: idle -> done -> Retry (capsule) and idle -> error -> Retry (bubble),
//    each re-sending the attachments.
// Migration (Stardea settings): the primitives stub gains a `Switch`; LS-09 now expects four
// number inputs (questions, lookup rounds, Stardea ideas, Stardea rounds).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { Config, readLiveSettings } from '../lib/config.js'

const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DEFAULT_LOOKUP_ROUNDS = 3
const MAX_LOOKUP_ROUNDS = 10

// ================================================================ Config / readLiveSettings (G1)

test('LS-01 [EP default] sessionLookupRounds defaults to 3', () => {
  assert.equal(readLiveSettings(Config({})).sessionLookupRounds, DEFAULT_LOOKUP_ROUNDS)
})

test('LS-02 [BVA valid] the schema accepts 0, 1, 3, 9 and 10 lookup rounds', () => {
  for (const rounds of [0, 1, 3, 9, MAX_LOOKUP_ROUNDS]) {
    assert.doesNotThrow(() => Config({ sessionLookupRounds: rounds }), String(rounds))
    assert.equal(readLiveSettings(Config({ sessionLookupRounds: rounds })).sessionLookupRounds, rounds, String(rounds))
  }
})

test('LS-03 [BVA 11] the schema rejects 11 lookup rounds', () => {
  assert.throws(() => Config({ sessionLookupRounds: MAX_LOOKUP_ROUNDS + 1 }))
})

test('LS-04 [BVA -1] the schema rejects -1 lookup rounds', () => {
  assert.throws(() => Config({ sessionLookupRounds: -1 }))
})

test('LS-05 [EP non-integer] the schema rejects 2.5 lookup rounds', () => {
  assert.throws(() => Config({ sessionLookupRounds: 2.5 }))
})

test('LS-06 [EP plain valid] readLiveSettings reads a valid plain sessionLookupRounds as is', () => {
  assert.equal(readLiveSettings({ sessionLookupRounds: 0 }).sessionLookupRounds, 0)
  assert.equal(readLiveSettings({ sessionLookupRounds: 7 }).sessionLookupRounds, 7)
  assert.equal(readLiveSettings({ sessionLookupRounds: 10 }).sessionLookupRounds, 10)
})

test('LS-07 [EP plain missing/invalid] readLiveSettings falls back to 3 for missing, out-of-range or non-number values', () => {
  assert.equal(readLiveSettings({}).sessionLookupRounds, DEFAULT_LOOKUP_ROUNDS)
  for (const value of [99, 11, -1, 'x', 2.5, null]) {
    assert.equal(readLiveSettings({ sessionLookupRounds: value }).sessionLookupRounds, DEFAULT_LOOKUP_ROUNDS, JSON.stringify(value))
  }
})

test('LS-08 [State] a saved round count is read at call time', () => {
  let rounds = 3
  const raw = { sessionLookupRounds: { get: () => rounds } }
  assert.equal(readLiveSettings(raw).sessionLookupRounds, 3)
  rounds = 0
  assert.equal(readLiveSettings(raw).sessionLookupRounds, 0)
})

// ================================================================ client harness

/** Execute the built bundle and capture its module loader payload. */
async function loadClient(windowExtras = {}, extraRequire = {}) {
  let captured = null
  globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, setTimeout, clearTimeout, ...windowExtras }
  await import('../lib/client.js?cachebust=' + String(Date.now()) + Math.random())
  assert.ok(captured !== null, 'bundle must call window.__ModuleLoader__.load')
  return captured.factory((id) => {
    if (id in extraRequire) return extraRequire[id]
    if (id === 'react') return React
    if (id === 'react-dom') return require('react-dom')
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (id === 'react-dom/client') return require('react-dom/client')
    throw new Error('unexpected external: ' + id)
  })
}

/** A fake cordis context; `services` answers ctx.get, `dict` backs the bound translator. */
function fakeCtx(services = {}, dict = {}) {
  const registered = []
  const locales = {}
  const ctx = {
    slots: {
      inject(_seat, fn) { const it = fn(); if (it !== undefined && typeof it.next === 'function') it.next(); return () => {} },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
    locale: {
      register(ns, d) { locales[ns] = d; return () => {} },
      bind() { return (key) => (dict[key] !== undefined ? dict[key] : key) },
    },
    effect(fn) { return fn() },
    get(name) { return services[name] },
  }
  return { ctx, registered, locales }
}

/** Fake host settings primitives (same contract as dsh-client-ui-primitives, as in client.test.mjs). */
function fakePrimitives() {
  class SettingsFormModel {
    constructor(scope, specs) { this.scope = scope; this.fields = specs.map((s) => s.field); this.staged = new Map(); this.listeners = new Set() }
    bind(project) {
      let snap = project()
      const fire = () => { snap = project(); for (const l of this.listeners) l() }
      this.fire = fire
      return { getSnapshot: () => snap, subscribe: (l) => { this.listeners.add(l); return () => this.listeners.delete(l) } }
    }
    shell() { return { available: true, writable: true, dirty: this.staged.size > 0, invalid: false, saving: false, failed: false } }
    field(name) {
      const text = this.staged.has(name) ? this.staged.get(name) : String(this.scope.getSnapshot().value?.[name] ?? '')
      return { text, overridden: false, invalid: false }
    }
    actions() {
      return {
        edit: (f, text) => { this.staged.set(f, text); this.fire() },
        resetField: () => {},
        save: () => { this.saved = Object.fromEntries(this.staged) },
        discard: () => { this.staged.clear(); this.fire() },
      }
    }
    dispose() {}
  }
  const SettingsForm = (props) => React.createElement('form', { 'data-invalid': String(props.state.invalid) }, props.children)
  const SegmentedControl = (props) => React.createElement('div', { 'data-segmented': props.id, 'data-value': props.value })
  const Switch = (props) => React.createElement('button', { role: 'switch', 'aria-checked': props.checked, 'aria-label': props.label, disabled: props.disabled, onClick: () => props.onChange(!props.checked) })
  return { SettingsFormModel, settingsTextField: (field) => ({ field }), settingsNumberField: (field) => ({ field }), SettingsForm, SegmentedControl, Switch }
}

/** Boot with a served settings scope and return the registered settings section. */
async function bootWithSettings(value) {
  const module = await loadClient({}, { '@deepseek-ai/dsh-client-ui-primitives': fakePrimitives() })
  const scope = { getSnapshot: () => ({ status: 'ready', value, writable: true }), subscribe: () => () => {} }
  const { ctx, registered } = fakeCtx({
    configForms: { get: () => scope, whileServed: (_ns, register) => register() },
    remote: { get session() { throw new Error('cannot get property "remote.session" without inject') } },
    'remote.session': { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) },
  })
  await TestRenderer.act(async () => { module.apply(ctx) })
  const entry = registered.find((r) => r.options.name === 'plugins.bundle.config')
  assert.ok(entry !== undefined, 'the settings section is registered')
  return entry
}

async function mount(Component, props) {
  let renderer = null
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Component, props)) })
  return renderer
}

async function mountSection(entry) {
  const face = entry.options.inject()
  const store = face.hooks.smartPromptSettings
  const props = { ...face, view: 'page', t: (k) => k, useSmartPromptSettings: (sel) => sel(store.getSnapshot()) }
  delete props.hooks
  const renderer = await mount(entry.component, props)
  const rerender = async () => { await TestRenderer.act(async () => { renderer.update(React.createElement(entry.component, props)) }) }
  const numberInputs = () => renderer.root.findAll((n) => n.type === 'input' && n.props.type === 'number')
  return { face, store, renderer, rerender, numberInputs }
}

// ================================================================ settings section (G2)

test('LS-09 [EP layout] the settings section renders four number inputs (two Stardea fields since 0.13)', async () => {
  const { numberInputs } = await mountSection(await bootWithSettings({ defaultMode: 'standard', modelSource: 'conversation' }))
  assert.equal(numberInputs().length, 4)
})

test('LS-10 [EP lookup field] the second number input is the lookup-round field: placeholder 3, min 0, max 10', async () => {
  const { numberInputs } = await mountSection(await bootWithSettings({ defaultMode: 'standard', modelSource: 'conversation' }))
  const field = numberInputs()[1]
  assert.equal(field.props.placeholder, '3')
  assert.equal(Number(field.props.min), 0)
  assert.equal(Number(field.props.max), MAX_LOOKUP_ROUNDS)
})

test('LS-11 [EP question field] the first number input keeps placeholder 5 and has no max', async () => {
  const { numberInputs } = await mountSection(await bootWithSettings({ defaultMode: 'standard', modelSource: 'conversation' }))
  const field = numberInputs()[0]
  assert.equal(field.props.placeholder, '5')
  assert.equal(field.props.max, undefined)
})

test('LS-12 [EP edit] setLookupRounds edits the lookup field and the store snapshot', async () => {
  const { face, store, rerender, numberInputs } = await mountSection(await bootWithSettings({ defaultMode: 'standard', modelSource: 'conversation' }))
  assert.equal(typeof face.setLookupRounds, 'function')
  await TestRenderer.act(async () => { face.setLookupRounds('7') })
  await rerender()
  assert.equal(String(store.getSnapshot().lookupRounds), '7')
  assert.equal(String(numberInputs()[1].props.value), '7')
  assert.notEqual(String(numberInputs()[0].props.value), '7', 'the question cap is untouched')
})

test('LS-13 [EP saved value] the lookup field shows the saved round count', async () => {
  const { store, numberInputs } = await mountSection(await bootWithSettings({ defaultMode: 'standard', modelSource: 'conversation', sessionLookupRounds: 4 }))
  assert.equal(String(store.getSnapshot().lookupRounds), '4')
  assert.equal(String(numberInputs()[1].props.value), '4')
})

test('LS-14 [EP input event] typing in the lookup field updates the snapshot', async () => {
  const { store, rerender, numberInputs } = await mountSection(await bootWithSettings({ defaultMode: 'standard', modelSource: 'conversation' }))
  await TestRenderer.act(async () => { numberInputs()[1].props.onChange({ target: { value: '2' }, currentTarget: { value: '2' } }) })
  await rerender()
  assert.equal(String(store.getSnapshot().lookupRounds), '2')
})

/** Set the lookup field to each text and assert the section's invalid flag. */
async function assertLookupValidity(cases) {
  const { face, store, rerender } = await mountSection(await bootWithSettings({ defaultMode: 'standard', modelSource: 'conversation' }))
  for (const [text, invalid] of cases) {
    await TestRenderer.act(async () => { face.setLookupRounds(text) })
    await rerender()
    assert.equal(store.getSnapshot().invalid, invalid, JSON.stringify(text))
  }
}

test('LS-15 [BVA valid] lookup rounds "", "0" and "10" can be saved', async () => {
  await assertLookupValidity([['', false], ['0', false], ['10', false]])
})

test('LS-16 [BVA invalid] lookup rounds "-1", "11" and "2.5" block the save', async () => {
  await assertLookupValidity([['-1', true], ['11', true], ['2.5', true]])
})

test('LS-17 [State] an invalid lookup value fixed back to a valid one unblocks the save', async () => {
  await assertLookupValidity([['11', true], ['10', false], ['-1', true], ['0', false]])
})

// ================================================================ locale (G3)

test('LS-18 [EP en/zh] both locales carry the lookup-round and attachment copy', async () => {
  const module = await loadClient()
  const { ctx, locales } = fakeCtx()
  await TestRenderer.act(async () => { module.apply(ctx) })
  const dict = locales['dsh-smart-prompt']
  assert.ok(dict !== undefined, 'the plugin registers its locale namespace')
  for (const lang of ['en', 'zh']) {
    for (const key of ['settingsLookupRounds', 'settingsLookupRoundsHint', 'err_ATTACHMENTS']) {
      assert.ok(typeof dict[lang]?.[key] === 'string' && dict[lang][key].length > 0, lang + '.' + key)
    }
  }
  assert.equal(dict.en.err_ATTACHMENTS, 'The attachments are not ready yet (a file may still be uploading); try again shortly')
})

// ================================================================ composer button attachments (H)

const ORIGINAL = '把那个接口加上限流'
const REWRITTEN = '为登录接口增加按 IP 的限流，每分钟 60 次。'
const SERIALIZED = [{ type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'shot.png' }, { type: 'file', receiptId: 'r1' }]
const EN_NOT_READY = 'The attachments are not ready yet (a file may still be uploading); try again shortly'
const meta = { mode: 'standard', model: 'p/m', ratio: 1.4, ratioLabel: '1.4x', elapsedMs: 2100, anchors: { total: 0, kept: 0, reinjected: 0 }, note: '', contextUsed: 'none' }
const okReply = () => ({ json: async () => ({ ok: true, text: REWRITTEN, meta }) })
const failReply = () => ({ json: async () => ({ ok: false, code: 'UPSTREAM_X', message: 'gateway exploded' }) })

/** A conversation service whose serializer records the ids it was asked for. */
function fakeConversation(result = { attachments: SERIALIZED }) {
  const asked = []
  return {
    asked,
    serializeDraftAttachments: async (ids) => {
      asked.push(ids)
      if (result instanceof Error) throw result
      return result
    },
  }
}

/** Boot the bundle with optional host services and a translator dictionary. */
async function bootButton(services = {}, dict = {}) {
  const module = await loadClient()
  const { ctx, registered } = fakeCtx(services, dict)
  await TestRenderer.act(async () => { module.apply(ctx) })
  const entry = registered.find((r) => r.options.id === 'dsh-smart-prompt-button')
  const bar = registered.find((r) => r.options.id === 'dsh-smart-prompt-bar').component
  return { entry, button: entry.component, bar }
}

/** Install a fetch stub answering from `replies`; records parsed bodies. */
function stubFetch(replies) {
  const sent = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) })
    const next = replies.shift()
    if (next === undefined) throw new Error('unexpected extra request')
    return next()
  }
  return { sent, restore: () => { globalThis.fetch = original } }
}

const flush = async () => { await TestRenderer.act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)) }) }

/**
 * Mount the composer button the way the host does: the slot's inject() output merged with
 * the input seat props, over a live draft with attachment ids; plus the status bar.
 */
async function mountComposer(env, { attachmentIds = ['a1', 'a2'], idsAbsent = false, injected = true } = {}) {
  const live = { draft: ORIGINAL, attachmentIds, written: [] }
  const actions = { setDraft: (text) => { live.draft = text; live.written.push(text) } }
  const base = injected ? env.entry.options.inject('s1') : { sessionId: 's1' }
  // idsAbsent models an older host whose input state has no attachmentIds key at all.
  const state = () => (idsAbsent ? { draft: live.draft, phase: 'plain' } : { draft: live.draft, attachmentIds: live.attachmentIds, phase: 'plain' })
  const props = () => ({ ...base, useInput: (sel) => sel(state()), inputActions: actions, t: (k) => k })
  live.button = await mount(env.button, props())
  live.bar = await mount(env.bar, { sessionId: 's1', t: (k) => k })
  live.rerender = async () => { await TestRenderer.act(async () => { live.button.update(React.createElement(env.button, props())) }) }
  live.find = (className) => live.button.root.findAllByProps({ className })
  live.click = async () => { await TestRenderer.act(async () => { await live.find('dip-btn')[0].props.onClick() }); await flush() }
  live.barText = () => JSON.stringify(live.bar.toJSON())
  return live
}

test('LS-19 [EP inject] the button entry injects the session id and an attachment serializer', async () => {
  const conversation = fakeConversation()
  const env = await bootButton({ conversation })
  const face = env.entry.options.inject('s9')
  assert.equal(face.sessionId, 's9')
  assert.equal(typeof face.serializeAttachments, 'function')
})

test('LS-20 [EP serializer] serializeAttachments asks the conversation service and resolves to its attachments', async () => {
  const conversation = fakeConversation()
  const env = await bootButton({ conversation })
  const out = await env.entry.options.inject('s1').serializeAttachments(['a1', 'a2'])
  assert.deepEqual(conversation.asked, [['a1', 'a2']])
  assert.deepEqual(out, SERIALIZED)
})

test('LS-21 [EP service missing] serializeAttachments resolves to [] without a conversation service', async () => {
  const env = await bootButton({})
  assert.deepEqual(await env.entry.options.inject('s1').serializeAttachments(['a1']), [])
})

test('LS-22 [EP some attachments] a click with attachment ids posts the serialized attachments with the draft', async () => {
  const conversation = fakeConversation()
  const env = await bootButton({ conversation })
  const net = stubFetch([okReply])
  try {
    const live = await mountComposer(env)
    await live.click()
    assert.equal(net.sent.length, 1)
    assert.equal(net.sent[0].url, '/dsh-smart-prompt/api/improve')
    assert.deepEqual(net.sent[0].body, { sessionId: 's1', text: ORIGINAL, attachments: SERIALIZED })
    assert.deepEqual(conversation.asked, [['a1', 'a2']])
    assert.deepEqual(live.written, [REWRITTEN])
  } finally { net.restore() }
})

test('LS-23 [BVA no attachments] a click without attachment ids posts no attachments key and never serializes', async () => {
  const conversation = fakeConversation()
  const env = await bootButton({ conversation })
  const net = stubFetch([okReply])
  try {
    const live = await mountComposer(env, { attachmentIds: [] })
    await live.click()
    assert.equal(net.sent.length, 1)
    assert.equal('attachments' in net.sent[0].body, false)
    assert.equal(conversation.asked.length, 0)
  } finally { net.restore() }
})

test('LS-24 [EP ids absent] a host input state without attachmentIds posts no attachments key', async () => {
  const conversation = fakeConversation()
  const env = await bootButton({ conversation })
  const net = stubFetch([okReply])
  try {
    const live = await mountComposer(env, { idsAbsent: true })
    await live.click()
    assert.equal(net.sent.length, 1)
    assert.equal('attachments' in net.sent[0].body, false)
    assert.equal(conversation.asked.length, 0)
  } finally { net.restore() }
})

test('LS-25 [EP no serializer prop] attachment ids without a serializeAttachments prop post no attachments key', async () => {
  const env = await bootButton({ conversation: fakeConversation() })
  const net = stubFetch([okReply])
  try {
    const live = await mountComposer(env, { injected: false })
    await live.click()
    assert.equal(net.sent.length, 1)
    assert.equal('attachments' in net.sent[0].body, false)
  } finally { net.restore() }
})

test('LS-26 [EP serializer rejects] a still-uploading attachment makes no request and shows err_ATTACHMENTS', async () => {
  const conversation = fakeConversation(new Error('upload pending'))
  const env = await bootButton({ conversation }, { err_ATTACHMENTS: EN_NOT_READY })
  const net = stubFetch([okReply])
  try {
    const live = await mountComposer(env)
    await live.click()
    assert.equal(net.sent.length, 0, 'no fetch is made')
    assert.deepEqual(live.written, [], 'the draft is untouched')
    assert.ok(live.barText().includes(EN_NOT_READY), live.barText())
    const bubble = live.bar.root.findAll((n) => n.props.className === 'dip-bar')
    assert.equal(bubble[0]?.props['data-kind'], 'error')
  } finally { net.restore() }
})

test('LS-27 [State done->retry] Retry on the Revert|Retry capsule re-sends the attachments', async () => {
  const conversation = fakeConversation()
  const env = await bootButton({ conversation })
  const net = stubFetch([okReply, okReply])
  try {
    const live = await mountComposer(env)
    await live.click()
    await live.rerender()
    assert.equal(live.find('dip-retry').length, 1, 'the capsule shows Retry')
    await TestRenderer.act(async () => { live.find('dip-retry')[0].props.onClick({ preventDefault() {}, stopPropagation() {} }) })
    await flush()
    assert.equal(net.sent.length, 2)
    assert.equal(net.sent[1].body.text, ORIGINAL)
    assert.deepEqual(net.sent[1].body.attachments, SERIALIZED)
  } finally { net.restore() }
})

test('LS-28 [State error->retry] Retry in the error bubble re-sends the attachments', async () => {
  const conversation = fakeConversation()
  const env = await bootButton({ conversation })
  const net = stubFetch([failReply, okReply])
  try {
    const live = await mountComposer(env)
    await live.click()
    const retry = live.bar.root.findAll((n) => n.props.className === 'dip-bar-retry' && typeof n.type === 'string')
    assert.equal(retry.length, 1, 'the error bubble offers Retry')
    await TestRenderer.act(async () => { retry[0].props.onClick({ preventDefault() {}, stopPropagation() {} }) })
    await flush()
    assert.equal(net.sent.length, 2)
    assert.equal(net.sent[1].body.text, ORIGINAL)
    assert.deepEqual(net.sent[1].body.attachments, SERIALIZED)
    assert.deepEqual(live.written, [REWRITTEN])
  } finally { net.restore() }
})
