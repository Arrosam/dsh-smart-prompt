// Black-box tests for detailed mode's follow-up rounds: one question per round, ask
// again after each answer until the model stops asking or the question cap is
// reached, then fill the remaining gaps with guesses listed under the rewrite.
// standard and light keep their single-card behaviour. Expectations come from the
// requirements, not from the implementation.
//
// Techniques:
//  - BVA: maxQuestions 0 / 1 / 2 / 3; cumulative asked reaching the cap exactly;
//    memo budget left (maxQuestions > memo.asked) vs none (== memo.asked).
//  - State transition: ask -> answer -> ask -> answer -> cap -> guess;
//    ask -> skip -> guess; ask -> answer -> ask -> skip -> guess; ask -> cancel.
//  - Decision table: mode (standard | light | detailed) x user action
//    (answer | skip | cancel | unavailable).
//  - EP: the three "asking unavailable" causes (maxQuestions 0, sessionId '', no askUser);
//    system prompt partitions (detailed interactive vs standard).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../lib/config.js'
import { improveDraft } from '../lib/orchestrate.js'
import { AnswerMemory } from '../lib/answer-memory.js'
import { buildSystemPrompt } from '../lib/prompts.js'

// ================================================================ fixtures

// Drafts, rewrites and answers carry no hard facts (no paths, numbers, identifiers),
// so the fidelity gate never adds a repair call and only the round logic decides.
const DRAFT = '把这个模块重构一下做得更清晰一些，另外再看下有没有多余的东西'
const Q = ['要保留现有的对外接口吗？', '多余的东西指哪一类？', '重构后要补测试吗？', '需要同步更新文档吗？']
const ANS = ['保留不变', '没用到的辅助函数', '要补齐', '需要更新']
const BODY = ['第一稿：先梳理模块职责。', '第二稿：保留接口并梳理职责。', '第三稿：删除没用到的辅助函数。', '第四稿：补齐测试。', '第五稿：更新文档。']

/** A rewrite ending with a follow-up block listing `questions`. */
const asking = (body, ...questions) =>
  body + '\n<missing_info>\n' + questions.map((q) => '<question>' + q + '</question>').join('\n') + '\n</missing_info>'

