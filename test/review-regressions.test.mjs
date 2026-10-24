// Black-box characterization of behavior the refactor must preserve and that the other
// suites leave unpinned: the HTTP route of `apply` (lib/index.js), config resolution,
// live settings, improveDraft's failure codes and certificate, history rendering, the
// context trigger's codepoint boundary, and slash-only command bodies.
//
// Techniques:
//  - EP: route paths/methods, request bodies, config value classes, live-setting sources.
//  - BVA: 512 KiB body cap (cap / cap+1), positive vs non-negative fields at 0,
//    maxQuestions 0/1, assistant tail 600/601 codepoints, short-vague 12/13 codepoints.
//  - Decision table: request mode x settings defaultMode -> meta.mode; model x provider
//    -> meta.model; length over budget x fact re-appended -> refusal.
//  - State transition: in-flight call -> aborted -> ABORTED.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { apply } from '../lib/index.js'
import { Config, readLiveSettings, resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'
import { collectTurns, formatHistoryBlock } from '../lib/history.js'
import { contextTrigger } from '../lib/context-trigger.js'
import { splitCommand } from '../lib/command.js'

const API = '/dsh-smart-prompt/api'
const TEXT_BODY_CAP = 512 * 1024
// No marker, longer than 12 codepoints, no hard facts the fidelity gate would track.
const PLAIN_DRAFT = '把登录模块重构得更清晰一些并删除多余的东西'

// ================================================================ harness

/** Scripted model: each entry is one reply text, or { hang: true } to wait for abort. */
function stubLlm(replies) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      const step = replies.length > 0 ? replies.shift() : ''
      return (async function* () {
        if (typeof step === 'object') {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 5000)
            options.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
          })
          return
        }
        if (step !== '') yield { type: 'text-delta', index: 0, text: step }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** Apply the plugin against stub host services; returns the registered route and log. */
function mountPlugin(rawConfig, services = {}) {
  const routes = []
  const warnings = []
  const all = {
    llm: stubLlm(Array(10).fill('为登录接口增加按 IP 的限流。')),
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    ...services,
  }
  const ctx = {
    logger: { warn: (m) => warnings.push(m) },
    on() {},
    effect(fn) { return fn() },
    get: (name) => all[name],
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  apply(ctx, rawConfig)
  assert.equal(routes.length, 1)
  return { route: routes[0], warnings }
}

/** Drive the handler with a fake request; `body` is a string or Buffer (omitted = none). */
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
  if (body !== undefined) req.emit('data', Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'))
  req.emit('end')
  await done
  return reply
}

/** A valid JSON body padded with trailing spaces to exactly `bytes` bytes. */
function paddedJson(payload, bytes) {
  const json = JSON.stringify(payload)
  return json + ' '.repeat(bytes - Buffer.byteLength(json, 'utf8'))
}

const improve = (over = {}) => JSON.stringify({ text: PLAIN_DRAFT, ...over })

// ================================================================ 1. HTTP route

test('RR-01 [EP] the plugin registers one prefix route on the API namespace', () => {
  const { route } = mountPlugin(undefined)
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, API)
})

test('RR-02 [EP] GET config with and without trailing slash returns the public config', async () => {
  const { route } = mountPlugin({ lightMaxRatio: 3, smartContext: false, defaultMode: { get: () => 'light' } })
  for (const path of [API + '/config', API + '/config/']) {
    const reply = await request(route, 'GET', path)
    assert.equal(reply.status, 200, path)
    assert.match(reply.headers['content-type'], /application\/json/)
    assert.deepEqual(reply.json, {
      ok: true, defaultMode: 'light', modes: ['standard', 'detailed', 'light'],
      maxRatio: { light: 3, standard: 0, detailed: 0 }, smartContext: false,
    }, path)
  }
})

test('RR-03 [EP] unknown paths answer 404 UNKNOWN', async () => {
  const { route } = mountPlugin(undefined)
  for (const [method, path] of [['GET', API], ['GET', API + '/nope'], ['POST', API + '/config'], ['GET', API + '/config//'], ['POST', API + '/improvee']]) {
    const reply = await request(route, method, path)
    assert.equal(reply.status, 404, method + ' ' + path)
    assert.equal(reply.json.ok, false)
    assert.equal(reply.json.code, 'UNKNOWN')
  }
})

