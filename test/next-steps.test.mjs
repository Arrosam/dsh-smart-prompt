// Next-step suggestions (host half): parsing, the per-session book, the /suggest route, and the
// auto-suggest run after a completed agent turn.
//
// Requirements under test (user decisions):
//  - 2 suggestions per request (user decision, one row of cards), each one short sentence.
//  - A request for the same conversation point returns the ones already made without a model call;
//    `more` asks for 2 new ones that avoid every earlier one.
//  - A new agent reply is a new point: the old suggestions are dropped.
//  - No suggestions before the first finished exchange.
//  - Auto-suggest (settings page, off by default) generates after every completed agent turn.

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resolveConfig } from '../lib/config.js'
import { apply } from '../lib/index.js'
import { NextStepBook, SUGGESTION_COUNT, conversationKey, parseSuggestions } from '../lib/next-steps.js'
import { stubLlm } from './support/rounds-harness.mjs'

const CFG = resolveConfig({})
const user = (text) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const agent = (text) => ({ role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text }] })
const tool = (text) => ({ role: 'tool', source: { kind: 'tool' }, content: [{ type: 'text', text }] })
const reply = (...items) => '<suggestions>\n' + items.map((s) => '<suggestion>' + s + '</suggestion>').join('\n') + '\n</suggestions>'
const CONVO = [user('Add rate limiting to the login API'), agent('Done: 60 requests a minute per IP, in middleware/rate.ts.')]
const ROUTE = { provider: 'p', model: 'm' }
const live = () => new AbortController().signal

function context(llm, messages = CONVO) {
  return { llm, route: ROUTE, config: CFG, messages, knowledge: '' }
}

test('NS-1 parseSuggestions keeps at most the cap, drops blanks, repeats and earlier ones, and flattens whitespace', () => {
  const raw = reply('Add tests for the limiter', '  add TESTS for the limiter ', '', 'Log blocked\n requests', 'Document the limit', 'A fifth')
  assert.deepEqual(parseSuggestions(raw, [], 3), ['Add tests for the limiter', 'Log blocked requests', 'Document the limit'])
  assert.deepEqual(parseSuggestions(raw, ['log blocked requests'], 3), ['Add tests for the limiter', 'Document the limit', 'A fifth'])
  assert.deepEqual(parseSuggestions(raw, [], 2), ['Add tests for the limiter', 'Log blocked requests'], 'the cap holds')
  assert.deepEqual(parseSuggestions('no block here', [], 3), [])
  assert.equal(SUGGESTION_COUNT, 2, 'two suggestions per request (user decision)')
})

test('NS-2 conversationKey ignores tool traffic, changes on a new reply, and is empty before any exchange', () => {
  assert.equal(conversationKey([]), '')
  assert.equal(conversationKey('nope'), '')
  const base = conversationKey(CONVO)
  assert.notEqual(base, '')
  assert.equal(conversationKey([...CONVO, tool('file contents')]), base, 'tool output is not a new point')
  assert.notEqual(conversationKey([...CONVO, user('Now add tests'), agent('Added 4 tests.')]), base)
})

test('NS-3 the first request makes 2; asking again for the same point costs no model call', async () => {
  const llm = stubLlm([reply('Add tests for the limiter', 'Log blocked requests', 'Document the limit')])
  const book = new NextStepBook()
  const first = await book.request('s1', context(llm), false, live())
  assert.equal(first.ok, true)
  assert.deepEqual(first.suggestions, ['Add tests for the limiter', 'Log blocked requests'], 'an over-long reply is capped at 2')
  const again = await book.request('s1', context(llm), false, live())
  assert.deepEqual(again.suggestions, first.suggestions)
  assert.equal(llm.calls.length, 1, 'reopening shows the made suggestions, no second call')
  // The model sees the conversation and no tools.
  const sent = JSON.stringify(llm.calls[0].messages)
  assert.ok(sent.includes('rate limiting') && sent.includes('middleware/rate.ts'))
  assert.equal(llm.calls[0].tools, undefined)
})

test('NS-4 `more` appends 2 new ones and tells the model every earlier one to avoid', async () => {
  const llm = stubLlm([reply('A1', 'A2'), reply('A2', 'B1', 'B2')])
  const book = new NextStepBook()
  await book.request('s1', context(llm), false, live())
  const more = await book.request('s1', context(llm), true, live())
  assert.deepEqual(more.suggestions, ['A1', 'A2', 'B1', 'B2'], 'a repeat from the model is dropped')
  const second = JSON.stringify(llm.calls[1].messages)
  for (const earlier of ['A1', 'A2']) assert.ok(second.includes('- ' + earlier), earlier + ' listed to avoid')
})

