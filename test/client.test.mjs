import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer from 'react-test-renderer'

const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/**
 * Load the BUILT client bundle the way the harness does: execute the file, capture
 * the window.__ModuleLoader__.load({id, factory}) payload, and run the factory with
 * a require that resolves only the declared externals.
 */
async function loadClientModule() {
  let captured = null
  const store = new Map()
  globalThis.window = {
    __ModuleLoader__: { load: (m) => { captured = m } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)) },
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  }
  await import('../lib/client.js?cachebust=' + String(Date.now()))
  assert.ok(captured !== null, 'bundle must call window.__ModuleLoader__.load')
  const module = captured.factory((id) => {
    if (id === 'react') return React
    if (id === 'react-dom') return require('react-dom')
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (id === 'react-dom/client') return require('react-dom/client')
    throw new Error('unexpected external: ' + id)
  })
  return { id: captured.id, module }
}

/** Copy a real locale registration would provide; anything absent is "unregistered". */
const DICT = { err_LENGTH_EXCEEDED: '已保留原文（本地化文案）' }

function fakeCtx() {
  const registered = []
  const ctx = {
    slots: {
      inject(seat, fn) {
        const iterator = fn()
        if (iterator !== undefined && typeof iterator.next === 'function') iterator.next()
        return () => {}
      },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
    locale: {
      register() { return () => {} },
      bind() { return (key) => (DICT[key] !== undefined ? DICT[key] : key) },
    },
    effect(fn) { return fn() },
    get() { return undefined },
  }
  return { ctx, registered }
}

/** Props a conversation renderer injects into a session-scoped composer entry. */
function seatProps(over = {}) {
  const draft = over.draft !== undefined ? over.draft : '把那个接口加上限流'
  return {
    sessionId: 's1',
    useInput: (selector) => selector({ draft, phase: 'plain' }),
    inputActions: over.inputActions !== undefined ? over.inputActions : { setDraft() {} },
    t: (key) => key,
    ...over,
  }
}

/** Mount an entry through a real React root so hooks work. */
async function mount(Component, props) {
  let renderer = null
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(Component, props))
  })
  return renderer
}

/** Boot the bundle and hand back the two registered entries. */
async function boot() {
  const { id, module } = await loadClientModule()
  const { ctx, registered } = fakeCtx()
  await TestRenderer.act(async () => { module.apply(ctx) })
  return { id, module, registered, button: registered[0].component, bar: registered[1].component }
}

/** A canned successful host reply. */
function okResponse(over = {}) {
  return {
    json: async () => ({
      ok: true,
      text: '为登录接口增加按 IP 的限流，每分钟 60 次。',
      meta: {
        mode: 'standard', model: 'p/m', ratio: 1.4, ratioLabel: '1.4x', elapsedMs: 2100,
        anchors: { total: 3, kept: 3, reinjected: 0 }, note: '', contextUsed: 'none',
        ...(over.meta !== undefined ? over.meta : {}),
      },
    }),
  }
}

test('the built bundle registers exactly the two composer entries under the right ids', async () => {
  const { id, module, registered } = await boot()
  assert.equal(id, 'dsh-improve-prompt')
  assert.deepEqual(module.inject, ['slots', 'locale'])
  assert.equal(registered.length, 2)
  assert.deepEqual(registered.map((r) => r.options.name), ['conversation.input.right', 'conversation.input.overlay'])
  assert.deepEqual(registered.map((r) => r.options.id), ['dsh-improve-prompt-button', 'dsh-improve-prompt-bar'])
  for (const entry of registered) {
    assert.equal(entry.options.locale, 'dsh-improve-prompt', 'every entry is localizable')
    assert.deepEqual(entry.options.inject('s9'), { sessionId: 's9' }, 'the session id reaches the component')
  }
})

