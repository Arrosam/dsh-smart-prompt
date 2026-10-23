// Integration and system tests for "standard takes detailed mode's whole follow-up flow"
// (requirements R1-R12). Expected outcomes come from the requirements. The "behaves exactly as
// before" requirements (R10 detailed, R11 light, R12 everything else) use the build committed
// at git HEAD as the oracle (test/support/baseline.mjs); those cases are skipped when there is
// no git checkout to read it from.
//
// Techniques:
//  - BVA: maxQuestions 0 / 1 / 2 / 5; questions left 1 (the last card) and 0 (cap reached, or a
//    remembered memo used the whole budget).
//  - EP: modes (standard | detailed | light); follow-up states (open | limit | skipped |
//    unavailable); the causes of "unavailable" (maxQuestions 0, sessionId '', no askUser, no
//    panel for the session); the forms of Skip; system prompt partitions (interactive, not
//    interactive, acceptanceCriteria on).
//  - Decision table: mode x user action (answer | skip | close | unavailable).
//  - State transition: open -> answered -> open ... -> limit; open -> skipped;
//    open -> cancelled; failed -> retried with the remembered answers.
//  - Differential: standard vs detailed (one flow); detailed, light and standard vs HEAD.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { improveDraft } from '../lib/orchestrate.js'
import { resolveConfig } from '../lib/config.js'
import { buildSystemPrompt, modePrompt } from '../lib/prompts.js'
import { AnswerMemory } from '../lib/answer-memory.js'
import { gitShow, loadBaseline } from './support/baseline.mjs'
import {
  ANS, ASK_AGAIN, DRAFT, GUESS, LISTED, LIST_GUESSES, NO_MORE, ONE_PER_REPLY, PROHIBITION, Q, SKIPPED,
  answer, answerAll, asking, assertGuessTurn, assertOneQuestionPerCard, assertStripped, cancel, dismiss, endingNote,
  firstUserText, ideasReply, lastUserText, makeRun, mountRoute, post, skip, statusOf, stubAsk, stubLlm, textOf,
} from './support/rounds-harness.mjs'

// ================================================================ fixtures

/** Questions, answers and rewrite bodies for up to six rounds; no hard facts in any of them. */
const QS = [...Q, '需要兼容旧的调用方式吗？', '要保留旧的日志格式吗？']
const AS = [...ANS, '需要兼容', '保留旧格式']
const B = ['一', '二', '三', '四', '五', '六', '七'].map((n) => '第' + n + '稿：梳理模块职责，删除多余代码。')
/** A hard fact the fidelity gate must keep once the user gave it as an answer. */
const FACT = 'src/api/limit.ts'
const IDEAS = ['保留全部对外接口', '只保留公开文档里的接口']

const MODES = ['standard', 'detailed', 'light']
/** Modes that ask one question per round; light keeps the single round. */
const ROUND_MODES = ['standard', 'detailed']

/** The working-tree build, shaped like the baseline build. */
const CURRENT = { improveDraft, resolveConfig, buildSystemPrompt, modePrompt, AnswerMemory }
const BASELINE = await loadBaseline()
after(() => BASELINE.dispose?.())
const HEAD = BASELINE.build
/** Skip reason for the cases that need the HEAD build. */
const NEEDS_HEAD = { skip: BASELINE.skip ?? false }

/** One standard refinement, 5 questions allowed (the default cap). */
const run = makeRun({ mode: 'standard', maxQuestions: 5 })

/** The follow-up note ending each request's last user turn: open:<n> | limit | skipped | unavailable | none. */
const notes = (llm) => llm.calls.map((call) => endingNote(lastUserText(call)))
const userAnswers = (text) => /<user_answers>[\s\S]*<\/user_answers>/.exec(text)?.[0] ?? ''

// ================================================================ 1. one question per reply (R1)

test('SR2-01 [EP R1] standard: a reply listing three questions shows one card with the first only; only that one counts against the cap', async () => {
  const llm = stubLlm([asking(B[0], QS[0], QS[1], QS[2]), B[1]])
  const ask = stubAsk([answer(AS[0])])
  const out = await run({ llm, ask })
  assertOneQuestionPerCard(ask, [QS[0]])
  assert.equal(llm.calls.length, 2, 'first rewrite + rewrite with the answer')
  assert.deepEqual(notes(llm), ['open:5', 'open:4'], 'one question asked: 4 of 5 left')
  assert.ok(userAnswers(lastUserText(llm.calls[1])).includes(AS[0]), 'the answer is folded in')
  assertStripped(out, B[1])
  assert.deepEqual(out.meta.questions, { asked: 1, answered: 1 })
})

test('SR2-02 [EP R1] standard: a reply without a block asks nothing; the first turn still says asking is open', async () => {
  const llm = stubLlm([B[0]])
  const ask = stubAsk([])
  const out = await run({ llm, ask })
  assert.equal(ask.asked.length, 0)
  assert.equal(llm.calls.length, 1)
  assert.deepEqual(notes(llm), ['open:5'])
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.text.trim(), B[0])
  assert.deepEqual(out.meta.questions, { asked: 0, answered: 0 })
})

// ================================================================ 2. rounds up to the cap (R2, R5)

