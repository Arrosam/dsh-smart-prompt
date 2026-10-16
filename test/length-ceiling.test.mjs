// Length-ceiling defaults (requirement 1), black-box.
// Techniques: EP (light / standard-uncapped / standard-capped / gate off),
// BVA (floor 600 and ratio crossovers at budget and budget+1), Decision table
// (mode x ratio setting x rewrite length -> verdict / outcome / call count).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'
import { budgetFor, lengthVerdict, MIN_BUDGET_CHARS } from '../lib/length-gate.js'

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

const userText = (call) => call.messages[0].content.map((p) => p.text ?? '').join('')

// No hard facts (paths, numbers, code), so the fidelity gate stays silent and the
// length gate alone decides.
const DRAFT = '把这个模块重构一下做得更清晰一些，另外再看下有没有多余的东西'
const FLOOR = 600

const run = (llm, cfg, over = {}) => improveDraft(
  { llm, selection: { provider: 'p', model: 'm' }, lastRoute: null },
  cfg,
  { draft: DRAFT, sessionId: '', mode: 'standard', signal: new AbortController().signal, ...over },
)

// ---------------------------------------------------------------- constants & config

test('LC-01 [BVA] the absolute floor is 600 characters', () => {
  assert.equal(MIN_BUDGET_CHARS, FLOOR)
})

test('LC-02 [EP] defaults: light ratio 2.0, standard uncapped (0)', () => {
  const cfg = resolveConfig({})
  assert.equal(cfg.lightMaxRatio, 2)
  assert.equal(cfg.standardMaxRatio, 0)
  assert.equal(resolveConfig(undefined).standardMaxRatio, 0)
})

test('LC-03 [EP/Decision] standardMaxRatio: positive kept, 0 kept (uncapped), negative -> default 0', () => {
  for (const [input, expected] of [[2.5, 2.5], [0.1, 0.1], [0, 0], [-1, 0], [-0.0001, 0]]) {
    assert.equal(resolveConfig({ standardMaxRatio: input }).standardMaxRatio, expected, 'standardMaxRatio=' + String(input))
  }
})

test('LC-04 [EP] a negative light ratio falls back to the 2.0 default', () => {
  assert.equal(resolveConfig({ lightMaxRatio: -3 }).lightMaxRatio, 2)
  assert.equal(resolveConfig({ lightMaxRatio: 3 }).lightMaxRatio, 3)
})

// ---------------------------------------------------------------- budgetFor

test('LC-05 [BVA] light ratio 2.0: the floor governs up to 300 chars, the ratio above', () => {
  assert.equal(budgetFor('a', 2), FLOOR)
  assert.equal(budgetFor('a'.repeat(299), 2), FLOOR) // 598 -> floor
  assert.equal(budgetFor('a'.repeat(300), 2), FLOOR) // 600 == floor
  assert.equal(budgetFor('a'.repeat(301), 2), 602) // first value above the floor
  assert.equal(budgetFor('a'.repeat(1000), 2), 2000)
})

test('LC-06 [BVA] the scaled budget is floored to a whole character count', () => {
  assert.equal(budgetFor('a'.repeat(401), 1.5), 601) // 601.5 -> 601
  assert.equal(budgetFor('a'.repeat(1001), 2.5), 2502) // 2502.5 -> 2502
})

test('LC-07 [EP] a user-set standard cap 2.5 restores max(600, len*2.5)', () => {
  assert.equal(budgetFor('a'.repeat(100), 2.5), FLOOR)
  assert.equal(budgetFor('a'.repeat(240), 2.5), FLOOR)
  assert.equal(budgetFor('a'.repeat(241), 2.5), 602)
  assert.equal(budgetFor('a'.repeat(1000), 2.5), 2500)
})

test('LC-08 [EP/BVA] ratio 0 means no limit: budget is Infinity for any draft length', () => {
  for (const len of [0, 1, 300, 20000]) {
    assert.equal(budgetFor('a'.repeat(len), 0), Infinity, 'len=' + String(len))
  }
})

// ---------------------------------------------------------------- lengthVerdict

test('LC-09 [BVA] lengthVerdict at the 600 floor: 600 ok, 601 converge with budget 600', () => {
  assert.equal(lengthVerdict(DRAFT, 'x'.repeat(599), 2).kind, 'ok')
  assert.equal(lengthVerdict(DRAFT, 'x'.repeat(600), 2).kind, 'ok')
  const over = lengthVerdict(DRAFT, 'x'.repeat(601), 2)
  assert.equal(over.kind, 'converge')
  assert.equal(over.charBudget, FLOOR)
})

test('LC-10 [BVA] lengthVerdict above the floor follows the ratio', () => {
  const draft = 'a'.repeat(400) // budget 800 at ratio 2
  assert.equal(lengthVerdict(draft, 'b'.repeat(800), 2).kind, 'ok')
  const over = lengthVerdict(draft, 'b'.repeat(801), 2)
  assert.equal(over.kind, 'converge')
  assert.equal(over.charBudget, 800)
})

