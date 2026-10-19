// Session lookups: the search_session / read_session_messages tools offered to the
// refinement model, driven black-box through improveDraft with a scripted model, plus
// the exported names and messagesOfLog (lib/session-lookup.js).
//
// Techniques:
//  - Decision table: tools offered = lookupRounds > 0 AND sessionId !== '' AND
//    sessionMessages present (each condition false on its own -> not offered).
//  - State transition: offering -> round used -> offering (rounds left) | used up (same
//    tools and system, further calls not run); offering -> upstream failure -> plain (tools
//    disabled for the rest of the refinement).
//  - One conversation per refinement: lookup results come back as native tool-result
//    messages after the reply that called them.
//  - BVA: lookupRounds 0/1/3; calls per round 4 vs 5; read count default/5/6; read
//    from 0/1/last/last+1.
//  - EP: message kinds (typed user, model reply, tool, injected user, injected assistant,
//    image-only user); tool names (search, read, unknown); argument kinds (valid, empty,
//    malformed JSON); upstream failure kinds (throw, error finish).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'
import { LOOKUP_TOOLS, READ_TOOL, SEARCH_TOOL, messagesOfLog } from '../lib/session-lookup.js'

const CFG = resolveConfig({})
const MAX_CALLS_PER_ROUND = 4
const MAX_READ_COUNT = 5

/** A self-contained draft (no smart-context trigger) and a rewrite that keeps its facts. */
const DRAFT = '给登录接口增加按 IP 的限流，每分钟 60 次'
const REWRITE = '为登录接口增加按 IP 的限流，每分钟 60 次。'