test('RR-04 [EP] a non-POST improve answers 405 UNKNOWN', async () => {
  const { route } = mountPlugin(undefined)
  for (const method of ['GET', 'PUT', 'DELETE']) {
    for (const path of [API + '/improve', API + '/improve/']) {
      const reply = await request(route, method, path)
      assert.equal(reply.status, 405, method + ' ' + path)
      assert.deepEqual([reply.json.ok, reply.json.code], [false, 'UNKNOWN'])
    }
  }
})

test('RR-05 [EP] a body that is not JSON answers 400 BAD_BODY', async () => {
  const { route } = mountPlugin(undefined)
  for (const body of ['{not json', '', 'undefined']) {
    const reply = await request(route, 'POST', API + '/improve', body)
    assert.equal(reply.status, 400, JSON.stringify(body))
    assert.deepEqual([reply.json.ok, reply.json.code], [false, 'BAD_BODY'])
  }
})

test('RR-06 [BVA] without an attachments service the body cap is exactly 512 KiB', async () => {
  const { route } = mountPlugin(undefined)
  const atCap = await request(route, 'POST', API + '/improve/', paddedJson({ text: PLAIN_DRAFT }, TEXT_BODY_CAP))
  assert.equal(atCap.status, 200)
  assert.equal(atCap.json.ok, true, JSON.stringify(atCap.json))
  const over = await request(route, 'POST', API + '/improve', paddedJson({ text: PLAIN_DRAFT }, TEXT_BODY_CAP + 1))
  assert.equal(over.status, 400)
  assert.equal(over.json.code, 'BAD_BODY')
})

test('RR-07 [BVA] an attachments service with an image limit widens the cap by 4/3 of it', async () => {
  // 3 image bytes -> ceil(3 * 4 / 3) = 4 extra bytes.
  const { route } = mountPlugin(undefined, { attachments: { imageLimits: { maxMessageImageBytes: 3 } } })
  const inside = await request(route, 'POST', API + '/improve', paddedJson({ text: PLAIN_DRAFT }, TEXT_BODY_CAP + 4))
  assert.equal(inside.status, 200)
  const over = await request(route, 'POST', API + '/improve', paddedJson({ text: PLAIN_DRAFT }, TEXT_BODY_CAP + 5))
  assert.equal(over.json.code, 'BAD_BODY')
})

test('RR-08 [Decision] request mode x settings defaultMode -> meta.mode', async () => {
  const rows = [
    // [rawConfig, body mode, expected]
    [undefined, undefined, 'standard'],
    [{ defaultMode: 'light' }, undefined, 'light'],
    [{ defaultMode: { get: () => 'light' } }, 'turbo', 'light'],
    [{ defaultMode: { get: () => 'light' } }, 'standard', 'standard'],
    [{ defaultMode: 'standard' }, 'light', 'light'],
    [{ defaultMode: 'standard' }, 'LIGHT', 'standard'],
    [{ defaultMode: { get: () => 'bogus' } }, 42, 'standard'],
  ]
  for (const [raw, mode, expected] of rows) {
    const { route } = mountPlugin(raw)
    const reply = await request(route, 'POST', API + '/improve', improve({ mode }))
    assert.equal(reply.status, 200)
    assert.equal(reply.json.ok, true, JSON.stringify(reply.json))
    assert.equal(reply.json.meta.mode, expected, JSON.stringify([raw, mode]))
  }
})

test('RR-09 [State] a settings-page mode change applies to the next request', async () => {
  let mode = 'standard'
  const { route } = mountPlugin({ defaultMode: { get: () => mode } })
  assert.equal((await request(route, 'POST', API + '/improve', improve())).json.meta.mode, 'standard')
  mode = 'light'
  assert.equal((await request(route, 'POST', API + '/improve', improve())).json.meta.mode, 'light')
  assert.equal((await request(route, 'GET', API + '/config')).json.defaultMode, 'light')
})