test('SR2-03 [BVA maxQuestions 1 / 2 / 5] [State open -> answered -> ... -> limit] one card per round, then the limit turn; the last listed question is never asked', async () => {
  for (const max of [1, 2, 5]) {
    const label = 'maxQuestions ' + String(max)
    // Every reply asks one more question, the reply after the cap included (R5).
    const llm = stubLlm(B.slice(0, max + 1).map((body, i) => asking(body, QS[i])))
    const ask = stubAsk(AS.slice(0, max).map((text) => answer(text)))
    const out = await run({ llm, ask, maxQuestions: max })
    assertOneQuestionPerCard(ask, QS.slice(0, max))
    assert.equal(llm.calls.length, max + 1, label + ': first rewrite + one rewrite per answer')
    const expected = [...Array.from({ length: max }, (_, i) => 'open:' + String(max - i)), 'limit']
    assert.deepEqual(notes(llm), expected, label + ': the note counts the questions left')
    for (let i = 1; i <= max; i += 1) {
      assert.ok(userAnswers(lastUserText(llm.calls[i])).includes(AS[i - 1]), label + ': rewrite #' + String(i) + ' carries answer #' + String(i))
    }
    assertGuessTurn(lastUserText(llm.calls[max]), label + ' (limit)')
    assertStripped(out, B[max])
    assert.deepEqual(out.meta.questions, { asked: max, answered: max }, label)
  }
})

test('SR2-04 [BVA questions left 1] two listed with one left: only one is asked, then the limit turn', async () => {
  const llm = stubLlm([asking(B[0], QS[0], QS[1]), asking(B[1], QS[2], QS[3]), asking(B[2], QS[4]), B[3]])
  const ask = stubAsk([answer(AS[0]), answer(AS[2])])
  const out = await run({ llm, ask, maxQuestions: 2 })
  assertOneQuestionPerCard(ask, [QS[0], QS[2]])
  assert.equal(llm.calls.length, 3)
  assert.deepEqual(notes(llm), ['open:2', 'open:1', 'limit'])
  assertStripped(out, B[2])
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 })
})

test('SR2-05 [EP below the cap] the model stops asking at 2 of 5: no limit or guess turn, the last reply is the result', async () => {
  const llm = stubLlm([asking(B[0], QS[0]), asking(B[1], QS[1]), B[2]])
  const ask = stubAsk([answer(AS[0]), answer(AS[1])])
  const out = await run({ llm, ask })
  assertOneQuestionPerCard(ask, [QS[0], QS[1]])
  assert.deepEqual(notes(llm), ['open:5', 'open:4', 'open:3'])
  for (const call of llm.calls) assert.doesNotMatch(lastUserText(call), NO_MORE, 'asking never ended')
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.text.trim(), B[2])
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 })
})

// ================================================================ 3. skip (R4) and close (R7)

test('SR2-06 [State open -> skipped] Skip in round 1: one more rewrite told the user skipped, to guess and to list the guesses; its result is the output', async () => {
  const llm = stubLlm([asking(B[0], QS[0], QS[1]), asking(B[1], QS[2]), B[2]])
  const ask = stubAsk([skip()])
  const out = await run({ llm, ask })
  assertOneQuestionPerCard(ask, [QS[0]])
  assert.equal(llm.calls.length, 2, 'exactly one call after the skip')
  assert.deepEqual(notes(llm), ['open:5', 'skipped'])
  const turn = lastUserText(llm.calls[1])
  assert.match(turn, SKIPPED)
  assert.match(turn, GUESS)
  assert.match(turn, LISTED)
  assertStripped(out, B[1])
  assert.deepEqual(out.meta.questions, { asked: 1, answered: 0 })
})

test('SR2-07 [State open -> answered -> open -> skipped] Skip in round 2 ends the rounds; counts span both rounds', async () => {
  const llm = stubLlm([asking(B[0], QS[0]), asking(B[1], QS[1]), asking(B[2], QS[2]), B[3]])
  const ask = stubAsk([answer(AS[0]), skip()])
  const out = await run({ llm, ask })
  assertOneQuestionPerCard(ask, [QS[0], QS[1]])
  assert.equal(llm.calls.length, 3)
  assert.deepEqual(notes(llm), ['open:5', 'open:4', 'skipped'])
  assertStripped(out, B[2])
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 1 })
})

test('SR2-08 [EP skip forms] an empty batch, an answer without text and empty own words are all a Skip', async () => {
  const forms = [
    ['empty batch', skip()],
    ['no own words, nothing selected', (qs) => ({ answers: [{ id: qs[0].id, selected: [] }] })],
    ['empty own words', (qs) => ({ answers: [{ id: qs[0].id, selected: [], custom: '' }] })],
  ]
  for (const [name, step] of forms) {
    const llm = stubLlm([asking(B[0], QS[0]), B[1]])
    const out = await run({ llm, ask: stubAsk([step]) })
    assert.equal(llm.calls.length, 2, name)
    assert.deepEqual(notes(llm), ['open:5', 'skipped'], name)
    assertStripped(out, B[1])
    assert.deepEqual(out.meta.questions, { asked: 1, answered: 0 }, name)
  }
})