// ---------------------------------------------------------------- semantic wording
// Round instructions are checked by meaning, tolerant to rewording.
const GUESS = /guess/i
const NO_MORE = /no (?:more |further )?(?:follow-?up )?questions|cannot (?:ask|be asked)|can(?:not|'t| no longer) ask|can no longer|no longer (?:ask|be asked)|not (?:ask|be asked) any (?:more|further)|asking has ended/i
const LISTED = /\blist/i
const SKIPPED = /skip/i
/** Any detailed-round wording; standard/light turns must carry none of it. */
const ROUND_WORDING = /guess|questions? (?:left|remaining)|remaining questions?|no (?:more|further) (?:follow-?up )?questions|cannot ask|can no longer|at most one question|one question/i

// ================================================================ harness

/** Scripted model. A step is a reply string or `{ throw }` for an upstream error; records every request. */
function stubLlm(script) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      const step = script.length > 0 ? script.shift() : ''
      return (async function* () {
        if (typeof step === 'object' && step.throw !== undefined) throw new Error(step.throw)
        if (step !== '') yield { type: 'text-delta', index: 0, text: step }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

const answer = (text) => (questions) => ({ answers: [{ id: questions[0].id, selected: [], custom: text }] })
const skip = () => () => ({ answers: [] })
/** The user presses ×: the request signal aborts and the card rejects. */
const cancel = (controller) => () => { controller.abort(); throw new Error('ASK_CANCELLED') }

/** Records every card shown; round i is answered by `script[i]` (a function of the questions). */
function stubAsk(script) {
  const asked = []
  return {
    asked,
    askUser: () => async (questions) => {
      asked.push(questions)
      const step = script[asked.length - 1]
      assert.ok(step !== undefined, 'unexpected ask call #' + asked.length + ': ' + JSON.stringify(questions))
      return step(questions)
    },
  }
}

const textOf = (message) => message.content.map((p) => p.text ?? '').join('')
const firstUserText = (call) => textOf(call.messages.find((m) => m.role === 'user'))
const lastUserText = (call) => textOf(call.messages.filter((m) => m.role === 'user').at(-1))

/** One improveDraft call; `ask` null means no askUser at all. */
function run({ llm, ask, answers, controller = new AbortController(), ...over }) {
  return improveDraft(
    { llm, selection: { provider: 'p', model: 'm' }, lastRoute: null, askUser: ask?.askUser, answers },
    resolveConfig({}),
    { draft: DRAFT, sessionId: 's1', mode: 'detailed', signal: controller.signal, maxQuestions: 3, ...over },
  )
}

/** Each card held exactly one question: the first one of the reply that asked it. */
function assertOneQuestionPerCard(ask, expected) {
  assert.equal(ask.asked.length, expected.length, 'number of ask calls')
  ask.asked.forEach((card, i) => {
    assert.equal(card.length, 1, 'card #' + (i + 1) + ' shows exactly one question: ' + JSON.stringify(card))
    assert.equal(card[0].question, expected[i], 'card #' + (i + 1) + ' shows the first listed question')
  })
}

/** A user turn telling the model that asking has ended and the gaps become listed guesses. */
function assertGuessTurn(text, label) {
  assert.match(text, GUESS, label + ': says to fill the gaps with guesses; got: ' + text.slice(-800))
  assert.match(text, NO_MORE, label + ': says no more questions can be asked; got: ' + text.slice(-800))
  assert.match(text, LISTED, label + ': says to list the guesses under the rewrite; got: ' + text.slice(-800))
}

/** The final text is the reply body with any follow-up block stripped. */
function assertStripped(out, body) {
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(/missing_info|<question>/.test(out.text), false, 'the follow-up block is stripped: ' + out.text)
  assert.ok(out.text.includes(body), 'the result is the last reply: ' + out.text)
}

// ================================================================ 1. one question per round

test('DR-01 [EP] detailed shows only the first of several questions, in one single-question card', async () => {
  const llm = stubLlm([asking(BODY[0], Q[0], Q[1], Q[2]), BODY[1]])
  const ask = stubAsk([answer(ANS[0])])
  const out = await run({ llm, ask, maxQuestions: 3 })
  assertOneQuestionPerCard(ask, [Q[0]])
  assert.equal(llm.calls.length, 2, 'first rewrite + fold-in')
  assert.match(lastUserText(llm.calls[1]), new RegExp('<user_answers>[\\s\\S]*' + ANS[0] + '[\\s\\S]*</user_answers>'))
  assertStripped(out, BODY[1])
  assert.deepEqual(out.meta.questions, { asked: 1, answered: 1 })
})

test('DR-02 [EP] the first interactive detailed user message states the question allowance', async () => {
  const llm = stubLlm([BODY[0]])
  const ask = stubAsk([])
  const out = await run({ llm, ask, maxQuestions: 3 })
  assert.equal(out.ok, true, JSON.stringify(out))
  const first = firstUserText(llm.calls[0])
  assert.match(first, /question/i, 'mentions questions: ' + first)
  assert.match(first, /\b(?:\d+|one|a single)\b|一个/i, 'gives a count or "one": ' + first)
  assert.doesNotMatch(first, NO_MORE, 'asking is still available, so it must not say no more questions')
  assert.equal(ask.asked.length, 0, 'nothing to ask when the reply has no block')
  assert.deepEqual(out.meta.questions, { asked: 0, answered: 0 })
})

// ================================================================ 2. rounds up to the cap (BVA)

test('DR-03 [BVA cap=1] one answered question reaches the cap: the fold-in turn asks for listed guesses, its block is stripped', async () => {
  const llm = stubLlm([asking(BODY[0], Q[0], Q[1]), asking(BODY[1], Q[2])])
  const ask = stubAsk([answer(ANS[0])])
  const out = await run({ llm, ask, maxQuestions: 1 })
  assertOneQuestionPerCard(ask, [Q[0]])
  assert.equal(llm.calls.length, 2, 'no call after the cap-reached fold-in')
  const fold = lastUserText(llm.calls[1])
  assert.match(fold, /<user_answers>/)
  assertGuessTurn(fold, 'cap reached after 1')
  assertStripped(out, BODY[1])
  assert.deepEqual(out.meta.questions, { asked: 1, answered: 1 })
})

test('DR-04 [BVA cap=2] [State] ask -> answer -> ask -> answer -> cap -> guess', async () => {
  const llm = stubLlm([asking(BODY[0], Q[0], Q[1]), asking(BODY[1], Q[1], Q[2]), asking(BODY[2], Q[3])])
  const ask = stubAsk([answer(ANS[0]), answer(ANS[1])])
  const out = await run({ llm, ask, maxQuestions: 2 })
  assertOneQuestionPerCard(ask, [Q[0], Q[1]])
  assert.equal(llm.calls.length, 3)
  const below = lastUserText(llm.calls[1])
  assert.match(below, new RegExp('<user_answers>[\\s\\S]*' + ANS[0]))
  assert.doesNotMatch(below, NO_MORE, 'below the cap the fold-in turn must not end asking')
  const atCap = lastUserText(llm.calls[2])
  assert.match(atCap, new RegExp('<user_answers>[\\s\\S]*' + ANS[1]))
  assertGuessTurn(atCap, 'cap reached after 2')
  assertStripped(out, BODY[2])
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 })
})

test('DR-05 [BVA cap=3] three rounds of one question each, then the guess turn; never more ask calls than the cap', async () => {
  const llm = stubLlm([asking(BODY[0], Q[0]), asking(BODY[1], Q[1]), asking(BODY[2], Q[2]), asking(BODY[3], Q[3]), BODY[4]])
  const ask = stubAsk([answer(ANS[0]), answer(ANS[1]), answer(ANS[2])])
  const out = await run({ llm, ask, maxQuestions: 3 })
  assertOneQuestionPerCard(ask, [Q[0], Q[1], Q[2]])
  assert.equal(llm.calls.length, 4, 'first rewrite + three fold-ins')
  for (const i of [1, 2]) assert.doesNotMatch(lastUserText(llm.calls[i]), NO_MORE, 'fold-in #' + i + ' is below the cap')
  assertGuessTurn(lastUserText(llm.calls[3]), 'cap reached after 3')
  assertStripped(out, BODY[3])
  assert.deepEqual(out.meta.questions, { asked: 3, answered: 3 })
})

test('DR-06 [BVA below cap] the model stops asking at 2 of 3: no guess turn, no further ask', async () => {
  const llm = stubLlm([asking(BODY[0], Q[0]), asking(BODY[1], Q[1]), BODY[2]])
  const ask = stubAsk([answer(ANS[0]), answer(ANS[1])])
  const out = await run({ llm, ask, maxQuestions: 3 })
  assertOneQuestionPerCard(ask, [Q[0], Q[1]])
  assert.equal(llm.calls.length, 3)
  for (const i of [1, 2]) assert.doesNotMatch(lastUserText(llm.calls[i]), NO_MORE, 'fold-in #' + i + ' is below the cap')
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.text.trim(), BODY[2])
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 })
})