test('RR-10 [EP] an error thrown while processing answers 200 UNKNOWN with its message', async () => {
  const { route, warnings } = mountPlugin(undefined, {
    agentDefaultModel: { currentSelection: () => { throw new Error('selection exploded') } },
  })
  const reply = await request(route, 'POST', API + '/improve', improve())
  assert.equal(reply.status, 200)
  assert.deepEqual(reply.json, { ok: false, code: 'UNKNOWN', message: 'selection exploded' })
  assert.ok(warnings.some((w) => w.includes('selection exploded')))
})

// ================================================================ 2. resolveConfig

const DEFAULTS = {
  defaultMode: 'standard', lightMaxRatio: 2, standardMaxRatio: 0, acceptanceCriteria: false, temperature: 0.3,
  maxTokens: 32000, timeoutMs: 180000, maxInputChars: 20000, contextTurns: 3, contextChars: 6000, smartContext: true,
  fidelityGate: true, lengthGate: true, knowledgeChars: 4000, provider: '', model: '', reasoningEffort: 'low', logFailures: true,
}

test('RR-11 [EP] resolveConfig defaults for undefined, null and non-object input', () => {
  for (const raw of [undefined, null, 'x', 7]) assert.deepEqual(resolveConfig(raw), DEFAULTS, String(raw))
})

test('RR-12 [EP] the Config schema defaults equal resolveConfig defaults', () => {
  assert.deepEqual(resolveConfig(Config({})), resolveConfig(undefined))
})

test('RR-13 [BVA] 0 is rejected for positive-only fields and kept for non-negative ones', () => {
  const zeros = resolveConfig({
    maxTokens: 0, timeoutMs: 0, maxInputChars: 0,
    lightMaxRatio: 0, standardMaxRatio: 0, temperature: 0, contextTurns: 0, contextChars: 0,
  })
  assert.deepEqual(zeros, { ...DEFAULTS, lightMaxRatio: 0, temperature: 0, contextTurns: 0, contextChars: 0 })
})

test('RR-14 [EP] invalid numbers and flags fall back field by field', () => {
  const numeric = ['lightMaxRatio', 'standardMaxRatio', 'temperature', 'maxTokens', 'timeoutMs', 'maxInputChars', 'contextTurns', 'contextChars']
  for (const bad of [-1, NaN, Infinity, '5', null, true]) {
    for (const field of numeric) {
      // A valid neighbor must survive while this field falls back.
      const out = resolveConfig({ [field]: bad, maxTokens: field === 'maxTokens' ? bad : 100 })
      assert.equal(out[field], DEFAULTS[field], field + '=' + String(bad))
      if (field !== 'maxTokens') assert.equal(out.maxTokens, 100)
    }
  }
  for (const field of ['acceptanceCriteria', 'smartContext', 'fidelityGate', 'lengthGate', 'logFailures']) {
    assert.equal(resolveConfig({ [field]: 'true' })[field], DEFAULTS[field], field)
    assert.equal(resolveConfig({ [field]: !DEFAULTS[field] })[field], !DEFAULTS[field], field)
  }
  assert.equal(resolveConfig({ defaultMode: 'turbo' }).defaultMode, 'standard')
})

test('RR-15 [EP] strings are trimmed, volatile refs read, blank effort -> low', () => {
  const out = resolveConfig({ provider: '  p  ', model: { get: () => ' m ' }, reasoningEffort: ' high ' })
  assert.deepEqual([out.provider, out.model, out.reasoningEffort], ['p', 'm', 'high'])
  for (const effort of ['   ', '\n\t', undefined, 5]) assert.equal(resolveConfig({ reasoningEffort: effort }).reasoningEffort, 'low')
  assert.equal(resolveConfig({ provider: 5 }).provider, '')
})

// ================================================================ 3. readLiveSettings

test('RR-16 [EP] modelSource is dedicated only for exactly "dedicated"', () => {
  assert.equal(readLiveSettings({ modelSource: 'dedicated' }).modelSource, 'dedicated')
  assert.equal(readLiveSettings({ modelSource: { get: () => 'dedicated' } }).modelSource, 'dedicated')
  for (const source of ['Dedicated', ' dedicated', 'conversation', '', 1, undefined]) {
    assert.equal(readLiveSettings({ modelSource: source }).modelSource, 'conversation', String(source))
  }
})