test('SR2-09 [State open -> cancelled] x closes the card: ABORTED, no further call, in round 1 and in round 2', async () => {
  for (const round of [1, 2]) {
    const controller = new AbortController()
    const llm = stubLlm([asking(B[0], QS[0]), asking(B[1], QS[1]), B[2]])
    const ask = stubAsk(round === 1 ? [cancel(controller)] : [answer(AS[0]), cancel(controller)])
    const out = await run({ llm, ask, controller })
    const label = 'round ' + String(round)
    assert.equal(out.ok, false, label + ': ' + JSON.stringify(out))
    assert.equal(out.code, 'ABORTED', label)
    assert.equal(out.text, undefined, label + ': no text, the draft stays as it was')
    assert.equal(ask.asked.length, round, label)
    assert.equal(llm.calls.length, round, label + ': no call after the close')
  }
})

// ================================================================ 4. asking unavailable (R6)

test('SR2-10 [EP unavailable] maxQuestions 0, sessionId "", no askUser, no panel for the session: the turn says unavailable, guess and list; nothing is asked', async () => {
  const rows = [
    ['maxQuestions 0', { maxQuestions: 0 }, stubAsk([])],
    ['sessionId ""', { sessionId: '' }, stubAsk([])],
    ['no askUser', {}, null],
    ['no panel for the session', { deps: { askUser: () => undefined } }, null],
  ]
  for (const [name, over, ask] of rows) {
    const llm = stubLlm([asking(B[0], QS[0]), B[1]])
    const out = await run({ llm, ask, ...over })
    assert.equal(llm.calls.length, 1, name + ': one call')
    if (ask !== null) assert.equal(ask.asked.length, 0, name + ': never asks')
    assert.deepEqual(notes(llm), ['unavailable'], name)
    assertGuessTurn(firstUserText(llm.calls[0]), name)
    assertStripped(out, B[0])
    assert.deepEqual(out.meta.questions, { asked: 0, answered: 0 }, name)
  }
})

// ================================================================ 5. decision table: mode x user action

test('SR2-11 [Decision] mode x (answer | skip | close | unavailable): standard follows detailed; light keeps one round and no note', async () => {
  const reply = () => [asking(B[0], QS[0], QS[1]), asking(B[1], QS[2]), B[2]]
  for (const mode of MODES) {
    const rounds = ROUND_MODES.includes(mode)
    const label = (action) => mode + ' x ' + action
    const flat = (llm) => llm.calls.flatMap((call) => call.messages.map(textOf)).join('\n')

    // answer
    {
      const llm = stubLlm(reply())
      const ask = stubAsk([answerAll(AS), answerAll(AS.slice(2))])
      const out = await run({ llm, ask, mode, maxQuestions: 3 })
      if (rounds) {
        assertOneQuestionPerCard(ask, [QS[0], QS[2]])
        assert.deepEqual(notes(llm), ['open:3', 'open:2', 'open:1'], label('answer'))
        assertStripped(out, B[2])
        assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 }, label('answer'))
      } else {
        assert.deepEqual(ask.asked.map((card) => card.map((q) => q.question)), [[QS[0], QS[1]]], label('answer') + ': every question in one card')
        assert.equal(llm.calls.length, 2, label('answer') + ': one rewrite with the answers, its block is not asked')
        assert.equal(flat(llm).includes('follow_up_status'), false, label('answer') + ': no follow-up note')
        assertStripped(out, B[1])
        assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 }, label('answer'))
      }
    }

    // skip
    {
      const llm = stubLlm(reply())
      const ask = stubAsk([skip()])
      const out = await run({ llm, ask, mode, maxQuestions: 3 })
      if (rounds) {
        assert.deepEqual(notes(llm), ['open:3', 'skipped'], label('skip'))
        assertStripped(out, B[1])
      } else {
        assert.equal(llm.calls.length, 1, label('skip') + ': keeps the first rewrite, no extra call')
        assert.equal(flat(llm).includes('follow_up_status'), false, label('skip'))
        assertStripped(out, B[0])
      }
    }

    // close (x)
    {
      const controller = new AbortController()
      const llm = stubLlm(reply())
      const out = await run({ llm, ask: stubAsk([cancel(controller)]), mode, controller, maxQuestions: 3 })
      assert.deepEqual([out.ok, out.code, llm.calls.length], [false, 'ABORTED', 1], label('close'))
    }

    // unavailable
    {
      const llm = stubLlm(reply())
      const out = await run({ llm, ask: null, mode, maxQuestions: 3 })
      assert.equal(llm.calls.length, 1, label('unavailable'))
      assert.deepEqual(notes(llm), [rounds ? 'unavailable' : 'none'], label('unavailable'))
      assertStripped(out, B[0])
    }
  }
})

// ================================================================ 6. standard runs detailed's flow (R1-R8 as one)

/** One attempt of a scenario: model replies, card steps (a function of the run context) and input overrides. */
const once = (script, cards = () => [], over = {}) => ({ script, cards, over })

/** Picks the first Stardea idea for the card's question. */
const stardeaThenAnswer = ({ ideas }) => async (questions, signal, stardea) => {
  const found = await stardea(questions[0].id, signal)
  ideas.push(found)
  return { answers: [{ id: questions[0].id, selected: found.ok ? [found.ideas[0].text] : [], custom: '' }] }
}