// ================================================================ 3. skip and cancel

test('DR-07 [State] ask -> skip -> guess: exactly one more call, told to guess and list; its block is stripped', async () => {
  const llm = stubLlm([asking(BODY[0], Q[0], Q[1]), asking(BODY[1], Q[2]), BODY[2]])
  const ask = stubAsk([skip()])
  const out = await run({ llm, ask, maxQuestions: 3 })
  assertOneQuestionPerCard(ask, [Q[0]])
  assert.equal(llm.calls.length, 2, 'one guess call after the skip, nothing more')
  const turn = lastUserText(llm.calls[1])
  assert.match(turn, GUESS, 'skip turn says to guess: ' + turn)
  assert.match(turn, LISTED, 'skip turn says to list the guesses: ' + turn)
  assert.ok(SKIPPED.test(turn) || NO_MORE.test(turn), 'skip turn says the user skipped / no more questions: ' + turn)
  assertStripped(out, BODY[1])
  assert.deepEqual(out.meta.questions, { asked: 1, answered: 0 })
})

test('DR-08 [State] ask -> answer -> ask -> skip -> guess: counts span both rounds', async () => {
  const llm = stubLlm([asking(BODY[0], Q[0]), asking(BODY[1], Q[1]), asking(BODY[2], Q[2]), BODY[3]])
  const ask = stubAsk([answer(ANS[0]), skip()])
  const out = await run({ llm, ask, maxQuestions: 3 })
  assertOneQuestionPerCard(ask, [Q[0], Q[1]])
  assert.equal(llm.calls.length, 3)
  const turn = lastUserText(llm.calls[2])
  assert.match(turn, GUESS)
  assert.match(turn, LISTED)
  assert.ok(SKIPPED.test(turn) || NO_MORE.test(turn), 'skip turn says the user skipped / no more questions: ' + turn)
  assertStripped(out, BODY[2])
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 1 })
})