const typed = (text) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const reply = (text) => ({ role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text }] })
const image = { type: 'image', attachment: { attachmentId: 'sha256:aa', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }

/**
 * A conversation with six searchable messages (#1..#6) interleaved with messages that
 * must never be searchable. The comments give the expected numbering.
 */
const TRANSCRIPT = [
  typed('Use FastAPI for the login endpoint'), // #1
  { role: 'tool', source: { kind: 'tool' }, content: [{ type: 'text', text: 'TOOLDATA FastAPI token=abc123' }] },
  reply('OK, FastAPI + JWT tokens'), // #2
  { role: 'user', source: { kind: 'context' }, content: [{ type: 'text', text: 'INJECTED FastAPI skill notice' }] },
  { role: 'assistant', source: { kind: 'injected' }, content: [{ type: 'text', text: 'FORGED FastAPI reply' }] },
  { role: 'user', source: { kind: 'user' }, content: [image] },
  typed('Add rate limiting later, maybe 60/min'), // #3
  reply('Noted: rate limit 60 per minute'), // #4
  typed('Version a.b of the API'), // #5
  reply('axb is not a version'), // #6
]
const LAST = 6

/** The id the scripted model gives its `index`-th (1-based) tool call in a reply. */
const callId = (index) => 'call-' + String(index)

/**
 * Scripted model. A step is `{ text }`, `{ throw }`, `{ finishError }`, or
 * `{ tools: [{ name, args | raw, deltaArgs? }], text? }`. Tool calls stream as deltas
 * followed by the authoritative block-end. Records every request.
 */
function stubLlm(script) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      const step = script.length > 0 ? script.shift() : { text: '' }
      return (async function* () {
        if (step.throw !== undefined) throw new Error(step.throw)
        if (step.finishError !== undefined) {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: step.finishError, code: 'X' } } }
          return
        }
        if (step.text !== undefined && step.text !== '') yield { type: 'text-delta', index: 0, text: step.text }
        for (const [i, c] of (step.tools ?? []).entries()) {
          const index = i + 1
          const id = callId(index)
          const args = c.raw !== undefined ? c.raw : JSON.stringify(c.args ?? {})
          yield { type: 'tool-call-delta', index, id, name: c.name, argumentsDelta: c.deltaArgs ?? args }
          yield { type: 'block-end', index, block: { type: 'tool-call', id, name: c.name, arguments: args } }
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** A sessionMessages dep that records its calls. */
function stubMessages(messages = TRANSCRIPT) {
  const calls = []
  const load = async (sessionId) => {
    calls.push(sessionId)
    if (messages instanceof Error) throw messages
    return messages
  }
  return { calls, load }
}

const input = (over = {}) => ({ draft: DRAFT, sessionId: 's1', mode: 'standard', signal: new AbortController().signal, ...over })
const deps = (llm, over = {}) => ({ llm, selection: { provider: 'p', model: 'm' }, lastRoute: null, ...over })

/** Run one refinement with lookups enabled (rounds default 3). */
async function refine(script, { rounds = 3, messages = TRANSCRIPT, depsOver = {}, inputOver = {} } = {}) {
  const llm = stubLlm(script)
  const loader = stubMessages(messages)
  const out = await improveDraft(deps(llm, { sessionMessages: loader.load, ...depsOver }), CFG, input({ lookupRounds: rounds, ...inputOver }))
  return { out, llm, loader }
}

/** Text of a request's first user turn (the framed draft). */
const userText = (call) => call.messages[0].content[0].text
/** Text of a request's latest user turn (answers and repair steps are appended as new turns). */
const lastUserText = (call) => call.messages.filter((m) => m.role === 'user').at(-1).content[0].text
const offersTools = (call) => 'tools' in call

/** The native tool-result messages a request carries, oldest first. */
const toolResults = (call) => call.messages.filter((m) => m.role === 'tool')
/** Every tool output a request carries, joined by newlines ('' when none). */
const toolOutputs = (call) => toolResults(call).map((m) => m.content.map((p) => p.text ?? '').join('')).join('\n')

/** Tools and system prompt are fixed for a whole refinement: `call` declares exactly what `first` did. */
function assertSameOffer(call, first, label) {
  assert.ok(offersTools(first), label + ': the first request offers tools')
  assert.deepEqual(call.tools, first.tools, label + ': same tools')
  assert.equal(call.system, first.system, label + ': same system prompt')
}

/** One lookup round with `tools`, then a plain rewrite; returns the tool outputs the second request carried. */
async function roundResult(tools, opts = {}) {
  const run = await refine([{ tools }, { text: REWRITE }], opts)
  assert.equal(run.out.ok, true, JSON.stringify(run.out))
  assert.equal(run.llm.calls.length, 2)
  const answered = toolResults(run.llm.calls[1]).map((m) => m.toolCallId).sort()
  assert.deepEqual(answered, tools.map((_, i) => callId(i + 1)).sort(), 'the follow-up request answers every call with one tool result')
  return toolOutputs(run.llm.calls[1])
}

const search = (query) => ({ name: 'search_session', args: { query } })
const read = (args) => ({ name: 'read_session_messages', args })

// ================================================================ exports

test('SL-01 [EP names] the tool names are search_session and read_session_messages', () => {
  assert.equal(SEARCH_TOOL, 'search_session')
  assert.equal(READ_TOOL, 'read_session_messages')
  assert.deepEqual(LOOKUP_TOOLS.map((t) => t.name).sort(), ['read_session_messages', 'search_session'])
})

test('SL-02 [EP schema] each lookup tool has a name, a description and parameters', () => {
  for (const tool of LOOKUP_TOOLS) {
    assert.equal(typeof tool.name, 'string')
    assert.ok(typeof tool.description === 'string' && tool.description.length > 0, tool.name)
    assert.equal(typeof tool.parameters, 'object', tool.name)
    assert.ok(tool.parameters !== null, tool.name)
  }
})

// ================================================================ when tools are offered (decision table)

test('SL-03 [Decision all true] rounds > 0, a session and a message loader: the first request offers both lookup tools', async () => {
  const { out, llm } = await refine([{ text: REWRITE }], { rounds: 1 })
  assert.equal(out.ok, true)
  assert.ok(offersTools(llm.calls[0]))
  assert.deepEqual(llm.calls[0].tools.map((t) => t.name).sort(), ['read_session_messages', 'search_session'])
  for (const tool of llm.calls[0].tools) {
    assert.equal(typeof tool.description, 'string', tool.name)
    assert.equal(typeof tool.parameters, 'object', tool.name)
  }
})

test('SL-04 [BVA rounds 0] lookupRounds 0 offers no tools and never loads the session', async () => {
  const { llm, loader } = await refine([{ text: REWRITE }], { rounds: 0 })
  assert.equal(offersTools(llm.calls[0]), false, 'the tools key is absent')
  assert.equal(loader.calls.length, 0)
})

test('SL-05 [Decision rounds absent] without lookupRounds no request offers tools and the session is never loaded', async () => {
  const llm = stubLlm([{ text: REWRITE }])
  const loader = stubMessages()
  const out = await improveDraft(deps(llm, { sessionMessages: loader.load }), CFG, input())
  assert.equal(out.ok, true)
  assert.equal(offersTools(llm.calls[0]), false)
  assert.equal(loader.calls.length, 0)
})

test('SL-06 [Decision no session] sessionId "" offers no tools and never loads a session', async () => {
  const { llm, loader } = await refine([{ text: REWRITE }], { inputOver: { sessionId: '' } })
  assert.equal(offersTools(llm.calls[0]), false)
  assert.equal(loader.calls.length, 0)
})

test('SL-07 [Decision no loader] a host without sessionMessages offers no tools', async () => {
  const llm = stubLlm([{ text: REWRITE }])
  const out = await improveDraft(deps(llm), CFG, input({ lookupRounds: 3 }))
  assert.equal(out.ok, true)
  assert.equal(offersTools(llm.calls[0]), false)
})

test('SL-08 [EP no lookup used] a direct answer costs one call, loads nothing and reports 0 lookups', async () => {
  const { out, llm, loader } = await refine([{ text: REWRITE }])
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 1)
  assert.equal(loader.calls.length, 0, 'the session is loaded lazily, on the first round')
  assert.equal(out.meta.lookups, 0)
  assert.equal(out.meta.contextUsed, 'none')
  assert.equal(out.text, REWRITE)
})

