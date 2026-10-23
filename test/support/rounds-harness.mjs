// Shared harness for the follow-up rounds tests (detailed-rounds.test.mjs and
// standard-rounds.test.mjs). It lives outside test/*.test.mjs, so importing it never runs
// another file's cases.
//
// Drafts, rewrites and answers carry no hard facts (no paths, numbers, identifiers), so the
// fidelity gate never adds a repair call and only the round logic decides how many calls a
// refinement makes.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resolveConfig } from '../../lib/config.js'
import { improveDraft } from '../../lib/orchestrate.js'
import { apply } from '../../lib/index.js'

// ================================================================ fixtures

export const DRAFT = '把这个模块重构一下做得更清晰一些，另外再看下有没有多余的东西'
export const Q = ['要保留现有的对外接口吗？', '多余的东西指哪一类？', '重构后要补测试吗？', '需要同步更新文档吗？']
export const ANS = ['保留不变', '没用到的辅助函数', '要补齐', '需要更新']
export const BODY = ['第一稿：先梳理模块职责。', '第二稿：保留接口并梳理职责。', '第三稿：删除没用到的辅助函数。', '第四稿：补齐测试。', '第五稿：更新文档。']

/** A rewrite ending with a follow-up block listing `questions`. */
export const asking = (body, ...questions) =>
  body + '\n<missing_info>\n' + questions.map((q) => '<question>' + q + '</question>').join('\n') + '\n</missing_info>'

/** A Stardea reply proposing `texts` as ideas. */
export const ideasReply = (texts) => '<ideas>\n' + texts.map((t) => '<idea source="proposal">' + t + '</idea>').join('\n') + '\n</ideas>'

// ================================================================ semantic wording
// Round instructions are checked by meaning, tolerant to rewording.