test('DR-09 [State] ask -> cancel ends ABORTED with no guess call, in round 1 and in round 2', async () => {
  for (const round of [1, 2]) {
    const controller = new AbortController()
    const llm = stubLlm([asking(BODY[0], Q[0]), asking(BODY[1], Q[1]), BODY[2]])
    const ask = stubAsk(round === 1 ? [cancel(controller)] : [answer(ANS[0]), cancel(controller)])
    const out = await run({ llm, ask, controller, maxQuestions: 3 })
    assert.equal(out.ok, false, 'round ' + round + ': ' + JSON.stringify(out))
    assert.equal(out.code, 'ABORTED', 'round ' + round)
    assert.equal(ask.asked.length, round, 'round ' + round)
    assert.equal(llm.calls.length, round, 'round ' + round + ': no model call after the cancel')
  }
})

// ================================================================ 4. asking unavailable

test('DR-10 [EP unavailable] maxQuestions 0, sessionId "" or no askUser: the first call asks for listed guesses, no ask, block stripped', async () => {
  const rows = [
    ['maxQuestions 0', { maxQuestions: 0 }, stubAsk([])],
    ['sessionId ""', { sessionId: '' }, stubAsk([])],
    ['no askUser', {}, null],
  ]
  for (const [name, over, ask] of rows) {
    const llm = stubLlm([asking(BODY[0], Q[0]), BODY[1]])
    const out = await run({ llm, ask, ...over })
    assert.equal(llm.calls.length, 1, name + ': one call only')
    if (ask !== null) assert.equal(ask.asked.length, 0, name + ': never asks')
    assertGuessTurn(firstUserText(llm.calls[0]), name)
    assertStripped(out, BODY[0])
  }
})

// ================================================================ 5. decision table

test('DR-11 [Decision] mode x (answer | skip | cancel | unavailable)', async () => {
  const twoQuestions = asking(BODY[0], Q[0], Q[1])
  const foldWithBlock = asking(BODY[1], Q[2])
  const both = (questions) => ({ answers: questions.map((q, i) => ({ id: q.id, selected: [], custom: ANS[i] })) })
  for (const mode of ['standard', 'light', 'detailed']) {
    const detailed = mode === 'detailed'
    const label = (action) => mode + ' x ' + action

    // answer
    {
      const llm = stubLlm([twoQuestions, foldWithBlock, BODY[2]])
      const ask = stubAsk([both, both])
      const out = await run({ llm, ask, mode, maxQuestions: 3 })
      if (detailed) {
        // One question; the fold-in's question is asked in a second round.
        assertOneQuestionPerCard(ask, [Q[0], Q[2]])
        assert.equal(llm.calls.length, 3, label('answer'))
        assertStripped(out, BODY[2])
        assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 }, label('answer'))
      } else {
        assert.equal(ask.asked.length, 1, label('answer') + ': one card')
        assert.deepEqual(ask.asked[0].map((q) => q.question), [Q[0], Q[1]], label('answer') + ': all questions in one card')
        assert.equal(llm.calls.length, 2, label('answer') + ': one fold-in call')
        assertStripped(out, BODY[1])
        assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 }, label('answer'))
        assert.doesNotMatch(firstUserText(llm.calls[0]), ROUND_WORDING, label('answer') + ': first message')
        assert.doesNotMatch(lastUserText(llm.calls[1]), ROUND_WORDING, label('answer') + ': answers turn')
      }
    }

    // skip
    {
      const llm = stubLlm([twoQuestions, BODY[1]])
      const ask = stubAsk([skip()])
      const out = await run({ llm, ask, mode, maxQuestions: 3 })
      assert.equal(ask.asked.length, 1, label('skip'))
      if (detailed) {
        assert.equal(llm.calls.length, 2, label('skip') + ': one guess call')
        assert.match(lastUserText(llm.calls[1]), GUESS, label('skip'))
        assertStripped(out, BODY[1])
      } else {
        assert.equal(llm.calls.length, 1, label('skip') + ': keeps the first rewrite, no extra call')
        assertStripped(out, BODY[0])
      }
    }

    // cancel
    {
      const controller = new AbortController()
      const llm = stubLlm([twoQuestions, BODY[1]])
      const ask = stubAsk([cancel(controller)])
      const out = await run({ llm, ask, mode, controller, maxQuestions: 3 })
      assert.equal(out.ok, false, label('cancel'))
      assert.equal(out.code, 'ABORTED', label('cancel'))
      assert.equal(llm.calls.length, 1, label('cancel') + ': no further call')
    }

    // unavailable (no session)
    {
      const llm = stubLlm([BODY[0]])
      const ask = stubAsk([])
      const out = await run({ llm, ask, mode, sessionId: '' })
      assert.equal(out.ok, true, label('unavailable'))
      assert.equal(ask.asked.length, 0, label('unavailable'))
      assert.equal(llm.calls.length, 1, label('unavailable'))
      if (detailed) assertGuessTurn(firstUserText(llm.calls[0]), label('unavailable'))
      else assert.doesNotMatch(firstUserText(llm.calls[0]), ROUND_WORDING, label('unavailable'))
    }
  }
})