test('LC-11 [EP] ratio 0 never converges, however long the rewrite', () => {
  assert.equal(lengthVerdict('a', 'b'.repeat(100000), 0).kind, 'ok')
  assert.equal(lengthVerdict('a'.repeat(5000), 'b'.repeat(500000), 0).kind, 'ok')
})

// ---------------------------------------------------------------- orchestrator: standard mode

test('LC-12 [Decision] standard default: a huge rewrite succeeds with one call, no repair', async () => {
  for (const len of [601, 5000, 60000]) {
    const llm = stubLlm(['x'.repeat(len)])
    const out = await run(llm, resolveConfig({}))
    assert.equal(out.ok, true, 'len=' + String(len) + ' ' + JSON.stringify(out))
    assert.equal(llm.calls.length, 1, 'no length-convergence repair call')
    assert.equal(out.text, 'x'.repeat(len))
  }
})

test('LC-13 [Decision] standard with a negative ratio behaves as uncapped', async () => {
  const llm = stubLlm(['x'.repeat(5000)])
  const out = await run(llm, resolveConfig({ standardMaxRatio: -2 }))
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 1)
})

test('LC-14 [Decision] standard default never returns LENGTH_EXCEEDED even if the repair path would be long', async () => {
  const llm = stubLlm(['x'.repeat(9000), 'y'.repeat(9000)])
  const out = await run(llm, resolveConfig({}))
  assert.notEqual(out.code, 'LENGTH_EXCEEDED')
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 1)
})

test('LC-15 [BVA/Decision] standard capped at 2.5: 600 chars passes with one call', async () => {
  const llm = stubLlm(['x'.repeat(600)])
  const out = await run(llm, resolveConfig({ standardMaxRatio: 2.5 }))
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 1)
})

test('LC-16 [BVA/Decision] standard capped at 2.5: 601 chars triggers one repair naming budget 600', async () => {
  const llm = stubLlm(['x'.repeat(601), '请把这个模块重构得更清晰，并检查多余代码。'])
  const out = await run(llm, resolveConfig({ standardMaxRatio: 2.5 }))
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 2)
  assert.match(userText(llm.calls[1]), /budget of 600\b/)
})

test('LC-17 [Decision] standard capped at 2.5: still over after repair -> LENGTH_EXCEEDED', async () => {
  const llm = stubLlm(['x'.repeat(601), 'y'.repeat(601)])
  const out = await run(llm, resolveConfig({ standardMaxRatio: 2.5 }))
  assert.equal(out.ok, false)
  assert.equal(out.code, 'LENGTH_EXCEEDED')
  assert.equal(llm.calls.length, 2)
})

// ---------------------------------------------------------------- orchestrator: light mode

test('LC-18 [BVA] light default: exactly 600 chars passes with one call', async () => {
  const llm = stubLlm(['x'.repeat(600)])
  const out = await run(llm, resolveConfig({}), { mode: 'light' })
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 1)
})

test('LC-19 [BVA] light default: 601 chars -> one repair call with budget 600', async () => {
  const llm = stubLlm(['x'.repeat(601), '请把这个模块重构得更清晰。'])
  const out = await run(llm, resolveConfig({}), { mode: 'light' })
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 2)
  const body = userText(llm.calls[1])
  assert.match(body, /too long/)
  assert.match(body, /budget of 600\b/)
})

test('LC-20 [Decision] light default: over the ceiling twice -> LENGTH_EXCEEDED, draft kept', async () => {
  const llm = stubLlm(['x'.repeat(601), 'y'.repeat(601)])
  const out = await run(llm, resolveConfig({}), { mode: 'light' })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'LENGTH_EXCEEDED')
  assert.equal(llm.calls.length, 2)
})

test('LC-21 [BVA] light on a 400-char draft: 800 ok, 801 repaired against budget 800', async () => {
  const draft = '请整理'.repeat(133) + '一' // 400 chars, no hard facts
  assert.equal([...draft].length, 400)
  const okLlm = stubLlm(['x'.repeat(800)])
  const ok = await run(okLlm, resolveConfig({}), { mode: 'light', draft })
  assert.equal(ok.ok, true)
  assert.equal(okLlm.calls.length, 1)

  const overLlm = stubLlm(['x'.repeat(801), 'y'.repeat(801)])
  const over = await run(overLlm, resolveConfig({}), { mode: 'light', draft })
  assert.equal(over.code, 'LENGTH_EXCEEDED')
  assert.match(userText(overLlm.calls[1]), /budget of 800\b/)
})

test('LC-22 [Decision] the length gate switched off: light never repairs or refuses', async () => {
  const llm = stubLlm(['x'.repeat(5000)])
  const out = await run(llm, resolveConfig({ lengthGate: false }), { mode: 'light' })
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 1)
})