test('RR-17 [EP] dedicated route fields are trimmed; effort comes from dedicatedReasoningEffort', () => {
  const out = readLiveSettings({
    provider: { get: () => ' d ' }, model: ' pick ', dedicatedReasoningEffort: { get: () => ' high ' }, reasoningEffort: 'max',
  })
  assert.deepEqual([out.provider, out.model, out.reasoningEffort], ['d', 'pick', 'high'])
  assert.equal(readLiveSettings({ reasoningEffort: 'max' }).reasoningEffort, '')
  assert.equal(readLiveSettings({ provider: 7 }).provider, '')
})

test('RR-18 [BVA] maxQuestions: whole number >= 1, else 5', () => {
  for (const [value, expected] of [[1, 1], [2, 2], [100, 100], [0, 5], [-1, 5], [1.5, 5], ['3', 5], [null, 5], [{ get: () => 4 }, 4], [{ get: () => 0 }, 5]]) {
    assert.equal(readLiveSettings({ maxQuestions: value }).maxQuestions, expected, JSON.stringify(value))
  }
})

test('RR-19 [EP] null / non-object raw settings resolve to defaults', () => {
  const expected = { mode: 'standard', modelSource: 'conversation', provider: '', model: '', reasoningEffort: '', maxQuestions: 5, sessionLookupRounds: 3, stardeaIdeas: 4, stardeaRounds: 1, stardeaWebSearch: false }
  for (const raw of [undefined, null, 'light']) assert.deepEqual(readLiveSettings(raw), expected, String(raw))
})

// ================================================================ 4. improveDraft outcomes

const runDraft = (llm, cfg, over = {}) => improveDraft(
  { llm, selection: { provider: 'p', model: 'm' }, lastRoute: null },
  cfg,
  { draft: PLAIN_DRAFT, sessionId: '', mode: 'light', signal: new AbortController().signal, ...over },
)

test('RR-20 [BVA] light refusal message names the final length and the 600 floor budget', async () => {
  const llm = stubLlm(['x'.repeat(700), 'y'.repeat(650)])
  const out = await runDraft(llm, resolveConfig({}))
  assert.equal(out.ok, false)
  assert.equal(out.code, 'LENGTH_EXCEEDED')
  assert.match(out.message, /650/)
  assert.match(out.message, /600/)
  assert.equal(llm.calls.length, 2)
})

test('RR-21 [BVA] light refusal on a 400-char draft names budget floor(400*2) = 800', async () => {
  const draft = '请整理'.repeat(133) + '一'
  const out = await runDraft(stubLlm(['x'.repeat(900), 'y'.repeat(801)]), resolveConfig({}), { draft })
  assert.equal(out.code, 'LENGTH_EXCEEDED')
  assert.match(out.message, /801/)
  assert.match(out.message, /800/)
})

test('RR-22 [Decision] light: a re-appended fact suppresses the length refusal', async () => {
  const draft = '把 src/a.ts 的 maxRatioFor 改成 2.5'
  const out = await runDraft(stubLlm(['x'.repeat(900), 'y'.repeat(900)]), resolveConfig({}), { draft })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.ok(out.meta.anchors.reinjected > 0)
  assert.ok(out.text.includes('src/a.ts'))
})

test('RR-23 [State] aborting while the model call is in flight -> ABORTED', async () => {
  const controller = new AbortController()
  const pending = runDraft(stubLlm([{ hang: true }]), resolveConfig({}), { signal: controller.signal })
  setTimeout(() => controller.abort(), 10)
  const out = await pending
  assert.equal(out.ok, false)
  assert.equal(out.code, 'ABORTED')
})

test('RR-24 [EP] a whitespace-only reply -> EMPTY_OUTPUT', async () => {
  for (const reply of ['   ', '\n\t \n']) {
    const out = await runDraft(stubLlm([reply]), resolveConfig({}), { mode: 'standard' })
    assert.equal(out.code, 'EMPTY_OUTPUT', JSON.stringify(reply))
  }
})