test('DR-12 [EP] standard and light: the fold-in reply\'s block is never asked, even with budget left', async () => {
  for (const mode of ['standard', 'light']) {
    const llm = stubLlm([asking(BODY[0], Q[0]), asking(BODY[1], Q[1]), BODY[2]])
    const ask = stubAsk([answer(ANS[0])])
    const out = await run({ llm, ask, mode, maxQuestions: 5 })
    assert.equal(ask.asked.length, 1, mode)
    assert.equal(llm.calls.length, 2, mode)
    assertStripped(out, BODY[1])
  }
})

// ================================================================ 6. remembered answers (memo)

/** First detailed attempt: one question answered, then the fold-in call fails upstream. */
async function failAfterOneAnswer(memory, maxQuestions) {
  const llm = stubLlm([asking(BODY[0], Q[0]), { throw: 'gateway exploded' }])
  const ask = stubAsk([answer(ANS[0])])
  const out = await run({ llm, ask, answers: memory, maxQuestions })
  assert.equal(out.ok, false, 'the first attempt must fail: ' + JSON.stringify(out))
  assert.equal(out.code, 'UPSTREAM')
  assert.equal(ask.asked.length, 1, 'the first attempt asks once')
  assert.ok(memory.recall('s1', DRAFT) !== undefined, 'the answer is remembered')
}

test('DR-13 [BVA memo budget 1 left] a retry with maxQuestions 2 folds the memo, may ask one more, then guesses', async () => {
  const memory = new AnswerMemory()
  await failAfterOneAnswer(memory, 2)

  const llm = stubLlm([asking(BODY[1], Q[1], Q[2]), asking(BODY[2], Q[3]), BODY[3]])
  const ask = stubAsk([answer(ANS[1])])
  const out = await run({ llm, ask, answers: memory, maxQuestions: 2 })
  const first = firstUserText(llm.calls[0])
  assert.match(first, new RegExp('<user_answers>[\\s\\S]*' + ANS[0]), 'the remembered answer is folded into the first call')
  assert.doesNotMatch(first, NO_MORE, 'budget is left, so asking has not ended')
  assertOneQuestionPerCard(ask, [Q[1]])
  assert.equal(llm.calls.length, 2, 'retry rewrite + cap-reached fold-in')
  assertGuessTurn(lastUserText(llm.calls[1]), 'memo 1 + 1 asked reaches cap 2')
  assertStripped(out, BODY[2])
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 })
})

test('DR-14 [BVA memo budget 0 left] a retry with maxQuestions 1 folds the memo, asks nothing and instructs guesses', async () => {
  const memory = new AnswerMemory()
  await failAfterOneAnswer(memory, 1)

  const llm = stubLlm([asking(BODY[1], Q[1]), BODY[2]])
  const ask = stubAsk([])
  const out = await run({ llm, ask, answers: memory, maxQuestions: 1 })
  assert.equal(ask.asked.length, 0, 'no budget left: never asks')
  assert.equal(llm.calls.length, 1)
  const first = firstUserText(llm.calls[0])
  assert.match(first, new RegExp('<user_answers>[\\s\\S]*' + ANS[0]))
  assertGuessTurn(first, 'memo used the whole budget')
  assertStripped(out, BODY[1])
  assert.deepEqual(out.meta.questions, { asked: 1, answered: 1 })
})