// ================================================================ rounds (state transitions)

test('SL-09 [State offering->round->offering] one round: the next request appends the tool-call reply and its result to the conversation and still offers tools', async () => {
  const { out, llm } = await refine([{ tools: [search('FastAPI')] }, { text: REWRITE }])
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 2, 'rounds used + 1')
  const [first, second] = llm.calls
  assert.match(userText(second), /<raw_prompt>[\s\S]*<\/raw_prompt>/, 'the draft is sent again')
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages, 'the first request is a prefix of the second')
  const [assistant, result, ...rest] = second.messages.slice(first.messages.length)
  assert.equal(assistant.role, 'assistant')
  assert.ok(assistant.content.some((b) => b.type === 'tool-call' && b.id === callId(1) && b.name === 'search_session'), 'the reply keeps its tool call')
  assert.equal(result.role, 'tool')
  assert.equal(result.toolCallId, callId(1))
  assert.deepEqual(rest, [], 'nothing else is appended')
  assert.match(toolOutputs(second), /FastAPI/)
  assert.ok(offersTools(second), 'two of three rounds remain')
  assert.equal(out.text, REWRITE)
})

test('SL-10 [BVA rounds 1] with one round, the request after it keeps the same tools and system prompt and carries the results', async () => {
  const { out, llm } = await refine([{ tools: [search('FastAPI')] }, { text: REWRITE }], { rounds: 1 })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 2)
  assertSameOffer(llm.calls[1], llm.calls[0], 'after the last round')
  assert.match(toolOutputs(llm.calls[1]), /FastAPI/, 'the results still reach the final request')
  assert.equal(out.meta.lookups, 1)
})

test('SL-11 [BVA rounds 3] three rounds used: four calls, all with the same tools, meta.lookups 3', async () => {
  const { out, llm } = await refine([
    { tools: [search('FastAPI')] },
    { tools: [search('rate')] },
    { tools: [search('Version')] },
    { text: REWRITE },
  ], { rounds: 3 })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 4)
  for (const [i, call] of llm.calls.entries()) assertSameOffer(call, llm.calls[0], 'call ' + String(i))
  assert.equal(out.meta.lookups, 3)
})

