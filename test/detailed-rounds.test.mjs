// Black-box tests for the follow-up rounds of detailed mode: one question per round, ask
// again after each answer until the model stops asking or the question cap is
// reached, then fill the remaining gaps with guesses listed under the rewrite.
// Standard runs the same rounds (standard-rounds.test.mjs covers it in depth); light keeps
// its single-card behaviour. Expectations come from the requirements, not from the
// implementation.
//
// Techniques:
//  - BVA: maxQuestions 0 / 1 / 2 / 3; cumulative asked reaching the cap exactly;
//    memo budget left (maxQuestions > memo.asked) vs none (== memo.asked).
//  - State transition: ask -> answer -> ask -> answer -> cap -> guess;
//    ask -> skip -> guess; ask -> answer -> ask -> skip -> guess; ask -> cancel.
//  - Decision table: mode (standard | light | detailed) x user action
//    (answer | skip | cancel | unavailable).
//  - EP: the three "asking unavailable" causes (maxQuestions 0, sessionId '', no askUser);
//    system prompt partitions (round modes standard and detailed vs light).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../lib/config.js'
import { AnswerMemory } from '../lib/answer-memory.js'
import { buildSystemPrompt } from '../lib/prompts.js'
import {
  ANS, ASK_AGAIN, BODY, GUESS, LISTED, LIST_GUESSES, NO_MORE, ONE_PER_REPLY, PROHIBITION, Q, ROUND_WORDING, SKIPPED,
  DRAFT, answer, answerAll, asking, assertGuessTurn, assertOneQuestionPerCard, assertStripped, cancel, firstUserText,
  lastUserText, makeRun, onlyIn, skip, stubAsk, stubLlm,
} from './support/rounds-harness.mjs'

/** Modes that ask one question per round (requirement R1-R8 for standard). */
const ROUND_MODES = ['standard', 'detailed']

/** One improveDraft call in detailed mode with 3 questions; `ask` null means no askUser at all. */
const run = makeRun({ mode: 'detailed', maxQuestions: 3 })

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
  const both = answerAll(ANS)
  for (const mode of ['standard', 'light', 'detailed']) {
    const rounds = ROUND_MODES.includes(mode)
    const label = (action) => mode + ' x ' + action

    // answer
    {
      const llm = stubLlm([twoQuestions, foldWithBlock, BODY[2]])
      const ask = stubAsk([both, both])
      const out = await run({ llm, ask, mode, maxQuestions: 3 })
      if (rounds) {
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
      if (rounds) {
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
      if (rounds) assertGuessTurn(firstUserText(llm.calls[0]), label('unavailable'))
      else assert.doesNotMatch(firstUserText(llm.calls[0]), ROUND_WORDING, label('unavailable'))
    }
  }
})

test('DR-12 [EP] light never asks the fold-in reply\'s block, even with budget left; the round modes do', async () => {
  for (const mode of ['light', ...ROUND_MODES]) {
    const rounds = ROUND_MODES.includes(mode)
    const llm = stubLlm([asking(BODY[0], Q[0]), asking(BODY[1], Q[1]), BODY[2]])
    const ask = stubAsk(rounds ? [answer(ANS[0]), answer(ANS[1])] : [answer(ANS[0])])
    const out = await run({ llm, ask, mode, maxQuestions: 5 })
    assert.equal(ask.asked.length, rounds ? 2 : 1, mode)
    assert.equal(llm.calls.length, rounds ? 3 : 2, mode)
    assertStripped(out, rounds ? BODY[2] : BODY[1])
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

test('DR-15 [EP] light with a memo: still no ask call at all', async () => {
  const memory = new AnswerMemory()
  {
    const llm = stubLlm([asking(BODY[0], Q[0], Q[1]), { throw: 'gateway exploded' }])
    const ask = stubAsk([answerAll(ANS)])
    const out = await run({ llm, ask, answers: memory, mode: 'light', maxQuestions: 5 })
    assert.equal(out.code, 'UPSTREAM')
  }
  const llm = stubLlm([asking(BODY[1], Q[2]), BODY[2]])
  const ask = stubAsk([])
  const out = await run({ llm, ask, answers: memory, mode: 'light', maxQuestions: 5 })
  assert.equal(ask.asked.length, 0)
  assert.equal(llm.calls.length, 1)
  assert.doesNotMatch(firstUserText(llm.calls[0]), ROUND_WORDING)
  assertStripped(out, BODY[1])
})

// ================================================================ 7. system prompt

test('DR-16 [EP] the detailed-only system prompt text never asks for (TBD: …) markers', () => {
  const cfg = resolveConfig({})
  const detailedOnly = onlyIn(buildSystemPrompt('detailed', cfg), buildSystemPrompt('standard', cfg))
  assert.ok(detailedOnly.length > 0, 'detailed adds its own template text')
  for (const line of detailedOnly.filter((l) => /TBD/i.test(l))) {
    assert.match(line, PROHIBITION, 'a detailed-only line requires a TBD marker: ' + line)
  }
})

test('DR-17 [EP] the interactive detailed and standard system prompts have the round rules; light has none', async () => {
  const systemOf = async (mode) => {
    const llm = stubLlm([BODY[0]])
    const out = await run({ llm, ask: stubAsk([]), mode, maxQuestions: 3 })
    assert.equal(out.ok, true, JSON.stringify(out))
    return llm.calls[0].system
  }
  const [detailed, standard, light] = await Promise.all([systemOf('detailed'), systemOf('standard'), systemOf('light')])
  for (const [mode, system] of [['detailed', detailed], ['standard', standard]]) {
    assert.match(system, ONE_PER_REPLY, mode + ': one question per reply')
    assert.match(system, ASK_AGAIN, mode + ': may ask again after the answers')
    assert.match(system, LIST_GUESSES, mode + ': list guesses under the rewrite')
  }
  assert.doesNotMatch(light, ONE_PER_REPLY, 'light: no one-question rule')
  assert.doesNotMatch(light, ASK_AGAIN, 'light: no ask-again rule')
  assert.doesNotMatch(light, LIST_GUESSES, 'light: no guess-listing rule')
})