/** Scripted refinements covering every follow-up state and the gates. */
const SCENARIOS = [
  { name: 'no question', attempts: [once([B[0]])] },
  { name: 'one question, answered', attempts: [once([asking(B[0], QS[0]), B[1]], () => [answer(AS[0])])] },
  { name: 'several listed, all answered', attempts: [once([asking(B[0], QS[0], QS[1], QS[2]), asking(B[1], QS[3]), B[2]], () => [answerAll(AS), answerAll(AS.slice(1)), answerAll(AS.slice(2))])] },
  { name: 'rounds up to the cap of 2', attempts: [once([asking(B[0], QS[0]), asking(B[1], QS[1]), asking(B[2], QS[2]), B[3]], () => AS.slice(0, 3).map((a) => answer(a)), { maxQuestions: 2 })] },
  { name: 'skip', attempts: [once([asking(B[0], QS[0], QS[1]), asking(B[1], QS[2]), B[2]], () => [skip(), answer(AS[0])])] },
  { name: 'answer, then skip', attempts: [once([asking(B[0], QS[0]), asking(B[1], QS[1]), asking(B[2], QS[2]), B[3]], () => [answer(AS[0]), skip(), answer(AS[2])])] },
  { name: 'close (x)', attempts: [once([asking(B[0], QS[0]), B[1]], ({ controller }) => [cancel(controller)])] },
  { name: 'card dismissed without an abort', attempts: [once([asking(B[0], QS[0]), B[1], B[2]], () => [dismiss()])] },
  { name: 'maxQuestions 0', attempts: [once([asking(B[0], QS[0]), B[1]], () => [], { maxQuestions: 0 })] },
  { name: 'no session', attempts: [once([asking(B[0], QS[0]), B[1]], () => [], { sessionId: '' })] },
  { name: 'no askUser', attempts: [{ ...once([asking(B[0], QS[0]), B[1]]), noAsk: true }] },
  { name: 'the rewrite with the answer fails upstream', attempts: [once([asking(B[0], QS[0]), { throw: 'gateway exploded' }], () => [answer(AS[0])])] },
  {
    name: 'retry with the remembered answer', memo: true,
    attempts: [
      once([asking(B[0], QS[0]), { throw: 'gateway exploded' }], () => [answer(AS[0])], { maxQuestions: 2 }),
      once([asking(B[1], QS[1], QS[2]), asking(B[2], QS[3]), B[3]], () => [answer(AS[1]), answer(AS[2])], { maxQuestions: 2 }),
    ],
  },
  { name: 'an answered hard fact dropped, then repaired', attempts: [once([asking(B[0], QS[0]), B[1], B[1] + ' ' + FACT], () => [answer(FACT)], { maxQuestions: 1 })] },
  { name: 'Stardea click', attempts: [once([asking(B[0], QS[0], QS[1]), ideasReply(IDEAS), B[1], B[2]], (ctx) => [stardeaThenAnswer(ctx), answer(AS[1])])] },
  { name: 'over the length ceiling', raw: { standardMaxRatio: 2 }, attempts: [once(['x'.repeat(5000), 'y'.repeat(5000)])] },
  { name: 'acceptance criteria on', raw: { acceptanceCriteria: true }, attempts: [once([asking(B[0], QS[0]), B[1]], () => [answer(AS[0])])] },
]

/** An outcome without its wall-clock time. */
const settled = (out) => (out.ok ? { ...out, meta: { ...out.meta, elapsedMs: 0 } } : out)

/**
 * Message ids come from a counter shared by every refinement of the module, so their values
 * depend on what ran before. Each id is renumbered by its first appearance in the trace: two
 * traces still match only when they use the same ids in the same places.
 */
function renumberIds(trace) {
  const seen = new Map()
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, v]) => {
      if (key !== 'id' || typeof v !== 'string' || !/^dsh-smart-prompt-\d+$/.test(v)) return [key, walk(v)]
      if (!seen.has(v)) seen.set(v, 'msg-' + String(seen.size + 1))
      return [key, seen.get(v)]
    }))
  }
  return walk(trace)
}

/** Play one scenario through one build: every request, card, outcome and Stardea result. */
async function play(build, mode, scenario) {
  const memory = scenario.memo === true ? new build.AnswerMemory() : undefined
  const config = build.resolveConfig(scenario.raw ?? {})
  const ideas = []
  const attempts = []
  for (const attempt of scenario.attempts) {
    const controller = new AbortController()
    const llm = stubLlm([...attempt.script])
    const ask = attempt.noAsk === true ? null : stubAsk(attempt.cards({ controller, ideas }))
    const out = await run({ llm, ask, controller, answers: memory, mode, improve: build.improveDraft, config, ...attempt.over })
    attempts.push({ calls: llm.calls, cards: ask === null ? null : ask.asked, outcome: settled(out) })
  }
  return renumberIds({ attempts, ideas })
}

/** A trace without what the mode legitimately changes: the system prompt (mode template) and meta.mode. */
const flowOf = (trace) => ({
  ideas: trace.ideas,
  attempts: trace.attempts.map(({ calls, cards, outcome }) => ({
    calls: calls.map(({ system, ...request }) => request),
    cards,
    outcome: outcome.ok ? { ...outcome, meta: { ...outcome.meta, mode: undefined } } : outcome,
  })),
})