test('SL-12 [EP rounds left] two of three rounds used: three calls, all offering tools, meta.lookups 2', async () => {
  const { out, llm } = await refine([{ tools: [search('FastAPI')] }, { tools: [search('rate')] }, { text: REWRITE }], { rounds: 3 })
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 3)
  assert.deepEqual(llm.calls.map(offersTools), [true, true, true])
  assert.equal(out.meta.lookups, 2)
})

test('SL-13 [State] results gathered in earlier rounds are still in the conversation after a later round', async () => {
  const { llm } = await refine([{ tools: [search('FastAPI')] }, { tools: [search('Version')] }, { text: REWRITE }])
  const block = toolOutputs(llm.calls[2])
  assert.match(block, /#1 user: .*FastAPI/)
  assert.match(block, /#5 user: .*Version a\.b/)
})

test('SL-14 [EP text+tools] a response with text and tool calls still counts as a round', async () => {
  const { out, llm } = await refine([{ text: 'let me check', tools: [search('FastAPI')] }, { text: REWRITE }])
  assert.equal(out.ok, true)
  assert.equal(llm.calls.length, 2)
  assert.equal(out.meta.lookups, 1)
  assert.equal(out.text, REWRITE)
})

test('SL-15 [EP no tools offered] tool calls on a request without tools still fail with TOOL_CALL', async () => {
  const { out } = await refine([{ tools: [search('FastAPI')] }], { rounds: 0 })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'TOOL_CALL')
})

test('SL-16 [State final] tool calls after the rounds are used up fail with TOOL_CALL', async () => {
  const { out, llm } = await refine([{ tools: [search('FastAPI')] }, { tools: [search('rate')] }], { rounds: 1 })
  assert.equal(llm.calls.length, 2)
  assert.equal(out.ok, false)
  assert.equal(out.code, 'TOOL_CALL')
})

test('SL-17 [EP stream] the block-end tool call is authoritative over the streamed deltas', async () => {
  const block = await roundResult([{ name: 'search_session', args: { query: 'Version' }, deltaArgs: '{"query":"FastAPI"}' }])
  assert.match(block, /#5 user: .*Version a\.b/)
  assert.doesNotMatch(block, /#1 user/, 'the delta arguments are not used')
})

// ================================================================ loading the session

test('SL-18 [State] the session is loaded once per refinement, for the request session, however many rounds run', async () => {
  const { loader } = await refine([
    { tools: [search('FastAPI'), read({ from: 1 })] },
    { tools: [search('rate')] },
    { tools: [read({ from: 2 })] },
    { text: REWRITE },
  ], { inputOver: { sessionId: 'sess-42' } })
  assert.deepEqual(loader.calls, ['sess-42'])
})

test('SL-19 [EP loader rejects] a failing session load does not fail the refinement', async () => {
  const { out, llm } = await refine([{ tools: [search('FastAPI')] }, { text: REWRITE }], { messages: new Error('store down') })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 2)
  assert.equal(out.text, REWRITE)
})

test('SL-20 [EP loader rejects] after a failing session load, a search finds nothing', async () => {
  const block = await roundResult([search('FastAPI')], { messages: new Error('store down') })
  assert.match(block, /No earlier message matches\./)
})

// ================================================================ calls per round (BVA 4/5)

test('SL-21 [BVA 4 calls] four calls in one round all run, with no "Not run" note', async () => {
  const block = await roundResult([search('FastAPI'), search('rate'), search('Version'), search('axb')])
  assert.match(block, /#1 user: .*FastAPI/)
  assert.match(block, /#3 user: .*rate limiting/)
  assert.match(block, /#5 user: .*Version a\.b/)
  assert.match(block, /#6 assistant: .*axb/)
  assert.doesNotMatch(block, /Not run/)
})

test('SL-22 [BVA 5 calls] a fifth call in one round is not run and gets a "Not run" note', async () => {
  // Queries chosen so only the fifth one could ever match #6.
  const block = await roundResult([search('FastAPI'), search('rate'), search('a.b'), search('zzz-nothing'), search('axb')])
  assert.match(block, /#1 user: .*FastAPI/)
  assert.match(block, /#5 user: .*Version a\.b/)
  assert.match(block, /No earlier message matches\./, 'the fourth call ran')
  assert.doesNotMatch(block, /#6 assistant/, 'the fifth call did not run')
  assert.match(block, /Not run/)
  assert.equal(MAX_CALLS_PER_ROUND, 4)
})

// ================================================================ search_session

test('SL-23 [EP search] a match is listed as "#<n> user|assistant: <excerpt>", case-insensitively', async () => {
  const block = await roundResult([search('fastapi')])
  assert.match(block, /#1 user: .*FastAPI/)
  assert.match(block, /#2 assistant: .*FastAPI/)
})

test('SL-24 [EP excluded messages] tool results, injected user context and non-model assistant messages never match', async () => {
  const block = await roundResult([search('FastAPI')])
  assert.ok(!block.includes('TOOLDATA'), 'tool message')
  assert.ok(!block.includes('abc123'), 'tool message')
  assert.ok(!block.includes('INJECTED'), 'injected user message')
  assert.ok(!block.includes('FORGED'), 'assistant message not written by the model')
})

test('SL-25 [EP only excluded matches] a term found only in excluded messages finds nothing', async () => {
  const block = await roundResult([search('TOOLDATA'), search('INJECTED')])
  assert.equal(block.match(/No earlier message matches\./g)?.length, 2)
  assert.ok(!block.includes('abc123'))
  assert.ok(!block.includes('skill notice'))
})

test('SL-26 [EP literal] the query is matched literally, not as a pattern', async () => {
  const block = await roundResult([search('a.b')])
  assert.match(block, /#5 user: .*Version a\.b/)
  assert.doesNotMatch(block, /#3 user/, '"maybe" would match the regex a.b')
  assert.doesNotMatch(block, /#6 assistant/, '"axb" would match the regex a.b')
})

test('SL-27 [EP no match] a query nothing contains answers "No earlier message matches."', async () => {
  const block = await roundResult([search('kubernetes')])
  assert.match(block, /No earlier message matches\./)
})

test('SL-28 [BVA empty query] an empty query answers "Empty query."', async () => {
  const block = await roundResult([search('')])
  assert.match(block, /Empty query\./)
})

test('SL-29 [EP malformed args] malformed JSON arguments are treated as no arguments', async () => {
  const block = await roundResult([{ name: 'search_session', raw: '{"query": "FastAPI"' }])
  assert.match(block, /Empty query\./)
})

test('SL-30 [EP numbering] numbering counts only searchable messages with text, oldest first', async () => {
  const block = await roundResult([search('rate'), search('axb')])
  assert.match(block, /#3 user: .*rate limiting/)
  assert.match(block, /#4 assistant: .*rate limit 60/)
  assert.match(block, /#6 assistant: .*axb/)
})

// ================================================================ read_session_messages

test('SL-31 [EP read] a read returns full messages as "#<n> <speaker>:\\n<text>"', async () => {
  const block = await roundResult([read({ from: 2, count: 2 })])
  assert.ok(block.includes('#2 assistant:\nOK, FastAPI + JWT tokens'), block)
  assert.ok(block.includes('#3 user:\nAdd rate limiting later, maybe 60/min'), block)
})

test('SL-32 [BVA count default] without a count one message is read', async () => {
  const block = await roundResult([read({ from: 1 })])
  assert.ok(block.includes('#1 user:\nUse FastAPI for the login endpoint'), block)
  assert.ok(!block.includes('#2 assistant'), 'only one message')
})

test('SL-33 [BVA count 5] a count of 5 reads five messages', async () => {
  const block = await roundResult([read({ from: 1, count: 5 })])
  for (const n of [1, 2, 3, 4, 5]) assert.match(block, new RegExp('#' + String(n) + ' (user|assistant):\\n'), '#' + String(n))
  assert.doesNotMatch(block, /#6 assistant:\n/)
})

test('SL-34 [BVA count 6] a count above 5 is capped at five messages', async () => {
  const block = await roundResult([read({ from: 1, count: 6 })])
  assert.match(block, /#5 user:\nVersion a\.b of the API/)
  assert.doesNotMatch(block, /#6 assistant:\n/, 'at most ' + String(MAX_READ_COUNT) + ' messages')
})

test('SL-35 [BVA from last] reading from the last message returns it', async () => {
  const block = await roundResult([read({ from: LAST, count: 3 })])
  assert.ok(block.includes('#6 assistant:\naxb is not a version'), block)
})

test('SL-36 [BVA from 0] a from below 1 is out of range and names the valid range', async () => {
  const block = await roundResult([read({ from: 0 })])
  assert.match(block, /\b1\b\D{0,20}\b6\b/, 'names 1..6: ' + block)
  assert.ok(!block.includes('Use FastAPI for the login endpoint'), 'no message is returned')
})

test('SL-37 [BVA from last+1] a from past the last message is out of range and names the valid range', async () => {
  const block = await roundResult([read({ from: LAST + 1 })])
  assert.match(block, /\b1\b\D{0,20}\b6\b/, 'names 1..6: ' + block)
  assert.ok(!block.includes('axb is not a version'), 'no message is returned')
})

test('SL-38 [EP excluded messages] reading across excluded messages skips them', async () => {
  const block = await roundResult([read({ from: 1, count: 3 })])
  assert.ok(!block.includes('TOOLDATA'))
  assert.ok(!block.includes('INJECTED'))
  assert.ok(!block.includes('FORGED'))
  assert.ok(block.includes('#3 user:\nAdd rate limiting later, maybe 60/min'))
})

test('SL-39 [EP unknown tool] an unknown tool name answers "Unknown tool"', async () => {
  const block = await roundResult([{ name: 'delete_session', args: {} }])
  assert.match(block, /Unknown tool/)
})

// ================================================================ upstream refusal of tools (state: offering -> plain)

test('SL-40 [EP throw] a request offering tools that throws is retried without tools and succeeds', async () => {
  const { out, llm } = await refine([{ throw: 'tools unsupported' }, { text: REWRITE }])
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 2)
  assert.ok(offersTools(llm.calls[0]))
  assert.equal(offersTools(llm.calls[1]), false)
  assert.equal(out.text, REWRITE)
  assert.equal(out.meta.lookups, 0)
})

test('SL-41 [EP error finish] a request offering tools that finishes with an error is retried without tools', async () => {
  const { out, llm } = await refine([{ finishError: 'tools unsupported' }, { text: REWRITE }])
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 2)
  assert.equal(offersTools(llm.calls[1]), false)
})

test('SL-42 [State] after a refused round request, the rest of the refinement offers no tools', async () => {
  const { out, llm } = await refine([{ tools: [search('FastAPI')] }, { throw: 'tools unsupported' }, { text: REWRITE }])
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 3)
  assert.deepEqual(llm.calls.map(offersTools), [true, true, false])
  assert.equal(out.meta.lookups, 1)
})

test('SL-43 [State] once tools were refused, the follow-up answers rewrite offers none either', async () => {
  const draft = '给那个接口加上限流'
  const withGaps = '给那个接口加上限流。\n- 目标接口：(TBD)\n<missing_info>\n<question>是哪个接口？</question>\n</missing_info>'
  const askUser = () => async () => ({ answers: [{ id: 'q1', selected: [], custom: '登录接口' }] })
  const { out, llm } = await refine(
    [{ throw: 'tools unsupported' }, { text: withGaps }, { text: '给登录接口加上限流。' }],
    { depsOver: { askUser }, inputOver: { draft, maxQuestions: 5 } },
  )
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 3)
  assert.match(lastUserText(llm.calls[2]), /<user_answers>/)
  assert.deepEqual(llm.calls.map(offersTools), [true, false, false])
})

// ================================================================ repair and meta

test('SL-44 [EP repair] the repair call keeps the same tools and system prompt but runs no lookup', async () => {
  const repaired = '请把 src/a.ts 中的 maxRatioFor 改为 2.5。'
  // The repair reply also calls a tool; its text is used and the call is never executed.
  const { out, llm, loader } = await refine([{ text: '请修改那个比例参数。' }, { text: repaired, tools: [search('FastAPI')] }], {
    inputOver: { draft: '把 src/a.ts 的 maxRatioFor 改成 2.5' },
  })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 2, 'no further request carries a lookup result')
  assertSameOffer(llm.calls[1], llm.calls[0], 'repair')
  const repair = lastUserText(llm.calls[1])
  assert.match(repair, /DROPPED/, 'the repair is its own user turn')
  assert.match(repair, /src\/a\.ts/)
  assert.equal(loader.calls.length, 0, 'the session is never loaded: the tool call did not run')
  assert.equal(out.meta.lookups, 0)
  assert.equal(out.text, repaired)
})

test('SL-45 [EP meta] a lookup without conversation context reports contextUsed "lookup"', async () => {
  const { out } = await refine([{ tools: [search('FastAPI')] }, { text: REWRITE }])
  assert.equal(out.ok, true)
  assert.equal(out.meta.contextUsed, 'lookup')
  assert.equal(out.meta.lookups, 1)
})

test('SL-46 [Decision meta] attached conversation context outranks a lookup in contextUsed', async () => {
  const cfg = resolveConfig({ standardMaxRatio: 10 })
  const llm = stubLlm([{ tools: [search('FastAPI')] }, { text: '为登录接口增加按 IP 的限流，每分钟 60 次。' }])
  const loader = stubMessages()
  const sessions = { get: () => ({ deriveMessages: () => TRANSCRIPT }) }
  const out = await improveDraft(deps(llm, { sessions, sessionMessages: loader.load }), cfg, input({ draft: '把那个接口加上限流', lookupRounds: 3 }))
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.match(userText(llm.calls[0]), /<conversation_context>/)
  assert.equal(out.meta.contextUsed, 'anaphora')
  assert.equal(out.meta.lookups, 1)
})

// ================================================================ messagesOfLog

test('SL-47 [EP events] messagesOfLog returns user data and assistant data.message, in order', () => {
  const u1 = typed('first')
  const a1 = reply('second')
  const u2 = typed('third')
  const events = [
    { type: 'user/message', data: u1 },
    { type: 'assistant/message', data: { message: a1, usage: { tokens: 3 } } },
    { type: 'user/message', data: u2 },
  ]
  const out = messagesOfLog(events)
  assert.equal(out.length, 3)
  assert.equal(out[0], u1)
  assert.equal(out[1], a1)
  assert.equal(out[2], u2)
})

test('SL-48 [EP other events] messagesOfLog ignores every other event type', () => {
  const u1 = typed('kept')
  const events = [
    { type: 'session/created', data: { id: 's1' } },
    { type: 'tool/result', data: { content: 'TOOLDATA' } },
    { type: 'user/message', data: u1 },
    { type: 'assistant/delta', data: { message: reply('partial') } },
    { type: 'compaction', data: { message: reply('summary') } },
  ]
  assert.deepEqual(messagesOfLog(events), [u1])
})

test('SL-49 [EP non-objects] messagesOfLog skips non-object events', () => {
  const u1 = typed('kept')
  assert.deepEqual(messagesOfLog([null, undefined, 'user/message', 42, true, { type: 'user/message', data: u1 }]), [u1])
})

test('SL-50 [EP not a log] messagesOfLog of anything but an event list is empty', () => {
  for (const value of [undefined, null, 'x', 42, {}]) assert.deepEqual(messagesOfLog(value), [], JSON.stringify(value))
})
