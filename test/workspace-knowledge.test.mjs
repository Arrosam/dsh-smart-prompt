// Workspace knowledge (SMART-PROMPT.md) and last-turn context: improveDraft (lib/orchestrate.js)
// with stub model, stub knowledge store and stub sessions; resolveConfig (lib/config.js).
//
// Techniques:
//  - EP: file content (empty | non-empty); read (resolves | rejects); store (present | undefined);
//    update reply (new content | tag missing | empty tag | same as file | too long | model throws);
//    write (resolves | rejects); refinement (ok | failed); drafts (concrete | anaphoric | short vague).
//  - BVA: knowledgeChars 0 / default / negative / non-number; injected text truncated at exactly
//    knowledgeChars codepoints (astral chars); update length knowledgeChars vs knowledgeChars + 1;
//    contextTurns 0 / 1 / 3.
//  - Decision table: knowledge feature on = knowledgeChars > 0 AND sessionId !== '' AND store present.
//  - State transition: file absent -> created by update -> injected into the next refinement.
//  - System-level: a real filesystem-backed store in a temp dir, no background seam (fire-and-forget).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'

const CFG = resolveConfig({})
const DRAFT = '把 src/a.ts 的 maxRatioFor 改成 2.5'
const REWRITE = '请把 src/a.ts 中的 maxRatioFor 改为 2.5。'
const KNOW = '- 包管理器：pnpm\n- 测试：node --test'
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/** Scripted model: a step is { text?, usage?, throw? }; requests are snapshotted at call time. */
function stubLlm(script) {
  const calls = []
  return {
    calls,
    stream(options) {
      const tools = Array.isArray(options.tools) && options.tools.length > 0 ? clone(options.tools) : undefined
      calls.push({ system: clone(options.system), messages: clone(options.messages), tools })
      const step = script.length > 0 ? script.shift() : { text: '' }
      return (async function* () {
        if (step.throw !== undefined) throw new Error(step.throw)
        if (step.text !== undefined && step.text !== '') {
          yield { type: 'text-delta', index: 0, text: step.text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: step.text } }
        }
        if (step.usage !== undefined) yield { type: 'usage', usage: step.usage }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** Stub knowledge store; `content` may be an Error (read rejects); `writeError` makes write reject. */
function stubStore(content = '', { writeError } = {}) {
  const log = { reads: 0, writes: [], sessions: [] }
  const store = {
    async read() { log.reads += 1; if (content instanceof Error) throw content; return content },
    async write(text) { log.writes.push(text); if (writeError !== undefined) throw writeError },
  }
  const knowledge = (sessionId) => { log.sessions.push(sessionId); return store }
  return { log, knowledge }
}

const user = (text) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const model = (...content) => ({ role: 'assistant', source: { kind: 'model' }, content: content.map((c) => (typeof c === 'string' ? { type: 'text', text: c } : c)) })
const sessionsOf = (messages) => ({ get: () => ({ deriveMessages: () => messages }) })

/** One refinement; background tasks are collected, not run, until `flush()`. */
async function refine({ script = [{ text: REWRITE }, { text: '<no_change/>' }], cfg = CFG, store, sessions, draft = DRAFT, sessionId = 's1', background = true, depsOver = {} } = {}) {
  const llm = stubLlm(script)
  const tasks = []
  const deps = { llm, selection: { provider: 'p', model: 'm' }, lastRoute: null, ...depsOver }
  if (store !== undefined) deps.knowledge = store.knowledge
  if (sessions !== undefined) deps.sessions = sessions
  if (background) deps.background = (task) => { tasks.push(task) }
  const out = await improveDraft(deps, cfg, { draft, sessionId, mode: 'standard', signal: new AbortController().signal })
  const callsAtReturn = llm.calls.length
  const flush = async () => { for (const t of tasks.splice(0)) await t() }
  return { out, llm, tasks, flush, callsAtReturn }
}

const textOf = (m) => (m?.content ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
const firstUser = (call) => textOf(call.messages.find((m) => m.role === 'user'))
const lastUser = (call) => textOf([...call.messages].reverse().find((m) => m.role === 'user'))
const isUpdate = (call) => lastUser(call).includes('<knowledge_update>')
const between = (text, tag) => {
  const a = text.indexOf('<' + tag + '>')
  const b = text.indexOf('</' + tag + '>')
  return a < 0 || b < 0 ? null : text.slice(a + tag.length + 2, b)
}

async function waitFor(cond, label, ms = 3000) {
  const until = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > until) assert.fail('timed out waiting for ' + label)
    await new Promise((r) => setTimeout(r, 5))
  }
}

// ================================================================ config

test('WK-01 [BVA/EP knowledgeChars] default 4000; 0 kept; negative and non-number fall back to 4000', () => {
  assert.equal(CFG.knowledgeChars, 4000)
  assert.equal(resolveConfig({ knowledgeChars: 0 }).knowledgeChars, 0)
  assert.equal(resolveConfig({ knowledgeChars: 1 }).knowledgeChars, 1)
  assert.equal(resolveConfig({ knowledgeChars: 250 }).knowledgeChars, 250)
  for (const bad of [-1, -4000, 'abc', null, {}, NaN]) assert.equal(resolveConfig({ knowledgeChars: bad }).knowledgeChars, 4000, String(bad))
})

// ================================================================ injection at the start of a refinement

test('WK-02 [EP non-empty] the first user message starts with <workspace_knowledge> holding the file text; <raw_prompt> follows', async () => {
  const store = stubStore(KNOW)
  const { out, llm } = await refine({ store })
  assert.equal(out.ok, true, JSON.stringify(out))
  const body = firstUser(llm.calls[0])
  assert.ok(body.trimStart().startsWith('<workspace_knowledge>'), body.slice(0, 80))
  assert.ok(between(body, 'workspace_knowledge').includes(KNOW))
  assert.ok(body.indexOf('</workspace_knowledge>') < body.indexOf('<raw_prompt>'))
  assert.deepEqual(store.log.sessions, ['s1'])
})

test('WK-03 [EP empty file] an empty file adds no <workspace_knowledge> block', async () => {
  const { out, llm } = await refine({ store: stubStore('') })
  assert.equal(out.ok, true)
  assert.ok(!firstUser(llm.calls[0]).includes('<workspace_knowledge>'))
})

test('WK-04 [EP read rejects] a failing read still refines, without the block', async () => {
  const { out, llm } = await refine({ store: stubStore(new Error('disk gone')) })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.ok(!firstUser(llm.calls[0]).includes('<workspace_knowledge>'))
})

test('WK-05 [BVA truncation] the injected text is cut at exactly knowledgeChars codepoints', async () => {
  const cfg = resolveConfig({ knowledgeChars: 5 })
  const { llm } = await refine({ cfg, store: stubStore('😀'.repeat(7)) })
  const block = between(firstUser(llm.calls[0]), 'workspace_knowledge')
  assert.ok(block.includes('😀'.repeat(5)), block)
  assert.ok(!block.includes('😀'.repeat(6)), block)
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(block), 'no split surrogate pair')
})

test('WK-06 [BVA truncation] text of exactly knowledgeChars codepoints is injected whole', async () => {
  const cfg = resolveConfig({ knowledgeChars: 5 })
  const { llm } = await refine({ cfg, store: stubStore('abcde') })
  assert.ok(between(firstUser(llm.calls[0]), 'workspace_knowledge').includes('abcde'))
})

// ================================================================ when the feature runs (decision table)

test('WK-07 [Decision knowledgeChars 0] no read, no update call, no write', async () => {
  const store = stubStore(KNOW)
  const r = await refine({ cfg: resolveConfig({ knowledgeChars: 0 }), store, script: [{ text: REWRITE }, { text: '<workspace_knowledge>x</workspace_knowledge>' }] })
  await r.flush()
  assert.equal(r.out.ok, true)
  assert.equal(store.log.reads, 0)
  assert.equal(r.llm.calls.length, 1)
  assert.equal(store.log.writes.length, 0)
  assert.ok(!firstUser(r.llm.calls[0]).includes('<workspace_knowledge>'))
})

test('WK-08 [Decision sessionId ""] the knowledge seam is not called and nothing is updated', async () => {
  const store = stubStore(KNOW)
  const r = await refine({ store, sessionId: '', script: [{ text: REWRITE }, { text: '<workspace_knowledge>x</workspace_knowledge>' }] })
  await r.flush()
  assert.equal(r.out.ok, true)
  assert.deepEqual(store.log.sessions, [])
  assert.equal(store.log.reads, 0)
  assert.equal(r.llm.calls.length, 1)
})

test('WK-09 [Decision no store] knowledge(sessionId) returning undefined: plain refinement, no update call', async () => {
  const r = await refine({ depsOver: { knowledge: () => undefined } })
  await r.flush()
  assert.equal(r.out.ok, true)
  assert.equal(r.llm.calls.length, 1)
  assert.ok(!firstUser(r.llm.calls[0]).includes('<workspace_knowledge>'))
})

test('WK-10 [Decision no knowledge dep] without deps.knowledge exactly one call, no update', async () => {
  const r = await refine({})
  await r.flush()
  assert.equal(r.out.ok, true)
  assert.equal(r.llm.calls.length, 1)
})

// ================================================================ the update call

test('WK-11 [State] the update runs only through background, after the outcome resolved', async () => {
  const store = stubStore(KNOW)
  const r = await refine({ store })
  assert.equal(r.out.ok, true)
  assert.equal(r.callsAtReturn, 1, 'no update call before improveDraft returned')
  assert.equal(r.tasks.length, 1, 'one background task')
  await r.flush()
  assert.equal(r.llm.calls.length, 2, 'exactly one more call')
})

test('WK-12 [EP conversation] the update call continues the conversation: same prefix, same system, same tools, <knowledge_update> last', async () => {
  const r = await refine({ store: stubStore(KNOW) })
  await r.flush()
  const [first, update] = r.llm.calls
  assert.deepEqual(update.messages.slice(0, first.messages.length), first.messages, 'earlier messages unchanged')
  assert.ok(update.messages.length > first.messages.length + 1)
  assert.ok(textOf(update.messages[first.messages.length]).includes(REWRITE), 'the refinement reply follows as the assistant turn')
  assert.equal(update.messages[first.messages.length].role, 'assistant')
  assert.deepEqual(update.system, first.system)
  assert.deepEqual(update.tools, first.tools)
  assert.ok(isUpdate(update))
  assert.equal(update.messages.at(-1).role, 'user')
})

test('WK-13 [State repair] after a fidelity repair the update continues from the LAST refinement call', async () => {
  const store = stubStore(KNOW)
  const r = await refine({ store, script: [{ text: '请修改那个比例参数。' }, { text: REWRITE }, { text: '<no_change/>' }] })
  assert.equal(r.out.ok, true)
  assert.equal(r.callsAtReturn, 2)
  await r.flush()
  assert.equal(r.llm.calls.length, 3)
  const [, last, update] = r.llm.calls
  assert.deepEqual(update.messages.slice(0, last.messages.length), last.messages)
  assert.deepEqual(update.system, last.system)
  assert.ok(isUpdate(update))
})

test('WK-14 [EP new content] a tagged reply is written once, trimmed, with a trailing newline', async () => {
  const store = stubStore(KNOW)
  const r = await refine({ store, script: [{ text: REWRITE }, { text: '好的。\n<workspace_knowledge>\n  - 包管理器：pnpm\n- 新规则\n\n</workspace_knowledge>' }] })
  await r.flush()
  assert.deepEqual(store.log.writes, ['- 包管理器：pnpm\n- 新规则\n'])
})

test('WK-15 [EP no tag] <no_change/> writes nothing', async () => {
  const store = stubStore(KNOW)
  const r = await refine({ store, script: [{ text: REWRITE }, { text: '<no_change/>' }] })
  await r.flush()
  assert.equal(r.llm.calls.length, 2)
  assert.equal(store.log.writes.length, 0)
})

test('WK-16 [EP empty tag] a whitespace-only tag writes nothing', async () => {
  const store = stubStore(KNOW)
  const r = await refine({ store, script: [{ text: REWRITE }, { text: '<workspace_knowledge>  \n </workspace_knowledge>' }] })
  await r.flush()
  assert.equal(store.log.writes.length, 0)
})

test('WK-17 [EP unchanged] content equal to the file (after trimming both) writes nothing', async () => {
  const store = stubStore('\n' + KNOW + '\n')
  const r = await refine({ store, script: [{ text: REWRITE }, { text: '<workspace_knowledge>  ' + KNOW + '  </workspace_knowledge>' }] })
  await r.flush()
  assert.equal(store.log.writes.length, 0)
})

test('WK-18 [BVA update length] exactly knowledgeChars codepoints is written; one more is not', async () => {
  const cfg = resolveConfig({ knowledgeChars: 10 })
  const at = stubStore('')
  const r1 = await refine({ cfg, store: at, script: [{ text: REWRITE }, { text: '<workspace_knowledge>' + '😀'.repeat(10) + '</workspace_knowledge>' }] })
  await r1.flush()
  assert.deepEqual(at.log.writes, ['😀'.repeat(10) + '\n'])
  const over = stubStore('')
  const r2 = await refine({ cfg, store: over, script: [{ text: REWRITE }, { text: '<workspace_knowledge>' + '😀'.repeat(11) + '</workspace_knowledge>' }] })
  await r2.flush()
  assert.equal(over.log.writes.length, 0)
})

test('WK-19 [EP file missing] read "" and a tagged reply: write creates the file with the content', async () => {
  const store = stubStore('')
  const r = await refine({ store, script: [{ text: REWRITE }, { text: '<workspace_knowledge>- 用 pnpm</workspace_knowledge>' }] })
  await r.flush()
  assert.equal(r.llm.calls.length, 2)
  assert.deepEqual(store.log.writes, ['- 用 pnpm\n'])
})

test('WK-20 [EP model failure] an update call that throws is swallowed: no write, task resolves', async () => {
  const store = stubStore(KNOW)
  const r = await refine({ store, script: [{ text: REWRITE }, { throw: 'gateway exploded' }] })
  await assert.doesNotReject(r.flush())
  assert.equal(r.out.ok, true)
  assert.equal(store.log.writes.length, 0)
})

test('WK-21 [EP write rejects] a failing write is swallowed and the outcome is unchanged', async () => {
  const store = stubStore(KNOW, { writeError: new Error('read-only fs') })
  const r = await refine({ store, script: [{ text: REWRITE }, { text: '<workspace_knowledge>新</workspace_knowledge>' }] })
  const before = clone(r.out)
  await assert.doesNotReject(r.flush())
  assert.equal(store.log.writes.length, 1)
  assert.deepEqual(clone(r.out), before)
})

test('WK-22 [EP failed refinement] empty model output: no update call, no write', async () => {
  const store = stubStore(KNOW)
  const r = await refine({ store, script: [{ text: '' }, { text: '' }, { text: '<workspace_knowledge>x</workspace_knowledge>' }] })
  await r.flush()
  assert.equal(r.out.ok, false)
  assert.ok(!r.llm.calls.some(isUpdate), 'no <knowledge_update> call')
  assert.equal(store.log.writes.length, 0)
})

test('WK-23 [Differential outcome] the outcome is identical whether the update writes, declines or fails', async () => {
  const outs = []
  for (const second of [{ text: '<workspace_knowledge>新内容</workspace_knowledge>' }, { text: '<no_change/>' }, { throw: 'boom' }]) {
    const r = await refine({ store: stubStore(KNOW), script: [{ text: REWRITE }, second] })
    await r.flush()
    outs.push(r.out)
  }
  const strip = (o) => ({ ok: o.ok, text: o.text, contextUsed: o.meta?.contextUsed, anchors: o.meta?.anchors })
  assert.deepEqual(strip(outs[1]), strip(outs[0]))
  assert.deepEqual(strip(outs[2]), strip(outs[0]))
})

test('WK-24 [EP usage] the update call tokens are not in meta.usage', async () => {
  const r = await refine({
    store: stubStore(KNOW),
    script: [{ text: REWRITE, usage: { inputTokens: 10, outputTokens: 5 } }, { text: '<workspace_knowledge>新</workspace_knowledge>', usage: { inputTokens: 1000, outputTokens: 500 } }],
  })
  const usage = clone(r.out.meta.usage)
  await r.flush()
  assert.deepEqual(usage, { input: 10, cached: 0, output: 5 })
  assert.deepEqual(r.out.meta.usage, { input: 10, cached: 0, output: 5 })
})

// ================================================================ last-turn context

const TWO_TURNS = [user('用 FastAPI 写登录'), model('OLD_REPLY 好的'), user('LAST_Q 加上日志'), model('LAST_A 已加日志')]

test('WK-25 [EP concrete draft] the last turn is always included; contextUsed "last-turn"', async () => {
  const { out, llm } = await refine({ sessions: sessionsOf(TWO_TURNS), script: [{ text: REWRITE }] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.meta.contextUsed, 'last-turn')
  const block = between(firstUser(llm.calls[0]), 'conversation_context')
  assert.ok(block !== null, 'a <conversation_context> block')
  assert.ok(block.includes('LAST_Q') && block.includes('LAST_A'))
  assert.ok(!block.includes('FastAPI') && !block.includes('OLD_REPLY'), 'only the last turn')
})

test('WK-26 [EP final reply] the assistant side is the LAST text reply; tool calls, tool results and reasoning are left out', async () => {
  const messages = [
    user('LAST_Q 修复登录'),
    model({ type: 'reasoning', text: 'SECRET_THOUGHT' }, 'INTERIM_TEXT 我先看看', { type: 'tool-call', id: 'c1', name: 'read_file', arguments: '{"path":"TOOL_ARG"}' }),
    { role: 'tool', source: { kind: 'tool' }, toolCallId: 'c1', content: [{ type: 'text', text: 'TOOL_OUTPUT' }] },
    model({ type: 'thinking', text: 'SECRET_THINKING' }, 'FINAL_REPLY 已修复'),
  ]
  const { out, llm } = await refine({ sessions: sessionsOf(messages), script: [{ text: REWRITE }] })
  assert.equal(out.meta.contextUsed, 'last-turn')
  const block = between(firstUser(llm.calls[0]), 'conversation_context')
  assert.ok(block.includes('LAST_Q') && block.includes('FINAL_REPLY'), block)
  for (const gone of ['INTERIM_TEXT', 'SECRET_THOUGHT', 'SECRET_THINKING', 'TOOL_ARG', 'TOOL_OUTPUT', 'read_file']) assert.ok(!block.includes(gone), gone)
})

test('WK-27 [EP anaphora, BVA contextTurns 3] an anaphoric draft gets up to 3 turns; contextUsed "anaphora"', async () => {
  const messages = [user('T1_Q'), model('T1_A'), user('T2_Q'), model('T2_A'), user('T3_Q'), model('T3_A'), user('T4_Q'), model('T4_A')]
  const { out, llm } = await refine({ cfg: resolveConfig({ standardMaxRatio: 10 }), sessions: sessionsOf(messages), draft: '按刚才说的做', script: [{ text: '按上一轮商定的方案执行。' }] })
  assert.equal(out.meta.contextUsed, 'anaphora')
  const block = between(firstUser(llm.calls[0]), 'conversation_context')
  for (const kept of ['T2_Q', 'T3_A', 'T4_Q', 'T4_A']) assert.ok(block.includes(kept), kept)
  assert.ok(!block.includes('T1_Q'), 'the fourth-last turn is left out')
})

test('WK-28 [EP short vague] "修一下" gets smart context; contextUsed "short-vague"', async () => {
  const { out, llm } = await refine({ cfg: resolveConfig({ standardMaxRatio: 10 }), sessions: sessionsOf(TWO_TURNS), draft: '修一下', script: [{ text: '修复日志问题。' }] })
  assert.equal(out.meta.contextUsed, 'short-vague')
  const block = between(firstUser(llm.calls[0]), 'conversation_context')
  assert.ok(block.includes('LAST_A') && block.includes('OLD_REPLY'))
})

test('WK-29 [BVA contextTurns 1] an anaphoric draft with contextTurns 1 gets only the last turn', async () => {
  const { out, llm } = await refine({ cfg: resolveConfig({ contextTurns: 1, standardMaxRatio: 10 }), sessions: sessionsOf(TWO_TURNS), draft: '按刚才说的做', script: [{ text: '按上一轮商定的方案执行。' }] })
  assert.equal(out.meta.contextUsed, 'anaphora')
  const block = between(firstUser(llm.calls[0]), 'conversation_context')
  assert.ok(block.includes('LAST_A') && !block.includes('OLD_REPLY'))
})

test('WK-30 [BVA contextTurns 0] no context block for any draft; contextUsed "none"', async () => {
  const cfg = resolveConfig({ contextTurns: 0, standardMaxRatio: 10 })
  for (const draft of [DRAFT, '按刚才说的做']) {
    const { out, llm } = await refine({ cfg, sessions: sessionsOf(TWO_TURNS), draft, script: [{ text: draft === DRAFT ? REWRITE : '按方案执行。' }] })
    assert.equal(out.meta.contextUsed, 'none', draft)
    assert.ok(!firstUser(llm.calls[0]).includes('<conversation_context>'), draft)
  }
})

test('WK-31 [EP no complete turn] a session with only an unanswered user message: no block, "none"', async () => {
  for (const messages of [[], [user('还没回复')]]) {
    const { out, llm } = await refine({ sessions: sessionsOf(messages), script: [{ text: REWRITE }] })
    assert.equal(out.meta.contextUsed, 'none')
    assert.ok(!firstUser(llm.calls[0]).includes('<conversation_context>'))
  }
})

test('WK-32 [EP no session] sessionId "" never carries a context block', async () => {
  const { out, llm } = await refine({ sessions: sessionsOf(TWO_TURNS), sessionId: '', script: [{ text: REWRITE }] })
  assert.equal(out.meta.contextUsed, 'none')
  assert.ok(!firstUser(llm.calls[0]).includes('<conversation_context>'))
})

test('WK-33 [EP combined] knowledge and last-turn context together: knowledge first, then the draft frame', async () => {
  const { llm } = await refine({ store: stubStore(KNOW), sessions: sessionsOf(TWO_TURNS) })
  const body = firstUser(llm.calls[0])
  assert.ok(body.trimStart().startsWith('<workspace_knowledge>'))
  assert.ok(body.includes('<conversation_context>'))
  assert.ok(body.indexOf('<workspace_knowledge>') < body.indexOf('<raw_prompt>'))
})

// ================================================================ system-level: real file, fire-and-forget

test('WK-34 [State absent -> created -> injected] a real SMART-PROMPT.md is created by one refinement and fed into the next', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wk-'))
  const file = join(dir, 'SMART-PROMPT.md')
  const knowledge = () => ({
    read: async () => { try { return await readFile(file, 'utf8') } catch { return '' } },
    write: async (text) => { await writeFile(file, text, 'utf8') },
  })
  try {
    const first = await refine({ depsOver: { knowledge }, background: false, script: [{ text: REWRITE }, { text: '<workspace_knowledge>- 项目用 pnpm</workspace_knowledge>' }] })
    assert.equal(first.out.ok, true)
    assert.ok(!firstUser(first.llm.calls[0]).includes('<workspace_knowledge>'), 'no file yet: no block')
    await waitFor(async () => { try { return (await readFile(file, 'utf8')) === '- 项目用 pnpm\n' } catch { return false } }, 'the file to be written')

    const second = await refine({ depsOver: { knowledge }, background: false, script: [{ text: REWRITE }, { text: '<no_change/>' }] })
    assert.equal(second.out.ok, true)
    assert.ok(between(firstUser(second.llm.calls[0]), 'workspace_knowledge').includes('- 项目用 pnpm'))
    await waitFor(() => second.llm.calls.length === 2, 'the second update call')
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(await readFile(file, 'utf8'), '- 项目用 pnpm\n', '<no_change/> leaves the file alone')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