test('SR2-12 [Differential R1-R8] standard sends exactly the requests detailed sends, shows the same cards and ends the same, in every scenario', async () => {
  for (const scenario of SCENARIOS) {
    const [standard, detailed] = [await play(CURRENT, 'standard', scenario), await play(CURRENT, 'detailed', scenario)]
    assert.deepEqual(flowOf(standard), flowOf(detailed), scenario.name)
    for (const { calls, outcome } of standard.attempts) {
      if (outcome.ok) assert.equal(outcome.meta.mode, 'standard', scenario.name)
      // Every turn that asks for a rewrite (the first one, and one carrying answers or a skip) ends with a note.
      const rewriteTurns = calls.filter((call, i) => i === 0 || /<user_answers>|skipped/i.test(lastUserText(call)))
      for (const call of rewriteTurns) assert.notEqual(statusOf(lastUserText(call)), undefined, scenario.name + ': ' + lastUserText(call).slice(-300))
    }
  }
})

// ================================================================ 7. remembered answers (R8)

/** First attempt: the answers of \`steps\` are given, then the next rewrite fails upstream. */
async function failAfterAnswers(memory, steps, maxQuestions) {
  const replies = steps.map((_, i) => asking(B[i], QS[i]))
  const llm = stubLlm([...replies, { throw: 'gateway exploded' }])
  const ask = stubAsk(steps)
  const out = await run({ llm, ask, answers: memory, maxQuestions })
  assert.equal(out.code, 'UPSTREAM', 'the first attempt must fail: ' + JSON.stringify(out))
  assert.equal(ask.asked.length, steps.length, 'the first attempt asks once per round')
}

test('SR2-13 [BVA memo, 1 question left] a retry with maxQuestions 2 folds the memo, asks one more, then the limit turn', async () => {
  const memory = new AnswerMemory()
  await failAfterAnswers(memory, [answer(AS[0])], 2)
  const llm = stubLlm([asking(B[1], QS[1], QS[2]), asking(B[2], QS[3]), B[3]])
  const ask = stubAsk([answer(AS[1])])
  const out = await run({ llm, ask, answers: memory, maxQuestions: 2 })
  assert.ok(userAnswers(firstUserText(llm.calls[0])).includes(AS[0]), 'the remembered answer is in the first call')
  assertOneQuestionPerCard(ask, [QS[1]])
  assert.deepEqual(notes(llm), ['open:1', 'limit'])
  assertStripped(out, B[2])
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 })
})

test('SR2-14 [BVA memo, 0 questions left] a retry with maxQuestions 1 folds the memo, asks nothing and says the limit is reached', async () => {
  const memory = new AnswerMemory()
  await failAfterAnswers(memory, [answer(AS[0])], 1)
  const llm = stubLlm([asking(B[1], QS[1]), B[2]])
  const ask = stubAsk([])
  const out = await run({ llm, ask, answers: memory, maxQuestions: 1 })
  assert.equal(ask.asked.length, 0)
  assert.equal(llm.calls.length, 1)
  assert.ok(userAnswers(firstUserText(llm.calls[0])).includes(AS[0]))
  assert.deepEqual(notes(llm), ['limit'])
  assertGuessTurn(firstUserText(llm.calls[0]), 'memo used the whole budget')
  assertStripped(out, B[1])
  assert.deepEqual(out.meta.questions, { asked: 1, answered: 1 })
})

test('SR2-15 [State failed -> retried] answers of two rounds are remembered together and both count against the cap', async () => {
  const memory = new AnswerMemory()
  await failAfterAnswers(memory, [answer(AS[0]), answer(AS[1])], 5)
  const llm = stubLlm([B[2]])
  const ask = stubAsk([])
  const out = await run({ llm, ask, answers: memory, maxQuestions: 5 })
  const folded = userAnswers(firstUserText(llm.calls[0]))
  assert.ok(folded.includes(AS[0]) && folded.includes(AS[1]), 'both remembered answers: ' + folded)
  assert.deepEqual(notes(llm), ['open:3'], '2 of 5 questions were used')
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.deepEqual(out.meta.questions, { asked: 2, answered: 2 })
})

// ================================================================ 8. the standard system prompt (R9)

const STANDARD_TEMPLATE = modePrompt('standard')
/** Paragraphs and bullets of a template, whitespace collapsed. */
const paragraphs = (text) => text.split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '')
const sentences = (text) => paragraphs(text).flatMap((p) => p.split(/(?<=[.。])\s+/))
const GUESS_ONLY_AFTER = /\bguess\w*\b[^.\n]{0,40}\bonly\b[^.\n]{0,40}\b(?:asking|questions?)\b[^.\n]{0,30}\b(?:ended|over|reached)|\bnever guess\w*\b[^.\n]{0,40}\bwhile\b[^.\n]{0,60}\bask/i

/** The system prompt standard sends, interactive or not. */
async function standardSystem(over = {}) {
  const llm = stubLlm([B[0]])
  const out = await run({ llm, ask: stubAsk([]), ...over })
  assert.equal(out.ok, true, JSON.stringify(out))
  return llm.calls[0].system
}