test('DR-15 [EP] standard with a memo: still no ask call at all', async () => {
  const memory = new AnswerMemory()
  {
    const llm = stubLlm([asking(BODY[0], Q[0], Q[1]), { throw: 'gateway exploded' }])
    const ask = stubAsk([(qs) => ({ answers: qs.map((q, i) => ({ id: q.id, selected: [], custom: ANS[i] })) })])
    const out = await run({ llm, ask, answers: memory, mode: 'standard', maxQuestions: 5 })
    assert.equal(out.code, 'UPSTREAM')
  }
  const llm = stubLlm([asking(BODY[1], Q[2]), BODY[2]])
  const ask = stubAsk([])
  const out = await run({ llm, ask, answers: memory, mode: 'standard', maxQuestions: 5 })
  assert.equal(ask.asked.length, 0)
  assert.equal(llm.calls.length, 1)
  assert.doesNotMatch(firstUserText(llm.calls[0]), ROUND_WORDING)
  assertStripped(out, BODY[1])
})

// ================================================================ 7. system prompt

/** Detailed-only lines mentioning TBD must forbid it, never ask for it. */
const PROHIBITION = /\b(?:never|not|no|don't|do not|without|absent|replace[sd]?|instead of|avoid)\b|不要|不得|禁止|不写|不留/i

/** Lines of `text` that do not appear in `base`. */
const onlyIn = (text, base) => {
  const shared = new Set(base.split('\n').map((l) => l.trim()))
  return text.split('\n').filter((l) => !shared.has(l.trim()))
}

test('DR-16 [EP] the detailed-only system prompt text never asks for (TBD: …) markers', () => {
  const cfg = resolveConfig({})
  const detailedOnly = onlyIn(buildSystemPrompt('detailed', cfg), buildSystemPrompt('standard', cfg))
  assert.ok(detailedOnly.length > 0, 'detailed adds its own template text')
  for (const line of detailedOnly.filter((l) => /TBD/i.test(l))) {
    assert.match(line, PROHIBITION, 'a detailed-only line requires a TBD marker: ' + line)
  }
})

const ONE_PER_REPLY = /\b(?:one|a single|1)\s+(?:follow-?up\s+)?question\b|one (?:question )?at a time|一个问题|每次[^\n。]{0,10}一/i
const ASK_AGAIN = /\bask(?:ed|ing)?\b[^.\n]{0,100}\bagain\b|\bagain\b[^.\n]{0,100}\bask|\bafter\b[^.\n]{0,80}\banswer[^.\n]{0,150}\b(?:ask|question)|再(?:次)?(?:追问|提问|问)/i
const LIST_GUESSES = /\blist[^.\n]{0,80}\bguess|\bguess(?:es|ed)?\b[^.\n]{0,120}\blist|guessed details|猜测/i

test('DR-17 [EP] the interactive detailed system prompt has the round rules; standard has none', async () => {
  const systemOf = async (mode) => {
    const llm = stubLlm([BODY[0]])
    const out = await run({ llm, ask: stubAsk([]), mode, maxQuestions: 3 })
    assert.equal(out.ok, true, JSON.stringify(out))
    return llm.calls[0].system
  }
  const [detailed, standard] = await Promise.all([systemOf('detailed'), systemOf('standard')])
  assert.match(detailed, ONE_PER_REPLY, 'detailed: one question per reply')
  assert.match(detailed, ASK_AGAIN, 'detailed: may ask again after the answers')
  assert.match(detailed, LIST_GUESSES, 'detailed: list guesses under the rewrite')
  assert.doesNotMatch(standard, ONE_PER_REPLY, 'standard: no one-question rule')
  assert.doesNotMatch(standard, ASK_AGAIN, 'standard: no ask-again rule')
  assert.doesNotMatch(standard, LIST_GUESSES, 'standard: no guess-listing rule')
})