test('the button renders enabled with a draft and disabled on an empty composer or a slash command', async () => {
  const { button } = await boot()

  const enabled = await mount(button, seatProps())
  const enabledBtn = enabled.root.findAllByProps({ className: 'dip-btn' })[0]
  assert.equal(enabledBtn.props.disabled, false)
  assert.equal(enabled.root.findAllByProps({ className: 'dip-chevron' }).length, 0, 'no mode switch on the button')

  const empty = await mount(button, seatProps({ draft: '   ' }))
  assert.equal(empty.root.findAllByProps({ className: 'dip-btn' })[0].props.disabled, true)

  // A bare command has no body — nothing to rewrite. (A command WITH a body is
  // enhancable; that case is covered by the slash-command test below.)
  const command = await mount(button, seatProps({ draft: '/help' }))
  assert.equal(command.root.findAllByProps({ className: 'dip-btn' })[0].props.disabled, true)
  assert.equal(command.root.findAllByProps({ className: 'dip-btn' })[0].props.title, 'commandOnlyTitle')
})

test('a slash command with a body stays clickable, a bare command does not', async () => {
  const { button } = await boot()

  // The case that used to be blocked by mistake: /bugfix <正文> has a real body.
  const withBody = await mount(button, seatProps({ draft: '/bugfix ISS-202607-00090605A 填充后密码框被清空' }))
  assert.equal(withBody.root.findAllByProps({ className: 'dip-btn' })[0].props.disabled, false,
    'a command carrying a body must be enhancable')
  assert.equal(withBody.root.findAllByProps({ className: 'dip-btn' })[0].props.title, 'buttonTitleCommand',
    'and the tooltip says the prefix is preserved')

  // A command with nothing after it still has nothing to rewrite.
  const bare = await mount(button, seatProps({ draft: '/bugfix' }))
  assert.equal(bare.root.findAllByProps({ className: 'dip-btn' })[0].props.disabled, true)
  // The locale key is the contract; the copy itself lives in locales.ts.
  assert.equal(bare.root.findAllByProps({ className: 'dip-btn' })[0].props.title, 'commandOnlyTitle')

  const blankCommand = await mount(button, seatProps({ draft: '/bugfix   ' }))
  assert.equal(blankCommand.root.findAllByProps({ className: 'dip-btn' })[0].props.disabled, true)
})

test('clicking on a slash-command draft sends only the body', async () => {
  const { button } = await boot()
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => { calls.push(JSON.parse(options.body)); return okResponse() }
  try {
    const renderer = await mount(button, seatProps({ draft: '/bugfix 把登录接口改快一点' }))
    await TestRenderer.act(async () => { await renderer.root.findAllByProps({ className: 'dip-btn' })[0].props.onClick() })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].text, '/bugfix 把登录接口改快一点', 'the full draft goes to the host, which owns the split')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the button still renders on a host that only provides a point-in-time input snapshot', async () => {
  const { button } = await boot()
  const renderer = await mount(button, {
    sessionId: 's1',
    input: { draft: '老宿主草稿' },
    inputActions: { setDraft() {} },
    t: (key) => key,
  })
  assert.equal(renderer.root.findAllByProps({ className: 'dip-btn' })[0].props.disabled, false)
})

test('clicking posts the draft and writes the enhanced text back', async () => {
  const { button } = await boot()
  let written = null
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return okResponse() }
  try {
    const renderer = await mount(button, seatProps({ inputActions: { setDraft: (text) => { written = text } } }))
    await TestRenderer.act(async () => { await renderer.root.findAllByProps({ className: 'dip-btn' })[0].props.onClick() })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/dsh-improve-prompt/api/improve')
    assert.equal(calls[0].body.sessionId, 's1')
    assert.equal(calls[0].body.mode, undefined, 'the host reads the mode from the plugin settings')
    assert.equal(calls[0].body.text, '把那个接口加上限流')
    assert.equal(written, '为登录接口增加按 IP 的限流，每分钟 60 次。')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a failed call never touches the draft and surfaces localized copy', async () => {
  const { button, bar } = await boot()
  let written = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, code: 'LENGTH_EXCEEDED', message: 'host copy' }) })
  try {
    const renderer = await mount(button, seatProps({ inputActions: { setDraft: (text) => { written = text } } }))
    await TestRenderer.act(async () => { await renderer.root.findAllByProps({ className: 'dip-btn' })[0].props.onClick() })
    assert.equal(written, null, 'the draft must not be touched on failure')

    // The status bar renders the LOCALIZED copy for a registered code — the harness
    // convention is that an unregistered key comes back unchanged.
    const barRenderer = await mount(bar, { sessionId: 's1', t: (key) => key })
    const text = JSON.stringify(barRenderer.toJSON())
    assert.match(text, /dip-bar/)
    assert.match(text, /已保留原文（本地化文案）/, 'the code is localized, not echoed from the host')
    assert.ok(!text.includes('host copy'), 'the host copy is only the fallback')
  } finally {
    globalThis.fetch = originalFetch
  }
})

