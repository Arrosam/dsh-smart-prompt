// Black-box tests for the third optimization mode, `detailed`. It must behave exactly
// like `standard` — same registration, configuration mechanism, length ceiling and
// optional acceptance-criteria clause — and differ only in its prompt template,
// `prompts/detailed.md`. Expectations come from the mode's requirements, not from the
// implementation.
//
// Techniques:
//  - EP: config schema/resolvers, HTTP endpoints, shipped prompt files, mode values.
//  - Decision table: mode x length cap (standard vs light); mode x acceptanceCriteria.
//  - BVA: a rewrite just over the positive ceiling and one at it; a very long rewrite
//    under the default uncapped setting.
//  - State: saved defaultMode `detailed`; invalid request mode falls back to it.
//  - Semantic prompt checks: the four required instruction ideas, tolerant to edits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { apply } from '../lib/index.js'
import { Config, readLiveSettings, resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'
import { userPromptDir } from '../lib/prompts.js'

const API = '/dsh-smart-prompt/api'
// Short draft with no hard facts, so the fidelity gate stays silent and the length
// gate alone decides.
const DRAFT = '把这个模块重构一下做得更清晰一些，另外再看下有没有多余的东西'
// 400 chars, no hard facts: at standardMaxRatio 2.5 the budget is max(600, 400*2.5).
const LONG_DRAFT = '请整理'.repeat(133) + '一'
// No hard facts in the reply either: no repair call will be needed.
const REWRITE = '先梳理模块职责，再按步骤重构并删除多余代码。'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// ================================================================ harness

/** Scripted model: each entry is one reply text; records every request. */
function stubLlm(replies) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      const text = replies.length > 0 ? replies.shift() : ''
      return (async function* () {
        if (text !== '') yield { type: 'text-delta', index: 0, text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** Run one refinement from lib/orchestrate.js against a stub model. */
function runImprove(llm, cfg, over = {}) {
  return improveDraft(
    { llm, selection: { provider: 'p', model: 'm' }, lastRoute: null },
    cfg,
    { draft: DRAFT, sessionId: '', mode: 'detailed', signal: new AbortController().signal, ...over },
  )
}

/** System prompt the model actually received for one mode. */
async function systemFor(mode, over = {}) {
  const llm = stubLlm([REWRITE])
  const out = await runImprove(llm, resolveConfig(over), { mode })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 1, 'the rewrite needs exactly one model call')
  return llm.calls[0].system
}

/** The effective, user-editable prompt file (a DSH_HOME override wins, as in production). */
const promptFile = (name) => {
  const shipped = new URL('../prompts/' + name + '.md', import.meta.url)
  for (const candidate of [join(userPromptDir(), name + '.md'), shipped]) {
    try {
      const text = readFileSync(candidate, 'utf8')
      if (text.trim() !== '') return text.trim()
    } catch { /* try the next candidate */ }
  }
  assert.fail('prompt file not found or empty: ' + name + '.md')
}

/** Apply the plugin against stub host services; returns the registered route. */
function mountPlugin(rawConfig, services = {}) {
  const routes = []
  const llm = services.llm ?? stubLlm(Array(10).fill(REWRITE))
  const all = {
    llm,
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    ...services,
  }
  const ctx = {
    logger: { warn() {} },
    on() {},
    effect(fn) { return fn() },
    get: (name) => all[name],
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  apply(ctx, rawConfig)
  assert.equal(routes.length, 1, 'the plugin registers one HTTP route')
  return { route: routes[0], llm }
}

/** Drive the route with a fake request; `body` is a string or omitted (no body). */
async function request(route, method, path, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = path
  const res = new EventEmitter()
  const reply = { status: 0, headers: null, json: null }
  res.writableEnded = false
  res.writeHead = (status, headers) => { reply.status = status; reply.headers = headers }
  res.end = (text) => { res.writableEnded = true; reply.json = JSON.parse(text) }
  const done = route.handler(req, res)
  if (body !== undefined) req.emit('data', Buffer.from(body, 'utf8'))
  req.emit('end')
  await done
  return reply
}

const improve = (over = {}) => JSON.stringify({ text: DRAFT, ...over })

// ================================================================ 1. configuration

test('DM-01 [EP] the Config schema and both live resolvers accept defaultMode "detailed"', () => {
  // The schema must accept the identifier (unknown values throw).
  let schema
  assert.doesNotThrow(() => { schema = Config({ defaultMode: 'detailed' }) })
  assert.equal(resolveConfig(schema).defaultMode, 'detailed', 'the schema value resolves to detailed')
  assert.equal(readLiveSettings(schema).mode, 'detailed', 'the schema value is live as detailed')
  // Plain values and the settings page's volatile references both work.
  for (const raw of [{ defaultMode: 'detailed' }, { defaultMode: { get: () => 'detailed' } }]) {
    assert.equal(resolveConfig(raw).defaultMode, 'detailed', JSON.stringify(raw))
    assert.equal(readLiveSettings(raw).mode, 'detailed', JSON.stringify(raw))
  }
})

// ================================================================ 2. HTTP config route

test('DM-02 [EP] GET config advertises "detailed" and gives it the standard maxRatio', async () => {
  const { route } = mountPlugin({ defaultMode: 'detailed' })
  const reply = await request(route, 'GET', API + '/config')
  assert.equal(reply.status, 200)
  assert.equal(reply.json.ok, true, JSON.stringify(reply.json))
  assert.ok(Array.isArray(reply.json.modes), 'modes is a list')
  assert.ok(reply.json.modes.includes('detailed'), 'the public mode list includes detailed')
  assert.equal(reply.json.defaultMode, 'detailed', 'the saved detailed mode is reported')
  assert.ok(reply.json.maxRatio !== null && typeof reply.json.maxRatio === 'object', 'maxRatio is a map')
  assert.equal(reply.json.maxRatio.detailed, reply.json.maxRatio.standard, 'detailed shares standard\'s ceiling')
  // Defaults from the requirements: light 2, standard (and therefore detailed) 0.
  assert.equal(reply.json.maxRatio.light, 2)
  assert.equal(reply.json.maxRatio.detailed, 0)
})

// ================================================================ 3. HTTP improve route

test('DM-03 [EP] POST improve with mode "detailed" succeeds and reports meta.mode "detailed"', async () => {
  const llm = stubLlm([REWRITE])
  const { route } = mountPlugin(undefined, { llm })
  const reply = await request(route, 'POST', API + '/improve', improve({ mode: 'detailed' }))
  assert.equal(reply.status, 200)
  assert.equal(reply.json.ok, true, JSON.stringify(reply.json))
  assert.equal(reply.json.text, REWRITE)
  assert.equal(reply.json.meta.mode, 'detailed')
  assert.equal(llm.calls.length, 1, 'a clean rewrite costs exactly one model call')
})

// ================================================================ 4. length ceiling parity

test('DM-04 [Decision length] detailed is capped by standardMaxRatio exactly like standard', async () => {
  // light is deliberately given a much higher ratio: detailed must not use it.
  const cfg = resolveConfig({ standardMaxRatio: 2.5, lightMaxRatio: 10 })
  const over = () => ['x'.repeat(1001), 'y'.repeat(1001)]

  const detailedLlm = stubLlm(over())
  const detailed = await runImprove(detailedLlm, cfg, { mode: 'detailed', draft: LONG_DRAFT })
  const standardLlm = stubLlm(over())
  const standard = await runImprove(standardLlm, cfg, { mode: 'standard', draft: LONG_DRAFT })

  assert.equal(standard.ok, false, 'control: standard refuses the over-ceiling rewrite')
  assert.equal(standard.code, 'LENGTH_EXCEEDED')
  assert.equal(detailed.ok, false, 'detailed refuses it too')
  assert.equal(detailed.code, 'LENGTH_EXCEEDED')
  assert.equal(detailed.code, standard.code, 'same refusal code as standard')
  assert.equal(detailedLlm.calls.length, 2, 'one rewrite + one length repair, like standard')
  assert.equal(standardLlm.calls.length, 2)
  assert.match(detailed.message, /1001/, 'the refusal names the final length')
  assert.match(detailed.message, /1000/, 'the refusal names the standard-derived budget')

  // Exactly at the standard-derived budget (400 * 2.5) is accepted with one call.
  const withinLlm = stubLlm(['x'.repeat(1000)])
  const within = await runImprove(withinLlm, cfg, { mode: 'detailed', draft: LONG_DRAFT })
  assert.equal(within.ok, true, JSON.stringify(within))
  assert.equal(withinLlm.calls.length, 1)
})

test('DM-05 [BVA length] uncapped detailed (default standardMaxRatio 0) accepts a very long rewrite', async () => {
  const cfg = resolveConfig({})
  assert.equal(cfg.standardMaxRatio, 0, 'the default ceiling is uncapped')
  const long = 'x'.repeat(5000)
  const llm = stubLlm([long])
  const out = await runImprove(llm, cfg, { mode: 'detailed' })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.text, long)
  assert.equal(llm.calls.length, 1, 'no length repair under the uncapped setting')
})

// ================================================================ 5. acceptance-criteria clause

test('DM-06 [Decision acceptance] acceptanceCriteria appends the clause to detailed like standard, never to light', async () => {
  const [detailed, standard, light] = await Promise.all([
    systemFor('detailed', { acceptanceCriteria: true }),
    systemFor('standard', { acceptanceCriteria: true }),
    systemFor('light', { acceptanceCriteria: true }),
  ])
  // The discipline layer itself mentions "acceptance criteria", so compare what each
  // prompt appends AFTER its own mode template: that is the optional clause.
  const tailAfter = (system, mode) => {
    const template = promptFile(mode)
    const at = system.indexOf(template)
    assert.ok(at >= 0, mode + ': the mode template is present')
    return system.slice(at + template.length)
  }
  const detailedTail = tailAfter(detailed, 'detailed')
  const standardTail = tailAfter(standard, 'standard')
  assert.equal(detailedTail, standardTail, 'both restructuring modes append the same acceptance clause')
  assert.match(detailedTail, /acceptance/i, 'detailed: carries the acceptance-criteria clause')
  assert.match(detailedTail, /verif(?:y|ied|ication)/i, 'detailed: says how the result is verified')
  assert.doesNotMatch(tailAfter(light, 'light'), /acceptance|verif(?:y|ied|ication)/i, 'light gets no acceptance clause')
  assert.doesNotMatch(light, /verif(?:y|ied|ication)/i, 'light gets no verification wording at all')
  assert.notEqual(detailed, standard, 'the detailed template is still different')
})

// ================================================================ 6. prompt wiring

test('DM-07 [EP prompt source] detailed requests send prompts/detailed.md under the shared discipline layer', async () => {
  const detailed = await systemFor('detailed')
  const standard = await systemFor('standard')
  const detailedTemplate = promptFile('detailed')
  const standardTemplate = promptFile('standard')
  const discipline = promptFile('discipline')

  assert.ok(detailedTemplate.length > 0, 'prompts/detailed.md must exist and not be empty')
  assert.notEqual(detailed, standard, 'detailed must not send the standard system prompt')
  assert.ok(detailed.includes(detailedTemplate), 'the detailed template is wired from prompts/detailed.md')
  assert.ok(!detailed.includes(standardTemplate), 'detailed must not reuse the standard template')
  assert.ok(standard.includes(standardTemplate), 'control: standard uses its own template')
  assert.ok(detailed.includes(discipline), 'the shared discipline layer still wraps the detailed template')
})

test('DM-08 [EP prompt semantics] prompts/detailed.md asks for steps, cautions, per-detail standards, and no guessing', async () => {
  const system = await systemFor('detailed')
  const anyMatch = (patterns) => patterns.some((re) => re.test(system))
  const message = (what) => 'the detailed prompt must require ' + what + '; prompt excerpt: ' + system.slice(0, 600)

  // 1. What to do next: ordered next steps.
  assert.ok(anyMatch([
    /\bnext steps?\b/i,
    /\bsteps?\b[^.\n]{0,40}\b(?:to do|to take|to follow|do next)\b/i,
    /\bwhat to do\b/i,
    /下一步/,
    /接下来的(?:操作|步骤|动作)/,
    /(?:操作|执行)?步骤/,
  ]), message('the next steps to take'))

  // 2. Cautions and things to watch out for during execution.
  assert.ok(anyMatch([
    /\bcautions?\b/i,
    /\bthings? to (?:watch(?: out)? for|avoid|note|be careful about|look out for)\b/i,
    /\bwatch out\b/i,
    /\bpitfalls?\b/i,
    /注意事项/,
    /注意点/,
    /小心/,
    /警惕/,
    /风险/,
    /坑/,
  ]), message('cautions / things to watch out for'))

  // 3. A concrete standard/criterion for every detail, not just an overall goal.
  assert.ok(anyMatch([
    /\b(?:standard|criteri(?:a|on)|acceptance)\b[^.\n]{0,100}\b(?:every|each|all|per)\b[^.\n]{0,60}\bdetails?\b/i,
    /\b(?:every|each|all|per)\b[^.\n]{0,60}\b(?:concrete\s+)?details?\b[^.\n]{0,100}\b(?:standard|criteri(?:a|on)|acceptance)\b/i,
    /\b(?:every|each|all|per)\b[^.\n]{0,40}\bdetails?\b[^.\n]{0,60}\b(?:exact|specific|concrete|defined)\b/i,
    /每个(?:具体)?细节[^\n。]{0,80}(?:标准|准则|要求|验收|怎样算|如何判定)/,
    /(?:标准|准则|要求|验收|判定)[^\n。]{0,80}(?:每个|每一处|每一个|逐项|逐条)/,
  ]), message('an exact standard for every concrete detail'))

  // 4a. No hard upper limit on the amount of detail.
  assert.ok(anyMatch([
    /\bno (?:hard |fixed |strict )?(?:upper |maximum |max )?(?:length |detail |size )?(?:limit|bound|ceiling|cap|constraint)\b/i,
    /\bno (?:maximum|max) (?:length|detail|size)\b/i,
    /\bwithout (?:a |an |any )?(?:hard |fixed )?(?:upper |maximum )?(?:length |detail |size )?(?:limit|bound|ceiling|cap)\b/i,
    /\bunlimited\b/i,
    /\bunbounded\b/i,
    /\b(?:coverage|completeness), not length\b/i,
    /\bnot (?:be )?(?:bounded|limited|capped) by (?:length|detail)\b/i,
    /\bdo not (?:cap|limit|compress|shorten|truncate)\b/i,
    /\bas (?:much|detailed|long) as (?:needed|necessary|you (?:like|want))\b/i,
    /不设(?:上限|限制)/,
    /不限(?:长度|篇幅|字数|细节|详略|于)/,
    /没有(?:硬性|固定|长度|篇幅|字数)?(?:上限|限制)/,
    /不(?:受|设)(?:长度|篇幅|字数|细节)?限制/,
    /上不封顶/,
    /越长越好/,
    /尽可能(?:详细|完整)/,
  ]), message('no hard upper limit on detail'))

  // 4b. The executing agent must not have to guess any detail.
  assert.ok(anyMatch([
    /\b(?:never|not|no need to|without|must not|should not|shouldn't|don't|do not|does not|won't|will not)\b[^.\n]{0,60}\bguess(?:ing|es)?\b/i,
    /无需(?:再)?猜/,
    /不用(?:再)?猜/,
    /不需要(?:再)?猜/,
    /(?:不能|不得|不要|勿)(?:靠|凭)?猜/,
    /没有?(?:猜测|猜)(?:的)?(?:空间|余地)/,
  ]), message('that the executing agent never has to guess a detail'))

  // 4c. When in doubt, too much detail is preferred over too little.
  assert.ok(anyMatch([
    /\bprefer\b[^.\n]{0,100}\b(?:too many|too much|more|extra|excess(?:ive)?|over-?detail(?:ed|ing)?)\b[^.\n]{0,60}\b(?:over|than|rather than|instead of)\b[^.\n]{0,50}\b(?:too few|too little|missing|less|fewer|none)\b/i,
    /\b(?:too many|too much|more|excessive)\b[^.\n]{0,60}\b(?:over|than|rather than|instead of)\b[^.\n]{0,50}\b(?:too few|too little|missing|less|fewer)\b/i,
    /\bprefer\b[^.\n]{0,80}\b(?:too much|more|excess(?:ive)?|over-?detail(?:ed|ing)?)\b[^.\n]{0,60}\bdetails?\b/i,
    /\b(?:err|lean|aim|go|better)\b[^.\n]{0,50}\b(?:on the side of|towards?|toward|for)\b[^.\n]{0,30}\b(?:more|too much|excess)\b[^.\n]{0,20}\bdetails?\b/i,
    /\b(?:too much|more)\b[^.\n]{0,40}\bdetails?\b[^.\n]{0,40}\b(?:better|preferable|preferred|safer)\b[^.\n]{0,40}\b(?:than|over)\b[^.\n]{0,20}\b(?:too little|less)\b/i,
    /宁可[^\n。]{0,60}(?:多|详|啰嗦)/,
    /(?:多写|写多|详细一点|更详细|多些细节)[^\n。]{0,50}(?:比|好过|胜过|优于|也比|而不是|不要)[^\n。]{0,30}(?:少|不够|太少|简略|略)/,
    /宁(?:多|详)勿(?:少|略)/,
  ]), message('preferring too much detail over too little'))
})

// ================================================================ 7. invalid mode fallback

test('DM-09 [Decision fallback] an unknown request mode falls back to the saved defaultMode "detailed"', async () => {
  const { route } = mountPlugin({ defaultMode: 'detailed' })
  const reply = await request(route, 'POST', API + '/improve', improve({ mode: 'bogus' }))
  assert.equal(reply.status, 200)
  assert.equal(reply.json.ok, true, JSON.stringify(reply.json))
  assert.equal(reply.json.meta.mode, 'detailed', 'the configured detailed mode wins over an invalid request mode')
})

// ================================================================ 8. client settings

const require = createRequire(import.meta.url)

/** Load the built client bundle; externals resolve through the host loader contract. */
async function loadClientModuleWith(primitives) {
  let captured = null
  globalThis.window = {
    __ModuleLoader__: { load: (m) => { captured = m } },
    setTimeout,
    clearTimeout,
  }
  await import('../lib/client.js?cachebust=' + String(Date.now()) + Math.random())
  assert.ok(captured !== null, 'the built client bundle must call window.__ModuleLoader__.load')
  return captured.factory((id) => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error('unexpected external: ' + id)
  })
}

/** Fake host settings primitives; records every SegmentedControl it renders. */
function fakePrimitives(seen) {
  class SettingsFormModel {
    constructor(scope, specs) {
      this.scope = scope
      this.fields = specs.map((s) => s.field)
      this.staged = new Map()
      this.listeners = new Set()
    }
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
  const SegmentedControl = (props) => {
    seen.segmented.push({ id: props.id, value: props.value, options: props.options })
    return React.createElement('div', {
      'data-segmented': props.id,
      'data-value': props.value,
      'data-options': props.options.map((option) => option.value).join(','),
    })
  }
  const Switch = (props) => React.createElement('button', {
    role: 'switch',
    'aria-checked': props.checked,
    'aria-label': props.label,
    disabled: props.disabled,
    onClick: () => props.onChange(!props.checked),
  })
  return {
    SettingsFormModel,
    settingsTextField: (field) => ({ field }),
    settingsNumberField: (field) => ({ field }),
    SettingsForm,
    SegmentedControl,
    Switch,
  }
}

/** Boot the client with a configForms scope whose saved settings are `value`. */
async function bootSettings(value) {
  const seen = { segmented: [] }
  const module = await loadClientModuleWith(fakePrimitives(seen))
  const registered = []
  const localeRegistrations = []
  const scope = { getSnapshot: () => ({ status: 'ready', value, writable: true }), subscribe: () => () => {} }
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
      register(namespace, dicts) { localeRegistrations.push({ namespace, dicts }); return () => {} },
      bind() {
        return (key) => {
          const dict = localeRegistrations.length > 0 ? localeRegistrations[localeRegistrations.length - 1].dicts.zh : undefined
          return dict?.[key] ?? key
        }
      },
    },
    effect(fn) { return fn() },
    get(name) {
      if (name === 'configForms') {
        return {
          get(id) { assert.equal(id, 'dsh-smart-prompt'); return scope },
          whileServed(_namespaces, register) { return register() },
        }
      }
      if (name === 'remote') return { get session() { throw new Error('cannot get remote.session without inject') } }
      if (name === 'remote.session') {
        return { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) }
      }
      return undefined
    },
  }
  await TestRenderer.act(async () => { module.apply(ctx) })
  const entry = registered.find((r) => r.options.name === 'plugins.bundle.config')
  assert.ok(entry !== undefined, 'the settings section registers when configForms is served')
  return { entry, seen, localeRegistrations }
}

/** Mount the settings section with Chinese copy from the locale it registered. */
async function mountSettings(entry, localeRegistrations) {
  const dict = localeRegistrations.length > 0 ? localeRegistrations[localeRegistrations.length - 1].dicts.zh : {}
  const t = (key) => dict[key] ?? key
  const face = entry.options.inject()
  const store = face.hooks.smartPromptSettings
  const props = { ...face, view: 'page', t, useSmartPromptSettings: (selector) => selector(store.getSnapshot()) }
  delete props.hooks
  let renderer = null
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(entry.component, props)) })
  return { renderer, face, store }
}