test('NS-5 a new agent reply drops the old suggestions; a session with no exchange is refused without a call', async () => {
  const llm = stubLlm([reply('Old 1', 'Old 2'), reply('New 1', 'New 2')])
  const book = new NextStepBook()
  await book.request('s1', context(llm), false, live())
  const moved = [...CONVO, user('Now add tests'), agent('Added 4 tests.')]
  const next = await book.request('s1', context(llm, moved), false, live())
  assert.deepEqual(next.suggestions, ['New 1', 'New 2'])
  const empty = await book.request('s2', context(llm, []), false, live())
  assert.deepEqual([empty.ok, empty.code], [false, 'NO_CONTEXT'])
  assert.equal(llm.calls.length, 2)
})

test('NS-6 concurrent requests share one generation; a failure keeps earlier suggestions', async () => {
  const llm = stubLlm([reply('A1', 'A2'), { throw: 'boom' }])
  const book = new NextStepBook()
  const [a, b] = await Promise.all([book.request('s1', context(llm), false, live()), book.request('s1', context(llm), false, live())])
  assert.deepEqual(a.suggestions, b.suggestions)
  assert.equal(llm.calls.length, 1, 'the auto run and a click do not pay twice')
  const failed = await book.request('s1', context(llm), true, live())
  assert.equal(failed.ok, false)
  const kept = await book.request('s1', context(llm), false, live())
  assert.deepEqual(kept.suggestions, ['A1', 'A2'])
})

// ================================================================ the route and auto-suggest

function mountPlugin(raw = {}, script = []) {
  const llm = stubLlm(script)
  const routes = []
  const listeners = {}
  const sessions = { get: (id) => (id === 's1' ? { header: {}, deriveMessages: () => CONVO } : id === 'blank' ? { header: {}, deriveMessages: () => [] } : undefined) }
  const services = { llm, sessions, agentDefaultModel: { currentSelection: () => ROUTE } }
  const ctx = {
    ...services,
    logger: { warn() {} },
    on(name, fn) { listeners[name] = fn },
    effect(fn) { return fn() },
    get: (name) => services[name],
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  apply(ctx, raw)
  return { route: routes[0], llm, listeners }
}

function post(route, endpoint, payload) {
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/dsh-smart-prompt/api/' + endpoint
  const res = new EventEmitter()
  const out = { json: null }
  res.writableEnded = false
  res.writeHead = () => res
  res.end = (text) => { res.writableEnded = true; out.json = JSON.parse(text) }
  const done = Promise.resolve(route.handler(req, res)).then(() => out.json)
  req.emit('data', Buffer.from(JSON.stringify(payload), 'utf8'))
  req.emit('end')
  return done
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test('NS-7 POST /suggest: get, then get again (no call), then more; bad bodies are refused', async () => {
  const { route, llm } = mountPlugin({}, [reply('A1', 'A2'), reply('B1', 'B2')])
  const first = await post(route, 'suggest', { sessionId: 's1', request: 'get' })
  assert.deepEqual([first.ok, first.suggestions], [true, ['A1', 'A2']])
  assert.equal(typeof first.key, 'string')
  const again = await post(route, 'suggest', { sessionId: 's1', request: 'get' })
  assert.deepEqual(again.suggestions, ['A1', 'A2'])
  assert.equal(llm.calls.length, 1)
  const more = await post(route, 'suggest', { sessionId: 's1', request: 'more' })
  assert.deepEqual(more.suggestions, ['A1', 'A2', 'B1', 'B2'])
  for (const bad of [{ request: 'get' }, { sessionId: 's1' }, { sessionId: 's1', request: 'all' }]) {
    assert.equal((await post(route, 'suggest', bad)).code, 'BAD_BODY', JSON.stringify(bad))
  }
  assert.equal((await post(route, 'suggest', { sessionId: 'blank', request: 'get' })).code, 'NO_CONTEXT')
})

test('NS-8 auto-suggest off (default): a completed turn makes no call', async () => {
  const { listeners, llm } = mountPlugin({}, [reply('A1', 'A2')])
  listeners['session/event']({ id: 's1', header: {} }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await flush()
  assert.equal(llm.calls.length, 0)
})

test('NS-9 auto-suggest on: a completed turn generates once; the next click finds them without a call', async () => {
  const { listeners, llm, route } = mountPlugin({ autoSuggest: { get: () => true } }, [reply('A1', 'A2')])
  const turnEnd = (kind, session = { id: 's1', header: {} }) => listeners['session/event'](session, { type: 'turn/end', data: { turn: 1, reason: { kind } } })
  turnEnd('aborted')
  turnEnd('completed', { id: 's1', header: { origin: 'subagent' } })
  listeners['session/event']({ id: 's1', header: {} }, { type: 'user/message', data: {} })
  await flush()
  assert.equal(llm.calls.length, 0, 'only a completed turn of a top-level session counts')
  turnEnd('completed')
  await flush()
  assert.equal(llm.calls.length, 1)
  const shown = await post(route, 'suggest', { sessionId: 's1', request: 'get' })
  assert.deepEqual(shown.suggestions, ['A1', 'A2'])
  assert.equal(llm.calls.length, 1)
})