/** Mount the composer button over a live draft that setDraft really rewrites. */
async function mountLive(button, initial) {
  const live = { draft: initial, sent: [] }
  const actions = { setDraft: (text) => { live.draft = text } }
  const props = () => seatProps({ draft: live.draft, inputActions: actions })
  live.renderer = await mount(button, props())
  live.rerender = async () => { await TestRenderer.act(async () => { live.renderer.update(React.createElement(button, props())) }) }
  live.find = (className) => live.renderer.root.findAllByProps({ className })
  return live
}

const REFINED = '为登录接口增加按 IP 的限流，每分钟 60 次。'

test('after a refine the composer button becomes the Revert | Retry capsule', async () => {
  const { button, bar } = await boot()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => okResponse({ meta: { contextUsed: 'anaphora' } })
  try {
    const live = await mountLive(button, '把那个接口加上限流')
    await TestRenderer.act(async () => { await live.find('dip-btn')[0].props.onClick() })
    assert.equal(live.draft, REFINED)
    await live.rerender()

    assert.equal(live.find('dip-btn').length, 0, 'the star is replaced while the refined text is untouched')
    assert.equal(live.find('dip-revert').length, 1)
    assert.equal(live.find('dip-retry').length, 1)
    assert.equal(live.find('dip-capsule-icon').length, 2, 'each half carries its icon')

    const barRenderer = await mount(bar, { sessionId: 's1', t: (key) => key })
    const shown = JSON.stringify(barRenderer.toJSON())
    assert.match(shown, /dip-bar/)
    assert.match(shown, /1\.4x/)
    assert.match(shown, /contextTag/)
    assert.doesNotMatch(shown, /dip-revert|dip-retry/, 'the bar no longer carries the buttons')

    await TestRenderer.act(async () => { live.find('dip-revert')[0].props.onClick() })
    assert.equal(live.draft, '把那个接口加上限流', 'Revert puts the original draft back')
    await live.rerender()
    assert.equal(live.find('dip-btn').length, 1, 'after Revert the star returns')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the status bubble slides in, then stays mounted to slide out before unmounting', async () => {
  const { button, bar } = await boot()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => okResponse()
  try {
    const live = await mountLive(button, '把那个接口加上限流')
    const barRenderer = await mount(bar, { sessionId: 's1', t: (key) => key })
    await TestRenderer.act(async () => { await live.find('dip-btn')[0].props.onClick() })
    const entering = barRenderer.root.findAllByProps({ className: 'dip-bar' })
    assert.equal(entering.length, 1)
    assert.equal(entering[0].props['data-state'], 'entering')

    await live.rerender()
    await TestRenderer.act(async () => { live.find('dip-revert')[0].props.onClick() })
    const leaving = barRenderer.root.findAllByProps({ className: 'dip-bar' })
    assert.equal(leaving.length, 1, 'the hidden bubble stays mounted for its exit animation')
    assert.equal(leaving[0].props['data-state'], 'leaving')

    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)) })
    assert.equal(barRenderer.toJSON(), null, 'it unmounts once the exit has played')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('editing the refined draft returns the composer button to the star', async () => {
  const { button } = await boot()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => okResponse()
  try {
    const live = await mountLive(button, '把那个接口加上限流')
    await TestRenderer.act(async () => { await live.find('dip-btn')[0].props.onClick() })
    await live.rerender()
    assert.equal(live.find('dip-revert').length, 1)

    live.draft = REFINED + ' 另外加日志'
    await live.rerender()
    assert.equal(live.find('dip-revert').length, 0)
    assert.equal(live.find('dip-btn').length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pressing any chip button does not take focus from the composer', async () => {
  const { button } = await boot()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => okResponse()
  try {
    const live = await mountLive(button, '把那个接口加上限流')
    const pressed = (className) => {
      let prevented = false
      live.find(className)[0].props.onMouseDown({ preventDefault: () => { prevented = true } })
      return prevented
    }
    assert.equal(pressed('dip-btn'), true, 'main button keeps the caret in the composer')
    await TestRenderer.act(async () => { await live.find('dip-btn')[0].props.onClick() })
    await live.rerender()
    assert.equal(pressed('dip-revert'), true)
    assert.equal(pressed('dip-retry'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Retry regenerates from the original draft, not the refined text', async () => {
  const { button } = await boot()
  const sent = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body).text)
    return okResponse()
  }
  try {
    const live = await mountLive(button, '把那个接口加上限流')
    await TestRenderer.act(async () => { await live.find('dip-btn')[0].props.onClick() })
    await live.rerender()
    await TestRenderer.act(async () => { live.find('dip-retry')[0].props.onClick(); await new Promise((r) => setTimeout(r, 0)) })

    assert.equal(sent.length, 2, 'Retry issues a second request')
    assert.equal(sent[1], '把那个接口加上限流', 'Retry sends the pre-refine draft')
    assert.equal(live.draft, REFINED)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('an unregistered error code falls back to the host message', async () => {
  const { button, bar } = await boot()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, code: 'SOMETHING_NEW', message: 'host copy' }) })
  try {
    const renderer = await mount(button, seatProps({ inputActions: { setDraft() {} } }))
    await TestRenderer.act(async () => { await renderer.root.findAllByProps({ className: 'dip-btn' })[0].props.onClick() })
    const barRenderer = await mount(bar, { sessionId: 's1', t: (key) => key })
    assert.match(JSON.stringify(barRenderer.toJSON()), /host copy/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the status bar renders nothing while idle', async () => {
  const { bar } = await boot()
  const renderer = await mount(bar, { sessionId: 'never-used', t: (key) => key })
  assert.equal(renderer.toJSON(), null)
})

test('a cancellation aborts the in-flight request instead of writing anything', async () => {
  const { button } = await boot()
  let seenSignal = null
  let written = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    seenSignal = options.signal
    return okResponse()
  }
  try {
    const renderer = await mount(button, seatProps({ inputActions: { setDraft: (text) => { written = text } } }))
    await TestRenderer.act(async () => { await renderer.root.findAllByProps({ className: 'dip-btn' })[0].props.onClick() })
    assert.ok(seenSignal !== null && seenSignal.aborted === false, 'the request carries a live AbortSignal')
    assert.equal(written, '为登录接口增加按 IP 的限流，每分钟 60 次。')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the button is a single action: one capsule holding only the sparkle', async () => {
  const { button } = await boot()
  const renderer = await mount(button, seatProps())

  const chip = renderer.root.findAllByProps({ className: 'dip-root' })
  assert.equal(chip.length, 1)
  const chipChildren = chip[0].children.map((c) => (typeof c === 'string' ? c : c.props.className))
  assert.deepEqual(chipChildren, ['dip-btn'], 'no mode switch, divider or decoration layers')

  const main = renderer.root.findAllByProps({ className: 'dip-btn' })[0]
  assert.deepEqual(main.children.map((c) => (typeof c === 'string' ? c : c.props.className)), ['dip-icon'], 'icon only, no mode label')
  assert.equal(main.props['aria-label'], 'buttonAria', 'the accessible name no longer names a mode')
  assert.equal(renderer.root.findAllByProps({ className: 'dip-icon' })[0].props['aria-hidden'], 'true')
  assert.ok(!JSON.stringify(renderer.toJSON()).includes('dip-spark-grad'), 'the icon has no gradient')
})

test('the stylesheet is a plain capsule in host tokens', async () => {
  const fs = await import('node:fs')
  const css = fs.readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')

  assert.match(css, /\.dip-root\{[^}]*border:1px solid var\(--dsw-alias-border-l2\);border-radius:999px/, 'capsule outline in the host border token')
  assert.match(css, /HOVER_BG = 'var\(--dsw-alias-interactive-bg-hover\)'/, 'hover uses the host hover token')
  // no hover expansion and no glow/light layers
  assert.ok(!/EXPANDED|max-width:0|dip-aurora|dip-ring|dip-burst|dip-attract|conic-gradient|drop-shadow/.test(css), 'no fancy effects')
  assert.ok(!/\.dip-root:hover\{/.test(css), 'hovering the capsule changes nothing about its size or glow')
  assert.ok(!/#[0-9a-f]{6}/i.test(css.slice(0, css.indexOf('status bar'))), 'button colours come from host tokens only')
  assert.match(css, /prefers-reduced-motion: reduce/)
})

test('the injected stylesheet is scoped by a plugin data attribute', async () => {
  const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
  assert.match(source, /data-plugin/)
  assert.match(source, /dsh-improve-prompt/)
})
/**
 * Fake host primitives with the same contract as dsh-client-ui-primitives: a staged
 * form model over a scope, and pass-through form/segmented components.
 */
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
  return { SettingsFormModel, settingsTextField: (field) => ({ field }), SettingsForm, SegmentedControl }
}

async function bootWithSettings(value) {
  const { module } = await loadClientModuleWith(fakePrimitives())
  const { ctx, registered } = fakeCtx()
  const scope = { getSnapshot: () => ({ status: 'ready', value, writable: true }), subscribe: () => () => {} }
  ctx.get = (name) => {
    if (name === 'configForms') return { get: (id) => { assert.equal(id, 'dsh-improve-prompt'); return scope }, whileServed: (_ns, register) => register() }
    if (name === 'remote') return { session: { modelCatalog: async () => ({ ok: true, value: { groups: [{ id: 'p', name: 'Provider', models: [{ id: 'm1', name: 'Model One', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }] }] } }) } }
    return undefined
  }
  await TestRenderer.act(async () => { module.apply(ctx) })
  return registered.find((r) => r.options.name === 'plugins.bundle.config')
}

/** loadClientModule, but the loader's require also resolves the host primitives. */
async function loadClientModuleWith(primitives) {
  let captured = null
  globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, setTimeout, clearTimeout }
  await import('../lib/client.js?cachebust=' + String(Date.now()) + Math.random())
  const module = captured.factory((id) => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error('unexpected external: ' + id)
  })
  return { module }
}

async function mountSection(entry) {
  const face = entry.options.inject()
  const store = face.hooks.improvePromptSettings
  const props = { ...face, view: 'page', t: (k) => k, useImprovePromptSettings: (sel) => sel(store.getSnapshot()) }
  delete props.hooks
  const renderer = await mount(entry.component, props)
  const rerender = async () => { await TestRenderer.act(async () => { renderer.update(React.createElement(entry.component, props)) }) }
  return { face, store, renderer, rerender }
}

test('the settings section registers on the plugin page only when the host serves it', async () => {
  const { registered } = await boot()
  assert.equal(registered.some((r) => r.options.name === 'plugins.bundle.config'), false, 'no settings section without configForms')
  const entry = await bootWithSettings({ defaultMode: 'standard', modelSource: 'conversation' })
  assert.ok(entry !== undefined)
  assert.equal(entry.options.key, 'dsh-improve-prompt', 'keyed by package name')
})

test('the section shows the mode and model-source choices from the saved settings', async () => {
  const entry = await bootWithSettings({ defaultMode: 'light', modelSource: 'conversation' })
  const { renderer } = await mountSection(entry)
  const segmented = renderer.root.findAll((n) => n.props['data-segmented'] !== undefined)
  assert.deepEqual(segmented.map((n) => n.props['data-value']), ['light', 'conversation'])
  assert.equal(renderer.root.findAll((n) => n.type === 'select').length, 0, 'no model picker for the conversation source')
})

test('choosing a dedicated model stages provider, model and its default effort', async () => {
  const entry = await bootWithSettings({ defaultMode: 'standard', modelSource: 'conversation' })
  const { face, store, renderer, rerender } = await mountSection(entry)
  await TestRenderer.act(async () => { face.setSource('dedicated'); await new Promise((r) => setTimeout(r, 0)) })
  await rerender()
  assert.equal(store.getSnapshot().invalid, true, 'dedicated without a model blocks the save')
  const [modelSelect] = renderer.root.findAll((n) => n.type === 'select')
  await TestRenderer.act(async () => { modelSelect.props.onChange({ target: { value: 'p\u0000m1' } }) })
  await rerender()
  const state = store.getSnapshot()
  assert.deepEqual([state.source, state.provider, state.model, state.effort], ['dedicated', 'p', 'm1', 'low'])
  assert.equal(state.invalid, false)
  const selects = renderer.root.findAll((n) => n.type === 'select')
  assert.equal(selects.length, 2, 'the chosen model offers its reasoning efforts')
})
