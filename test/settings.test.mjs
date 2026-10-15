import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, readLiveSettings, resolveConfig } from '../lib/config.js'
import { resolveRoute } from '../lib/llm-call.js'
import { improveDraft } from '../lib/orchestrate.js'

// The plugin settings page (DSH 0.2+) edits only `.volatile()` Config fields.
test('the settings-page fields are volatile, everything else stays file-only', () => {
  const resolved = Config({})
  for (const field of ['defaultMode', 'modelSource', 'provider', 'model', 'dedicatedReasoningEffort']) {
    assert.equal(typeof resolved[field]?.get, 'function', field + ' is a live settings field')
  }
  assert.equal(typeof resolved.timeoutMs, 'number', 'tuning fields are not on the settings page')
})

test('settings defaults: standard mode, conversation model, no dedicated route', () => {
  assert.deepEqual(readLiveSettings(Config({})), {
    mode: 'standard', modelSource: 'conversation', provider: '', model: '', reasoningEffort: '',
  })
})

test('a saved setting is read at call time, not frozen at apply', () => {
  let mode = 'standard'
  const cfg = { defaultMode: { get: () => mode } }
  assert.equal(readLiveSettings(cfg).mode, 'standard')
  mode = 'light'
  assert.equal(readLiveSettings(cfg).mode, 'light', 'a save on the settings page applies to the next click')
})

test('the schema rejects modes and sources outside the closed sets', () => {
  assert.throws(() => Config({ defaultMode: 'turbo' }))
  assert.throws(() => Config({ modelSource: 'random' }))
})

test('resolveConfig still accepts plain (pre-0.2) values', () => {
  assert.equal(resolveConfig({ defaultMode: 'light' }).defaultMode, 'light')
  assert.equal(readLiveSettings({ defaultMode: 'light', modelSource: 'dedicated', provider: 'p', model: 'm' }).modelSource, 'dedicated')
})

test('route precedence: dedicated, then conversation, then default, then last seen', () => {
  const dedicated = { provider: 'd', model: 'dm', reasoningEffort: 'high' }
  const conversation = { provider: 'c', model: 'cm' }
  const defaults = { provider: 'x', model: 'xm' }
  const lastSeen = { provider: 'l', model: 'lm' }
  assert.deepEqual(resolveRoute({ dedicated, conversation, defaults, lastSeen }), { provider: 'd', model: 'dm', reasoningEffort: 'high' })
  assert.deepEqual(resolveRoute({ conversation, defaults, lastSeen }), conversation)
  assert.deepEqual(resolveRoute({ defaults, lastSeen }), defaults)
  assert.deepEqual(resolveRoute({ lastSeen }), lastSeen)
  assert.throws(() => resolveRoute({}))
  // A dedicated source without a model never wins over the conversation.
  assert.deepEqual(resolveRoute({ dedicated: { provider: '', model: '' }, conversation }), conversation)
})

function capturingLlm() {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      return (async function* () { yield { type: 'text-delta', text: '为登录接口增加限流。' }; yield { type: 'finish' } })()
    },
  }
}
const call = { draft: '给登录接口加限流', sessionId: 's1', mode: 'standard', signal: new AbortController().signal }

test('conversation source uses the model picked in that conversation', async () => {
  const llm = capturingLlm()
  const out = await improveDraft({
    llm,
    selection: { provider: 'x', model: 'default-model' },
    conversationModel: (id) => (id === 's1' ? { provider: 'c', model: 'chat-model' } : undefined),
  }, resolveConfig({}), call)
  assert.equal(out.ok, true)
  assert.equal(llm.calls[0].provider, 'c')
  assert.equal(llm.calls[0].model, 'chat-model')
  assert.equal(llm.calls[0].reasoningEffort, 'low', 'the conversation model keeps the plugin effort')
})

test('dedicated source uses the chosen model and its own effort', async () => {
  const llm = capturingLlm()
  await improveDraft({
    llm,
    dedicated: { provider: 'd', model: 'pick', reasoningEffort: 'high' },
    conversationModel: () => ({ provider: 'c', model: 'chat-model' }),
  }, resolveConfig({}), call)
  assert.equal(llm.calls[0].model, 'pick')
  assert.equal(llm.calls[0].reasoningEffort, 'high')
})

test('dedicated "model default" effort sends no effort at all', async () => {
  const llm = capturingLlm()
  await improveDraft({ llm, dedicated: { provider: 'd', model: 'pick', reasoningEffort: '' } }, resolveConfig({}), call)
  assert.equal('reasoningEffort' in llm.calls[0], false)
})