test('DM-10 [EP client settings] three mode choices are listed and saved "detailed" is selected', async () => {
  const { entry, seen, localeRegistrations } = await bootSettings({ defaultMode: 'detailed', modelSource: 'conversation' })
  const { renderer } = await mountSettings(entry, localeRegistrations)

  // The mode control is the one carrying the mode choices (the other is model source).
  const modeControls = seen.segmented.filter((control) => control.options.some((option) => option.value === 'detailed'))
  assert.equal(modeControls.length, 1, 'exactly one segmented control offers the detailed mode')
  const mode = modeControls[0]
  assert.deepEqual(
    mode.options.map((option) => option.value).sort(),
    ['detailed', 'light', 'standard'],
    'the settings section lists exactly the three mode choices',
  )
  assert.equal(mode.value, 'detailed', 'a saved defaultMode of detailed is selected')
  assert.equal(
    mode.options.find((option) => option.value === 'detailed').label,
    '详细模式',
    'the Chinese display name is 详细模式',
  )

  // And the rendered control reflects the same saved selection.
  const rendered = renderer.root.findAll((node) => node.props['data-options'] !== undefined)
  const renderedMode = rendered.find((node) => String(node.props['data-options']).split(',').includes('detailed'))
  assert.ok(renderedMode !== undefined, 'the detailed choice reaches the rendered control')
  assert.equal(renderedMode.props['data-value'], 'detailed')
})

