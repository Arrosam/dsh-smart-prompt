import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'

// 2026-09-24: reasoning-model defaults. GLM-5.3-flash at the agent's effort=max
// routinely outgrew the 60s timeout and burned the 2000-token budget on thinking
// before any answer text, so every click could end in "no result". The plugin now
// ships patient defaults and asks for its own shallow effort.
//
// 2026-10-24: the default output-token cap per model call (maxTokens) is 32000; it was
// 8192 (user decision). The other rules are unchanged: a positive finite number is used
// as-is, anything else falls back to the default. review-regressions RR-13/RR-14 cover
// 0, -1, NaN, Infinity and non-numbers; the cases below add the boundaries they leave out.

const DEFAULT_MAX_TOKENS = 32000
const DRAFT = '修一下登录白屏'

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

/** One refinement of DRAFT through the agent's default selection, no session. */
const refine = (llm, config, over = {}) => improveDraft(
  { llm, selection: { provider: 'zhipuai', model: 'zhipuai/glm-5.3-flash' }, lastRoute: null },
  config,
  { draft: DRAFT, sessionId: '', mode: 'standard', signal: new AbortController().signal, ...over },
)

test('defaults are sized for reasoning models', () => {
  const cfg = resolveConfig({})
  assert.equal(cfg.timeoutMs, 180000)
  assert.equal(cfg.maxTokens, DEFAULT_MAX_TOKENS)
  assert.equal(cfg.reasoningEffort, 'low')
})

test('a positive finite maxTokens is kept as-is, below and above the default', () => {
  // BVA: just above 0, the smallest whole count, the old default, just above the new
  // default, well above it, and the largest finite number.
  for (const value of [Number.MIN_VALUE, 1, 8192, 32001, 40000, Number.MAX_VALUE]) {
    assert.equal(resolveConfig({ maxTokens: value }).maxTokens, value, 'maxTokens=' + String(value))
  }
})

test('maxTokens at negative zero, just below zero or at -Infinity falls back to 32000', () => {
  for (const [label, value] of [['-0', -0], ['-Number.MIN_VALUE', -Number.MIN_VALUE], ['-Infinity', -Infinity]]) {
    assert.equal(resolveConfig({ maxTokens: value }).maxTokens, DEFAULT_MAX_TOKENS, 'maxTokens=' + label)
  }
})

test('the resolved maxTokens reaches every model call: default, fallback and explicit value', async () => {
  // Light mode with an over-long first reply makes two calls: the rewrite and its length repair.
  for (const [raw, expected] of [[{}, DEFAULT_MAX_TOKENS], [{ maxTokens: 0 }, DEFAULT_MAX_TOKENS], [{ maxTokens: 40000 }, 40000]]) {
    const llm = stubLlm(['x'.repeat(601), '修复这个 bug。'])
    const out = await refine(llm, resolveConfig(raw), { mode: 'light' })
    const label = JSON.stringify(raw)
    assert.equal(out.ok, true, label + ': ' + JSON.stringify(out))
    assert.equal(llm.calls.length, 2, label + ': the rewrite and its length repair')
    assert.deepEqual(llm.calls.map((call) => call.maxTokens), [expected, expected], label)
  }
})

test('an empty reasoningEffort falls back to low, an explicit one wins', () => {
  assert.equal(resolveConfig({ reasoningEffort: '' }).reasoningEffort, 'low')
  assert.equal(resolveConfig({ reasoningEffort: 'max' }).reasoningEffort, 'max')
})

test('the effort reaches the call and the certificate names the model once', async () => {
  const llm = stubLlm(['修复这个 bug。'])
  const out = await refine(llm, resolveConfig({}))
  assert.equal(out.ok, true)
  assert.equal(llm.calls[0].reasoningEffort, 'low')
  // The agent's default selection carries the provider prefix already; the
  // certificate must not render it twice ("zhipuai/zhipuai/...").
  assert.equal(out.meta.model, 'zhipuai/glm-5.3-flash')
})
