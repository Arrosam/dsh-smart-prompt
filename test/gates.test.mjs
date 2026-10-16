import test from 'node:test'
import assert from 'node:assert/strict'
import { ratioOf, lengthVerdict, formatRatio, charLength, budgetFor, overBudget, MIN_BUDGET_CHARS } from '../lib/length-gate.js'
import { contextTrigger } from '../lib/context-trigger.js'
import { normalizeOutput } from '../lib/normalize.js'
import { collectTurns, formatHistoryBlock } from '../lib/history.js'

// ---------- length gate ----------
test('ratio and formatted ratio', () => {
  assert.equal(ratioOf('abcd', 'abcdefgh'), 2)
  assert.equal(ratioOf('', 'abc'), 0)
  assert.equal(formatRatio(1.44), '1.4x')
})

test('a rewrite inside the ceiling is ok', () => {
  assert.equal(lengthVerdict('a'.repeat(100), 'b'.repeat(200), 2.5).kind, 'ok')
})

test('an inflated rewrite asks for convergence with a character budget', () => {
  const verdict = lengthVerdict('a'.repeat(1000), 'b'.repeat(9000), 2.5)
  assert.equal(verdict.kind, 'converge')
  assert.equal(verdict.charBudget, 2500)
})

test('the ratio scales with the draft above the floor', () => {
  assert.equal(budgetFor('a'.repeat(1000), 2.5), 2500)
  assert.equal(budgetFor('a'.repeat(1000), 1.2), 1200)
})

test('a short draft is governed by the absolute floor, not the ratio', () => {
  const draft = '把那个接口加上限流'
  assert.equal(budgetFor(draft, 2.5), MIN_BUDGET_CHARS)
  assert.equal(lengthVerdict(draft, 'x'.repeat(150), 2.5).kind, 'ok')
  assert.equal(overBudget(draft, 'x'.repeat(150), 2.5), false)
  // BVA on the 600-char floor: exactly at the floor passes, one over is refused.
  assert.equal(overBudget(draft, 'x'.repeat(600), 2.5), false)
  assert.equal(overBudget(draft, 'x'.repeat(601), 2.5), true)
})

test('the floor never loosens a long draft', () => {
  assert.equal(overBudget('a'.repeat(400), 'b'.repeat(1001), 2.5), true)
  assert.equal(overBudget('a'.repeat(400), 'b'.repeat(1000), 2.5), false)
})

test('codepoint length counts an emoji as one character', () => {
  assert.equal(charLength('👍'), 1)
})

// ---------- context trigger (design option C) ----------
test('chinese anaphora triggers context', () => {
  assert.deepEqual(contextTrigger('把那个接口加上限流'), { needed: true, reason: 'anaphora' })
  assert.equal(contextTrigger('按刚才说的做').reason, 'anaphora')
})

test('english anaphora is word-bounded', () => {
  assert.equal(contextTrigger('continue with the same approach').reason, 'anaphora')
  // "item" / "wait" contain "it" but must not fire
  assert.equal(contextTrigger('refactor the item list and wait for review').needed, false)
})

test('a very short vague draft triggers context', () => {
  assert.deepEqual(contextTrigger('修一下'), { needed: true, reason: 'short-vague' })
})

test('a short draft with a concrete fact does not need context', () => {
  assert.equal(contextTrigger('改 a.ts').needed, false)
  assert.equal(contextTrigger('端口 8080').needed, false)
})

test('a self-sufficient sentence needs no context', () => {
  assert.equal(contextTrigger('给登录接口增加按 IP 的限流，每分钟 60 次').needed, false)
})

// ---------- output normalization ----------
test('strips a whole-text code fence', () => {
  assert.equal(normalizeOutput('```markdown\n请修改配置\n```'), '请修改配置')
})

test('strips a leading preamble line but keeps the body', () => {
  assert.equal(normalizeOutput('以下是优化后的提示词：\n\n请修改配置'), '请修改配置')
})

test('strips matching surrounding quotes', () => {
  assert.equal(normalizeOutput('"请修改配置"'), '请修改配置')
})

test('keeps a legitimate inner code block', () => {
  const text = '请执行：\n```sh\npnpm build\n```'
  assert.equal(normalizeOutput(text), text)
})

test('returns empty for unusable output', () => {
  assert.equal(normalizeOutput(''), '')
  assert.equal(normalizeOutput('   \n  '), '')
})

// ---------- history ----------
const msg = (role, kind, text) => ({ role, source: { kind }, content: [{ type: 'text', text }] })

test('pairs human messages with assistant prose and drops tool traffic', () => {
  const messages = [
    msg('user', 'user', '用 FastAPI 写登录'),
    { role: 'user', source: { kind: 'tool' }, content: [{ type: 'tool-result', text: 'SECRET FILE CONTENT' }] },
    msg('assistant', 'model', '好的，用 FastAPI + JWT'),
  ]
  const turns = collectTurns(messages, 3, 6000)
  assert.equal(turns.length, 1)
  assert.equal(turns[0].user, '用 FastAPI 写登录')
  assert.match(turns[0].assistant, /FastAPI/)
})

test('plugin-injected context is never carried', () => {
  const messages = [msg('user', 'plugin', 'catalog of tools'), msg('user', 'user', 'hi'), msg('assistant', 'model', 'ok')]
  const turns = collectTurns(messages, 3, 6000)
  assert.equal(turns.length, 1)
  assert.equal(turns[0].user, 'hi')
})

test('keeps only the most recent N turns and tolerates junk', () => {
  const messages = []
  for (let i = 0; i < 6; i += 1) {
    messages.push(msg('user', 'user', 'q' + String(i)))
    messages.push(msg('assistant', 'model', 'a' + String(i)))
  }
  const turns = collectTurns(messages, 2, 6000)
  assert.deepEqual(turns.map((x) => x.user), ['q4', 'q5'])
  assert.deepEqual(collectTurns(undefined, 3, 6000), [])
  assert.deepEqual(collectTurns(messages, 0, 6000), [])
})

test('long assistant replies are tail-truncated', () => {
  const messages = [msg('user', 'user', 'q'), msg('assistant', 'model', 'x'.repeat(2000))]
  const turns = collectTurns(messages, 1, 6000)
  assert.ok(turns[0].assistant.length <= 601)
})

test('history block renders only when there is something to say', () => {
  assert.equal(formatHistoryBlock([]), '')
  const block = formatHistoryBlock([{ user: 'q', assistant: 'a' }])
  assert.match(block, /<conversation_context>/)
  assert.match(block, /用户: q/)
})