// ================================================================ 9. vague-description follow-up rule

test('DM-11 [EP prompt rule] vague qualitative descriptions become follow-up questions with a Stardea hint', async () => {
  const detailed = await systemFor('detailed')
  const anyMatch = (patterns) => patterns.some((re) => re.test(detailed))
  const message = (what) => 'the detailed prompt must require ' + what + '; prompt excerpt: ' + detailed.slice(0, 600)

  // 1. The rule names the vague, qualitative descriptions it covers and keeps the
  //    requirement's own examples (Chinese, with the English glosses as an alternative).
  assert.ok(anyMatch([
    /(?:vague|qualitative|unspecified)[^.\n]{0,120}(?:description|wording|phrase|qualifier|direction)/i,
    /(?:描述|说法|措辞|词语)[^\n。]{0,60}(?:含糊|模糊|笼统|定性|模棱两可)/,
    /(?:含糊|模糊|笼统|定性)[^\n。]{0,40}(?:描述|说法|措辞|词)/,
  ]), message('the vague / qualitative descriptions it covers'))
  assert.ok(anyMatch([/柔和一些|柔和|softer/i]), message('the "柔和一些" (softer) example'))
  assert.ok(anyMatch([/更厚一些|更厚|thicker|deeper/i]), message('the "更厚一些" (thicker/deeper) example'))

  // 2. Such a phrase must not be guessed or invented: the model asks the user for the
  //    concrete operation and the observable target instead.
  assert.ok(anyMatch([
    /\bask(?:s|ed|ing)?\b[^.\n]{0,120}\b(?:the\s+)?user\b[^.\n]{0,120}\b(?:what|which|how)\b[^.\n]{0,60}\b(?:exactly|specifically|concretely|precise)\b/i,
    /\bask(?:s|ed|ing)?\b[^.\n]{0,150}\b(?:concrete|specific|exact)\b[^.\n]{0,50}\b(?:operation|change|result|target|want)\b/i,
    /(?:问|询问|请)[^\n。]{0,30}用户[^\n。]{0,100}(?:具体|确切|明确|到底)/,
    /(?:具体|确切)[^\n。]{0,60}(?:想要|需要|操作|改动|效果|结果)/,
  ]), message('asking the user for the concrete operation and observable target'))
  assert.ok(anyMatch([
    /\b(?:never|not|no need to|without|must not|should not|shouldn't|don't|do not|does not|won't|will not)\b[^.\n]{0,60}\bguess(?:es|ed|ing)?\b/i,
    /(?:无需|不用|不需要|不能|不得|不要|勿|绝不)[^\n。]{0,20}(?:靠|凭)?猜/,
  ]), message('that the vague operation must not be guessed'))
  assert.ok(anyMatch([
    /\b(?:never|not|without)\b[^.\n]{0,80}\b(?:invent|fabricat)(?:e|ed|ing)?\b/i,
    /(?:不得|不要|不能|勿|绝不)[^\n。]{0,30}(?:编造|虚构|生造|臆造)/,
  ]), message('that the operation must not be invented'))

  // 3. The question goes through the existing follow-up-question mechanism, and its text
  //    points the user at Stardea (星念) for candidate answers.
  assert.match(detailed, /<missing_info>/i, message('the <missing_info> follow-up block'))
  assert.match(detailed, /<question>/i, message('the <question> follow-up block'))
  assert.ok(anyMatch([
    /(?:Stardea|星念)[\s\S]{0,240}(?:candidate answers?|候选(?:答案|回答)|ideas?)/i,
    /(?:candidate answers?|候选(?:答案|回答)|ideas?)[\s\S]{0,240}(?:Stardea|星念)/i,
  ]), message('a Stardea (星念) hint offering candidate answers'))
  assert.ok(anyMatch([
    /(?:Stardea|星念)[\s\S]{0,350}(?:<missing_info>|<question>)/i,
    /(?:<missing_info>|<question>)[\s\S]{0,350}(?:Stardea|星念)/i,
  ]), message('the Stardea hint inside the follow-up <missing_info>/<question> block'))

  // 4. Without follow-up questions (asking unavailable or ended) the phrase becomes a
  //    listed guess under the rewrite; the template no longer requires a (TBD: …) marker.
  assert.ok(anyMatch([
    /\bif\b[^.\n]{0,100}\b(?:follow-?up questions?|questions?)\b[^.\n]{0,80}\b(?:not available|unavailable|absent|disabled|turned off)\b/i,
    /(?:没有|无|不具备|不可用|不支持)[^\n。]{0,30}(?:追问|提问|问题|follow-?up)/,
    /(?:追问|提问|问题)[^\n。]{0,30}(?:不可用|不可|不能|没有|关闭|缺失)/,
    // The fallback now also covers asking that has ended (cap reached or skipped).
    /\b(?:asking|questions?)\b[^.\n]{0,40}\b(?:has|have|is|are)?\s*(?:ended|over|exhausted|no longer (?:possible|available))\b/i,
    /(?:追问|提问)[^\n。]{0,20}(?:结束|用完|已尽)/,
  ]), message('the no-follow-up-questions fallback'))
  const template = promptFile('detailed')
  assert.ok([
    /\bguess(?:es|ed|ing)?\b/i,
    /猜测/,
  ].some((re) => re.test(template)), message('guessing as the fallback once asking has ended'))
  assert.ok([
    /\blist[^.\n]{0,80}\bguess/i,
    /\bguess(?:es|ed)?\b[^.\n]{0,120}\blist/i,
    /guessed details/i,
    /(?:列出|列在)[^\n。]{0,40}猜测|猜测[^\n。]{0,40}(?:列出|列在|列表)/,
  ].some((re) => re.test(template)), message('listing the guesses under the rewrite'))
  // The template may name TBD only to forbid it; no line may ask for a TBD marker.
  for (const line of template.split('\n').filter((l) => /TBD/i.test(l))) {
    assert.match(line, /\b(?:never|not|no|don't|do not|without|absent|replace[sd]?|instead of|avoid)\b|不要|不得|禁止|不写|不留/i,
      'the detailed template must not require a TBD marker: ' + line)
  }

  // 5. Cheap specificity check: the cheaper modes do not carry the examples or the Stardea
  //    hint (they may still carry their own generic "(TBD: ...)" fallback).
  const [standard, light] = await Promise.all([systemFor('standard'), systemFor('light')])
  for (const [mode, system] of [['standard', standard], ['light', light]]) {
    assert.doesNotMatch(system, /柔和一些|更厚一些|Stardea|星念/i, mode + ' has no vague-description Stardea rule')
  }
})