test('SR2-16 [EP R9] the standard template, part of every standard system prompt, states the round rules', async () => {
  for (const [name, over] of [['interactive', {}], ['not interactive', { sessionId: '' }]]) {
    assert.ok((await standardSystem(over)).includes(STANDARD_TEMPLATE), name + ': the system prompt carries the standard template')
  }
  const parts = paragraphs(STANDARD_TEMPLATE)
  const some = (label, ...patterns) => assert.ok(parts.some((p) => patterns.every((re) => re.test(p))), 'standard template: ' + label)
  some('at most one question per reply, in <missing_info>', ONE_PER_REPLY, /missing_info/)
  some('may ask again after the answers', ASK_AGAIN)
  some('guess only once asking has ended', GUESS_ONLY_AFTER)
  some('list the guesses under the rewrite', LIST_GUESSES)
  assert.ok(STANDARD_TEMPLATE.includes('## Guessed details'), 'the English guess heading')
  assert.ok(STANDARD_TEMPLATE.includes('## 猜测补充'), 'the Chinese guess heading')
  some('overrides the missing-information and answers rules where they differ', /\boverrid/i, /missing[- ]information|questions? rules/i, /\banswers? rules/i)
})

test('SR2-17 [EP R9] the standard template never asks for TBD or placeholder notes; it forbids them', () => {
  const mentions = sentences(STANDARD_TEMPLATE).filter((s) => /\bTBD\b|placeholder/i.test(s))
  assert.ok(mentions.some((s) => /\bTBD\b/.test(s) && /\b(?:never|do not|don't)\b/i.test(s)), 'a sentence forbids TBD notes')
  for (const sentence of mentions) assert.match(sentence, PROHIBITION, 'a sentence asks for a TBD / placeholder note: ' + sentence)
})

// ================================================================ 9. nothing else changes (R12) — HEAD oracle

/** The system prompt the first call of one run sends. */
async function sentSystem(build, mode, raw, over) {
  const llm = stubLlm([B[0]])
  await run({ llm, ask: stubAsk([]), mode, improve: build.improveDraft, config: build.resolveConfig(raw), ...over })
  return llm.calls[0].system
}

const PROMPT_PARTITIONS = [
  ['interactive', {}, {}],
  ['not interactive', {}, { sessionId: '' }],
  ['interactive, acceptance criteria', { acceptanceCriteria: true }, {}],
  ['not interactive, acceptance criteria', { acceptanceCriteria: true }, { sessionId: '' }],
]

test('SR2-18 [Differential R12] the standard system prompt differs from HEAD only in the standard template', NEEDS_HEAD, async () => {
  const MARK = '<standard template>'
  for (const [name, raw, over] of PROMPT_PARTITIONS) {
    const now = await sentSystem(CURRENT, 'standard', raw, over)
    const before = await sentSystem(HEAD, 'standard', raw, over)
    assert.ok(now.includes(CURRENT.modePrompt('standard')) && before.includes(HEAD.modePrompt('standard')), name)
    assert.equal(now.replace(CURRENT.modePrompt('standard'), MARK), before.replace(HEAD.modePrompt('standard'), MARK), name)
  }
})

/** A user turn without the follow-up note that may end it. */
const stripNote = (text) => text.replace(/\s*<follow_up_status>[\s\S]*?<\/follow_up_status>\s*$/, '')

test('SR2-19 [Differential R3 R12] standard user turns are HEAD\'s turns plus the note; requests, cards and results are otherwise unchanged', NEEDS_HEAD, async () => {
  // Scenarios whose flow standard shared with HEAD: at most one question, no skip.
  const shared = ['no question', 'one question, answered', 'maxQuestions 0', 'no session', 'no askUser', 'an answered hard fact dropped, then repaired', 'over the length ceiling', 'acceptance criteria on']
  for (const scenario of SCENARIOS.filter((s) => shared.includes(s.name))) {
    const now = await play(CURRENT, 'standard', scenario)
    const before = await play(HEAD, 'standard', scenario)
    const view = (trace) => trace.attempts.map(({ calls, cards, outcome }) => ({
      calls: calls.map((call) => ({ tools: call.tools, messages: call.messages.map((m) => ({ role: m.role, parts: m.content.length, text: stripNote(textOf(m)) })) })),
      cards,
      outcome,
    }))
    assert.deepEqual(view(now), view(before), scenario.name)
    const first = now.attempts[0].calls[0]
    assert.notEqual(statusOf(firstUserText(first)), undefined, scenario.name + ': the first standard turn ends with a note')
    assert.equal(statusOf(firstUserText(before.attempts[0].calls[0])), undefined, scenario.name + ': HEAD sent none')
  }
})

// ================================================================ 10. detailed unchanged (R10)

test('SR2-20 [R10] prompts/detailed.md is unchanged from HEAD', { skip: gitShow('prompts/detailed.md') === undefined ? 'no git checkout' : false }, () => {
  assert.equal(readFileSync(new URL('../prompts/detailed.md', import.meta.url), 'utf8'), gitShow('prompts/detailed.md'))
})

test('SR2-21 [R10] the detailed system prompt is identical to HEAD\'s in every partition', NEEDS_HEAD, async () => {
  assert.equal(CURRENT.modePrompt('detailed'), HEAD.modePrompt('detailed'))
  for (const [name, raw, over] of PROMPT_PARTITIONS) {
    assert.equal(await sentSystem(CURRENT, 'detailed', raw, over), await sentSystem(HEAD, 'detailed', raw, over), name)
    assert.equal(CURRENT.buildSystemPrompt('detailed', CURRENT.resolveConfig(raw), ['<extra>']), HEAD.buildSystemPrompt('detailed', HEAD.resolveConfig(raw), ['<extra>']), name + ' (built)')
  }
})

test('SR2-22 [Differential R10] detailed sends exactly the requests HEAD sent, shows the same cards and ends the same, in every scenario', NEEDS_HEAD, async () => {
  for (const scenario of SCENARIOS) {
    assert.deepEqual(await play(CURRENT, 'detailed', scenario), await play(HEAD, 'detailed', scenario), scenario.name)
  }
})

// ================================================================ 11. light unchanged (R11)

test('SR2-23 [R11] prompts/light.md is unchanged from HEAD', { skip: gitShow('prompts/light.md') === undefined ? 'no git checkout' : false }, () => {
  assert.equal(readFileSync(new URL('../prompts/light.md', import.meta.url), 'utf8'), gitShow('prompts/light.md'))
})

test('SR2-24 [R11] the light system prompt is identical to HEAD\'s in every partition', NEEDS_HEAD, async () => {
  assert.equal(CURRENT.modePrompt('light'), HEAD.modePrompt('light'))
  for (const [name, raw, over] of PROMPT_PARTITIONS) {
    assert.equal(await sentSystem(CURRENT, 'light', raw, over), await sentSystem(HEAD, 'light', raw, over), name)
  }
})

test('SR2-25 [Differential R11] light sends exactly the requests HEAD sent, shows the same cards and ends the same, in every scenario', NEEDS_HEAD, async () => {
  for (const scenario of SCENARIOS) {
    assert.deepEqual(await play(CURRENT, 'light', scenario), await play(HEAD, 'light', scenario), scenario.name)
  }
})

// ================================================================ 12. other features in standard rounds (R12)

test('SR2-26 [EP Stardea] a click on the open question gets ideas in every round; a question not on the card or a finished run answers NO_RUN', async () => {
  const results = []
  let late
  const click = (pick) => async (questions, signal, stardea) => {
    late = stardea
    const found = await stardea(questions[0].id, signal)
    results.push(found)
    results.push(await stardea(questions[0].id + '-not-on-card', signal))
    return { answers: [{ id: questions[0].id, selected: [found.ideas[pick].text], custom: '' }] }
  }
  const llm = stubLlm([asking(B[0], QS[0], QS[1]), ideasReply(IDEAS), asking(B[1], QS[2]), ideasReply(['补齐单元测试']), B[2]])
  const ask = stubAsk([click(0), click(0)])
  const out = await run({ llm, ask })
  assertOneQuestionPerCard(ask, [QS[0], QS[2]])
  assert.deepEqual(results.map((r) => r.ok), [true, false, true, false])
  assert.deepEqual(results[0].ideas.map((i) => i.text), IDEAS)
  assert.deepEqual(results[2].ideas.map((i) => i.text), ['补齐单元测试'])
  for (const missing of [results[1], results[3]]) assert.equal(missing.code, 'NO_RUN')
  assert.equal(llm.calls.length, 5, 'rewrite, click, rewrite, click, rewrite: no call for a question not on the card')
  assert.ok(lastUserText(llm.calls[1]).includes(QS[0]), 'the first click asks about the first card\'s question')
  assert.ok(lastUserText(llm.calls[3]).includes(QS[2]), 'the second click asks about the second card\'s question')
  assert.ok(userAnswers(lastUserText(llm.calls[2])).includes(IDEAS[0]), 'the picked idea is the answer')
  assertStripped(out, B[2])
  const after = await late(QS[0], new AbortController().signal)
  assert.equal(after.code, 'NO_RUN', 'Stardea after the refinement finished')
  assert.equal(llm.calls.length, 5)
})

test('SR2-27 [EP fidelity] a hard fact the user answered and the last rewrite dropped gets exactly one repair call', async () => {
  const llm = stubLlm([asking(B[0], QS[0]), asking(B[1], QS[1]), B[1] + ' ' + FACT])
  const ask = stubAsk([answer(FACT)])
  const out = await run({ llm, ask, maxQuestions: 1 })
  assert.equal(llm.calls.length, 3, 'first rewrite, rewrite with the answer, one repair')
  assert.ok(lastUserText(llm.calls[2]).includes(FACT), 'the repair names the dropped fact')
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.ok(out.text.includes(FACT))
  assert.equal(out.meta.anchors.reinjected, 0)
})

test('SR2-28 [BVA length] standard stays uncapped by default; with standardMaxRatio 2 an over-long last rewrite is repaired once, then refused', async () => {
  const long = 'x'.repeat(5000)
  const uncapped = await run({ llm: stubLlm([asking(B[0], QS[0]), long]), ask: stubAsk([answer(AS[0])]), maxQuestions: 1 })
  assert.equal(uncapped.ok, true, JSON.stringify(uncapped))
  assert.equal(uncapped.text, long)

  const llm = stubLlm([asking(B[0], QS[0]), long, 'y'.repeat(5000)])
  const out = await run({ llm, ask: stubAsk([answer(AS[0])]), maxQuestions: 1, config: resolveConfig({ standardMaxRatio: 2 }) })
  assert.equal(llm.calls.length, 3, 'first rewrite, rewrite with the answer, one length repair')
  assert.equal(out.code, 'LENGTH_EXCEEDED', JSON.stringify(out))
  assert.match(out.message, /5000 > 600/)
})

// ================================================================ 13. HTTP route (system level)

const askBody = (over = {}) => ({ sessionId: 's1', text: DRAFT, interactive: true, ...over })
const cancelRuns = async (route, ...runIds) => { for (const runId of runIds) if (typeof runId === 'string') await post(route, 'cancel', { runId }) }

test('SR2-29 [System State open -> answered -> open -> answered] the default mode asks one question per /improve and /answer exchange', async () => {
  const { route, llm } = mountRoute({ script: [asking(B[0], QS[0], QS[1]), asking(B[1], QS[2]), B[2]] })
  const first = await post(route, 'improve', askBody())
  const run1 = first.json?.ask?.runId
  let run2
  try {
    assert.equal(first.json.ok, true, JSON.stringify(first.json))
    assert.deepEqual(first.json.ask.questions.map((q) => q.question), [QS[0]])
    const second = await post(route, 'answer', { runId: run1, answers: [{ id: first.json.ask.questions[0].id, selected: [], custom: AS[0] }] })
    run2 = second.json?.ask?.runId
    assert.equal(second.json.ok, true, JSON.stringify(second.json))
    assert.deepEqual(second.json.ask.questions.map((q) => q.question), [QS[2]], 'the next round asks the next question')
    assert.equal('text' in second.json, false, 'no text while asking')
    assert.notEqual(run2, run1)
    const stale = await post(route, 'answer', { runId: run1, answers: [] })
    assert.deepEqual([stale.json.ok, stale.json.code], [false, 'NO_RUN'], 'the answered round is over')
    const final = await post(route, 'answer', { runId: run2, answers: [{ id: second.json.ask.questions[0].id, selected: [], custom: AS[2] }] })
    assert.equal(final.json.ok, true, JSON.stringify(final.json))
    assert.equal(final.json.text.trim(), B[2])
    assert.equal(final.json.meta.mode, 'standard')
    assert.deepEqual(final.json.meta.questions, { asked: 2, answered: 2 })
    assert.deepEqual(notes(llm), ['open:5', 'open:4', 'open:3'])
  } finally { await cancelRuns(route, run1, run2) }
})

test('SR2-30 [System State open -> skipped] /answer with no answers rewrites once more with the skipped note; that rewrite is the result', async () => {
  const { route, llm } = mountRoute({ script: [asking(B[0], QS[0], QS[1]), asking(B[1], QS[2])] })
  const asked = await post(route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    const final = await post(route, 'answer', { runId, answers: [] })
    assert.equal(final.json.ok, true, JSON.stringify(final.json))
    assert.equal(final.json.ask, undefined, 'nothing is asked after a skip')
    assertStripped(final.json, B[1])
    assert.deepEqual(notes(llm), ['open:5', 'skipped'])
  } finally { await cancelRuns(route, runId) }
})

test('SR2-31 [System State open -> cancelled] /cancel ends the run: no further call, /answer answers NO_RUN', async () => {
  const { route, llm } = mountRoute({ script: [asking(B[0], QS[0]), B[1]] })
  const asked = await post(route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  assert.equal(typeof runId, 'string', JSON.stringify(asked.json))
  assert.deepEqual((await post(route, 'cancel', { runId })).json, { ok: true })
  const late = await post(route, 'answer', { runId, answers: [{ id: 'q1', selected: [], custom: AS[0] }] })
  assert.deepEqual([late.json.ok, late.json.code], [false, 'NO_RUN'])
  assert.equal(llm.calls.length, 1)
})

test('SR2-32 [System EP unavailable] /improve without interactive: one call with the unavailable note, the block stripped, nothing asked', async () => {
  const { route, llm } = mountRoute({ script: [asking(B[0], QS[0]), B[1]] })
  const reply = await post(route, 'improve', { sessionId: 's1', text: DRAFT })
  assert.equal(reply.json.ask, undefined)
  assertStripped(reply.json, B[0])
  assert.equal(reply.json.meta.mode, 'standard')
  assert.deepEqual(notes(llm), ['unavailable'])
})

test('SR2-33 [System R11] saved defaultMode light: one card with every question; skipping keeps the first rewrite, no extra call, no note', async () => {
  const { route, llm } = mountRoute({ raw: { defaultMode: 'light' }, script: [asking(B[0], QS[0], QS[1]), B[1]] })
  const asked = await post(route, 'improve', askBody())
  const runId = asked.json?.ask?.runId
  try {
    assert.deepEqual(asked.json.ask.questions.map((q) => q.question), [QS[0], QS[1]])
    const final = await post(route, 'answer', { runId, answers: [] })
    assertStripped(final.json, B[0])
    assert.equal(final.json.meta.mode, 'light')
    assert.equal(llm.calls.length, 1)
    assert.deepEqual(notes(llm), ['none'])
  } finally { await cancelRuns(route, runId) }
})