export const GUESS = /guess/i
export const NO_MORE = /no (?:more |further )?(?:follow-?up )?questions|cannot (?:ask|be asked)|can(?:not|'t| no longer) ask|can no longer|no longer (?:ask|be asked)|not (?:ask|be asked) any (?:more|further)|asking has ended/i
export const LISTED = /\blist/i
export const SKIPPED = /skip/i
/** Any round wording; a single-round (light) turn must carry none of it. */
export const ROUND_WORDING = /guess|questions? (?:left|remaining)|remaining questions?|no (?:more|further) (?:follow-?up )?questions|cannot ask|can no longer|at most one question|one question/i

/** System-prompt rules of the one-question-at-a-time flow. */
export const ONE_PER_REPLY = /\b(?:one|a single|1)\s+(?:follow-?up\s+)?question\b|one (?:question )?at a time|一个问题|每次[^\n。]{0,10}一/i
export const ASK_AGAIN = /\bask(?:ed|ing)?\b[^.\n]{0,100}\bagain\b|\bagain\b[^.\n]{0,100}\bask|\bafter\b[^.\n]{0,80}\banswer[^.\n]{0,150}\b(?:ask|question)|再(?:次)?(?:追问|提问|问)/i
export const LIST_GUESSES = /\blist[^.\n]{0,80}\bguess|\bguess(?:es|ed)?\b[^.\n]{0,120}\blist|guessed details|猜测/i
/** A line naming TBD must forbid it, never ask for it. */
export const PROHIBITION = /\b(?:never|not|no|don't|do not|without|absent|replace[sd]?|instead of|avoid)\b|不要|不得|禁止|不写|不留/i

/**
 * What a `<follow_up_status>` note body says, by meaning: `open:<n>` (asking allowed, n
 * questions left), `limit`, `skipped`, `unavailable`, or `none` without a note. An ended
 * state also has to say to guess and list the guesses, else it reads `ended?`.
 */
export function noteKind(note) {
  if (note === undefined) return 'none'
  if (!NO_MORE.test(note)) {
    const left = /\b(\d+)\b/.exec(note)
    return 'open:' + (left === null ? '?' : left[1])
  }
  if (!GUESS.test(note) || !LISTED.test(note)) return 'ended?'
  if (SKIPPED.test(note)) return 'skipped'
  if (/\blimit\b|\bcap\b|maximum/i.test(note)) return 'limit'
  return 'unavailable'
}

/** Kind of the note ending `text` (see {@link noteKind}). */
export const endingNote = (text) => noteKind(statusOf(text))

// ================================================================ model and panel stubs

/**
 * Scripted model. A step is a reply string or `{ throw }` for an upstream error. Every
 * request is recorded as a JSON snapshot taken at call time, so later mutation of the arrays
 * the plugin passed cannot change what a test sees.
 */
export function stubLlm(script) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(JSON.parse(JSON.stringify(options)))
      const step = script.length > 0 ? script.shift() : ''
      return (async function* () {
        if (typeof step === 'object' && step.throw !== undefined) throw new Error(step.throw)
        if (step !== '') yield { type: 'text-delta', index: 0, text: step }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** The user answers the card's first question with `text`. */
export const answer = (text) => (questions) => ({ answers: [{ id: questions[0].id, selected: [], custom: text }] })
/** The user answers every question of the card, the i-th with `texts[i]`. */
export const answerAll = (texts) => (questions) => ({ answers: questions.map((q, i) => ({ id: q.id, selected: [], custom: texts[i] })) })
/** The user presses Skip: an empty batch. */
export const skip = () => () => ({ answers: [] })
/** The user presses ×: the request signal aborts and the card rejects. */
export const cancel = (controller) => () => { controller.abort(); throw new Error('ASK_CANCELLED') }
/** The card is dismissed without the request being aborted. */
export const dismiss = () => () => { throw new Error('ASK_DISMISSED') }

/**
 * Records every card shown; card i is answered by `script[i]`, a function of
 * `(questions, signal, stardea)` as the ask-user seam receives them.
 */
export function stubAsk(script) {
  const asked = []
  return {
    asked,
    askUser: () => async (questions, signal, stardea) => {
      asked.push(JSON.parse(JSON.stringify(questions)))
      const step = script[asked.length - 1]
      assert.ok(step !== undefined, 'unexpected ask call #' + asked.length + ': ' + JSON.stringify(questions))
      return step(questions, signal, stardea)
    },
  }
}

// ================================================================ request readers

export const textOf = (message) => (message === undefined ? '' : message.content.map((p) => p.text ?? '').join(''))
export const userTurns = (call) => call.messages.filter((m) => m.role === 'user').map(textOf)
export const firstUserText = (call) => userTurns(call)[0]
export const lastUserText = (call) => userTurns(call).at(-1)

/** Body of the `<follow_up_status>` note that ENDS `text`, or undefined when it does not end with one. */
export function statusOf(text) {
  const match = /<follow_up_status>\s*([\s\S]*?)\s*<\/follow_up_status>\s*$/.exec(text)
  return match === null ? undefined : match[1]
}

/** Lines of `text` that do not appear in `base`. */
export const onlyIn = (text, base) => {
  const shared = new Set(base.split('\n').map((l) => l.trim()))
  return text.split('\n').filter((l) => !shared.has(l.trim()))
}

// ================================================================ one refinement

/**
 * A runner with fixed input defaults. One call is one improveDraft run; `ask` null (or
 * absent) means no askUser at all; `improve` / `config` let a test run another build.
 */
export function makeRun(defaults) {
  return ({ llm, ask, answers, controller = new AbortController(), improve = improveDraft, config = resolveConfig({}), deps = {}, ...over }) => improve(
    { llm, selection: { provider: 'p', model: 'm' }, lastRoute: null, askUser: ask?.askUser, answers, ...deps },
    config,
    { draft: DRAFT, sessionId: 's1', signal: controller.signal, ...defaults, ...over },
  )
}

// ================================================================ assertions

/** Each card held exactly one question: the first one of the reply that asked it. */
export function assertOneQuestionPerCard(ask, expected) {
  assert.equal(ask.asked.length, expected.length, 'number of ask calls')
  ask.asked.forEach((card, i) => {
    assert.equal(card.length, 1, 'card #' + (i + 1) + ' shows exactly one question: ' + JSON.stringify(card))
    assert.equal(card[0].question, expected[i], 'card #' + (i + 1) + ' shows the first listed question')
  })
}

/** A user turn telling the model that asking has ended and the gaps become listed guesses. */
export function assertGuessTurn(text, label) {
  assert.match(text, GUESS, label + ': says to fill the gaps with guesses; got: ' + text.slice(-800))
  assert.match(text, NO_MORE, label + ': says no more questions can be asked; got: ' + text.slice(-800))
  assert.match(text, LISTED, label + ': says to list the guesses under the rewrite; got: ' + text.slice(-800))
}

/** The final text is the reply body with any follow-up block stripped. */
export function assertStripped(out, body) {
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(/missing_info|<question>/.test(out.text), false, 'the follow-up block is stripped: ' + out.text)
  assert.ok(out.text.includes(body), 'the result is the last reply: ' + out.text)
}

// ================================================================ HTTP route (system level)

export const API = '/dsh-smart-prompt/api'

/** Apply the plugin with stub host services and a scripted model; `raw` is the plugin config. */
export function mountRoute({ raw, script = [] } = {}) {
  const llm = stubLlm(script)
  const routes = []
  const services = { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }
  const ctx = {
    ...services,
    logger: { warn() {}, error() {}, info() {}, debug() {} },
    on() {},
    effect(fn) { return fn() },
    get: (name) => services[name],
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  apply(ctx, raw)
  assert.equal(routes.length, 1, 'the plugin registers one route')
  return { route: routes[0], llm }
}

/** POST a JSON body to one endpoint of the route; resolves to `{ status, json }`. */
export function post(route, endpoint, payload) {
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = API + '/' + endpoint
  req.headers = { 'content-type': 'application/json' }
  const res = new EventEmitter()
  const reply = { status: 0, json: null }
  res.writableEnded = false
  res.writeHead = (status) => { reply.status = status; return res }
  res.end = (text) => { res.writableEnded = true; res.writableFinished = true; reply.json = typeof text === 'string' && text !== '' ? JSON.parse(text) : null }
  const done = Promise.resolve(route.handler(req, res)).then(() => reply)
  req.emit('data', Buffer.from(JSON.stringify(payload), 'utf8'))
  req.emit('end')
  return done
}
