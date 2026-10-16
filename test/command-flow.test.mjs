import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'

const CFG = resolveConfig({})

function stubLlm(script) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      const step = script.length > 0 ? script.shift() : { text: '' }
      return (async function* () {
        if (step.text !== undefined && step.text !== '') yield { type: 'text-delta', index: 0, text: step.text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}
const deps = (llm) => ({ llm, selection: { provider: 'p', model: 'm' }, lastRoute: null })
const call = (draft) => ({ draft, sessionId: '', mode: 'standard', signal: new AbortController().signal })

test('a command with a body enhances the body and keeps the prefix', async () => {
  const llm = stubLlm([{ text: '排查 ISS-202607-00090605A：复现填充后密码框被清空的路径。' }])
  const out = await improveDraft(deps(llm), CFG, call('/bugfix ISS-202607-00090605A 填充后密码框被清空'))
  assert.equal(out.ok, true)
  assert.match(out.text, /^\/bugfix /, 'the command prefix is put back verbatim')
  assert.match(out.text, /ISS-202607-00090605A/)
  // the model never sees the command token as rewrite material
  const body = llm.calls[0].messages[0].content[0].text
  assert.ok(!body.includes('/bugfix'), 'the command token is not sent for rewriting')
  assert.match(body, /ISS-202607-00090605A/)
})

test('a command with a body does not trip the command guard', async () => {
  const llm = stubLlm([{ text: '把登录接口改快一点，先定位耗时点。' }])
  const out = await improveDraft(deps(llm), CFG, call('/bugfix 把登录接口改快一点'))
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 1)
})

test('a command with no body is refused with the accurate code and copy', async () => {
  const llm = stubLlm([])
  const out = await improveDraft(deps(llm), CFG, call('/bugfix'))
  assert.equal(out.ok, false)
  assert.equal(out.code, 'COMMAND')
  assert.match(out.message, /没有可改写的正文/)
  assert.equal(llm.calls.length, 0, 'zero model traffic')
})

test('the length gate measures the body, not the command prefix', async () => {
  // body is 16 chars; standard mode is uncapped by default (and even a 2.5x cap would
  // give max(600, 16*2.5) = 600), so a 150-char rewrite passes
  const llm = stubLlm([{ text: 'x'.repeat(150) }])
  const out = await improveDraft(deps(llm), CFG, call('/bugfix 把登录接口改快一点顺便看看网络层'))
  assert.equal(out.ok, true)
  assert.ok(out.text.startsWith('/bugfix '))
})

test('the fidelity gate protects facts inside the body', async () => {
  const llm = stubLlm([
    { text: '排查那个问题。' },
    { text: '排查 src/host/config.ts 里的 maxRatioFor 问题。' },
  ])
  const out = await improveDraft(deps(llm), CFG, call('/bugfix src/host/config.ts 的 maxRatioFor 有问题'))
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 2, 'the repair pass fired for a dropped body fact')
  assert.match(out.text, /^\/bugfix /)
  assert.match(out.text, /src\/host\/config\.ts/)
})

test('a non-command draft behaves exactly as before', async () => {
  const llm = stubLlm([{ text: '把登录接口改快一点。' }])
  const out = await improveDraft(deps(llm), CFG, call('把登录接口改快一点'))
  assert.equal(out.ok, true)
  assert.ok(!out.text.startsWith('/'))
})