test('RR-25 [BVA] meta.ratio rounds to 2 decimals, ratioLabel to 1 decimal with "x"', async () => {
  const draft = '请整理'.repeat(10) // 30 codepoints
  for (const [len, ratio, label] of [[43, 1.43, '1.4x'], [44, 1.47, '1.5x'], [30, 1, '1.0x']]) {
    const out = await runDraft(stubLlm(['z'.repeat(len)]), resolveConfig({}), { draft, mode: 'standard' })
    assert.equal(out.ok, true)
    assert.equal(out.meta.ratio, ratio, 'len=' + String(len))
    assert.equal(out.meta.ratioLabel, label, 'len=' + String(len))
  }
})

test('RR-26 [Decision] meta.model never duplicates the provider prefix', async () => {
  for (const [model, expected] of [['p/m', 'p/m'], ['m', 'p/m'], ['px/m', 'p/px/m']]) {
    const out = await improveDraft(
      { llm: stubLlm(['为登录接口增加限流。']), selection: { provider: 'p', model }, lastRoute: null },
      resolveConfig({}),
      { draft: PLAIN_DRAFT, sessionId: '', mode: 'standard', signal: new AbortController().signal },
    )
    assert.equal(out.meta.model, expected, model)
  }
})

// ================================================================ 5-8. history, trigger, command

test('RR-27 [EP] formatHistoryBlock renders two turns in the exact shape', () => {
  const block = formatHistoryBlock([{ user: 'q1', assistant: 'a1' }, { user: 'q2', assistant: 'a2' }])
  assert.equal(block, [
    '<conversation_context>',
    'Recent turns of the conversation this draft belongs to (2 most recent).',
    'Use it ONLY to resolve what the draft leaves implicit. The draft always wins on conflict.',
    '',
    '用户: q1\n助手结论: a1\n\n用户: q2\n助手结论: a2',
    '</conversation_context>',
  ].join('\n'))
  assert.equal(formatHistoryBlock([]), '')
})

const msg = (role, kind, text) => ({ role, source: { kind }, content: [{ type: 'text', text }] })

test('RR-28 [BVA] assistant replies are tail-clipped at 600 codepoints, not UTF-16 units', () => {
  const at = collectTurns([msg('user', 'user', 'q'), msg('assistant', 'model', '😀'.repeat(600))], 1, 100000)
  assert.equal(at[0].assistant, '😀'.repeat(600))
  const over = collectTurns([msg('user', 'user', 'q'), msg('assistant', 'model', '头' + '😀'.repeat(600))], 1, 100000)
  assert.equal(over[0].assistant, '…' + '😀'.repeat(600))
  const cjk = collectTurns([msg('user', 'user', 'q'), msg('assistant', 'model', '甲乙' + '中'.repeat(600))], 1, 100000)
  assert.equal(cjk[0].assistant, '…' + '中'.repeat(600))
})

test('RR-29 [BVA] short-vague fires at 12 codepoints and not at 13', () => {
  const twelveCjk = '修复登录页面样式错误请快'
  assert.equal([...twelveCjk].length, 12)
  assert.deepEqual(contextTrigger(twelveCjk), { needed: true, reason: 'short-vague' })
  assert.deepEqual(contextTrigger('  ' + twelveCjk + '  '), { needed: true, reason: 'short-vague' })
  assert.deepEqual(contextTrigger(twelveCjk + '点'), { needed: false, reason: 'none' })
  // 12 emoji are 24 UTF-16 units: still short by codepoints.
  assert.deepEqual(contextTrigger('🔥'.repeat(12)), { needed: true, reason: 'short-vague' })
  assert.deepEqual(contextTrigger('🔥'.repeat(13)), { needed: false, reason: 'none' })
})

test('RR-30 [EP] slash-only inputs have an empty body', () => {
  for (const input of ['/', '///', '  //  ', '/cmd ///']) {
    assert.equal(splitCommand(input).body, '', JSON.stringify(input))
  }
})
