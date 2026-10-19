// Images from earlier user messages: collectTurns (lib/history.js) and how improveDraft
// (lib/orchestrate.js) sends the images of the turns the smart-context path selects.
//
// Techniques:
//  - EP: turn kinds (with images | without images); image flags (offloaded | not);
//    message kinds carrying images (typed user in a selected pair, typed user older than
//    the kept pairs, typed user with no reply, injected user context, tool message);
//    drafts (anaphoric trigger | short trigger | self-contained, non-triggering).
//  - BVA: contextTurns 1 vs 3 (the kept-pair window edge); contextChars ceilings swept so
//    that turns are cut at the boundary with and without images.
//  - Differential: the same session with and without image blocks selects the same text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../lib/config.js'
import { collectTurns } from '../lib/history.js'
import { improveDraft } from '../lib/orchestrate.js'

/** A durable image attachment reference, as derived session messages carry it. */
const att = (id) => ({ attachmentId: 'sha256:' + id, mediaType: 'image/png', bytes: 1, width: 1, height: 1 })
const imageBlock = (id, offloaded = false) => (offloaded ? { type: 'image', attachment: att(id), offloaded: true } : { type: 'image', attachment: att(id) })
const expected = (id) => ({ type: 'image', attachment: att(id) })

const user = (text, ...images) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }, ...images] })
const model = (text) => ({ role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text }] })

/** Drop every image block, leaving the text conversation unchanged. */
const withoutImages = (messages) => messages.map((m) => ({ ...m, content: m.content.filter((b) => b.type !== 'image') }))
const textPairs = (turns) => turns.map((t) => [t.user, t.assistant])

// ================================================================ collectTurns (D1, D2)

test('PI-01 [EP with images] a turn whose user message has images carries them as image blocks', () => {
  const turns = collectTurns([user('看这张截图', imageBlock('a1'), imageBlock('a2')), model('这是登录页')], 3, 6000)
  assert.equal(turns.length, 1)
  assert.equal(turns[0].user, '看这张截图')
  assert.equal(turns[0].assistant, '这是登录页')
  assert.deepEqual(turns[0].images, [expected('a1'), expected('a2')])
})

test('PI-02 [EP without images] a turn without images has no images key at all', () => {
  const turns = collectTurns([user('q1', imageBlock('a1')), model('a1'), user('q2'), model('a2')], 3, 6000)
  assert.equal(turns.length, 2)
  assert.ok('images' in turns[0])
  assert.equal('images' in turns[1], false)
})

test('PI-03 [EP text-only session] turns of a session without images keep the old shape', () => {
  const turns = collectTurns([user('q'), model('a')], 3, 6000)
  assert.deepEqual(Object.keys(turns[0]).sort(), ['assistant', 'user'])
})

test('PI-04 [EP offloaded] an offloaded image is carried without the offloaded flag', () => {
  const turns = collectTurns([user('旧截图', imageBlock('old', true)), model('ok')], 3, 6000)
  assert.deepEqual(turns[0].images, [expected('old')])
  assert.equal('offloaded' in turns[0].images[0], false)
})

test('PI-05 [EP values] the image block keeps the attachment values as they were in the message', () => {
  const ref = { attachmentId: 'sha256:ff', mediaType: 'image/jpeg', bytes: 1234, width: 640, height: 480 }
  const turns = collectTurns([user('q', { type: 'image', attachment: ref }), model('a')], 3, 6000)
  assert.deepEqual(turns[0].images, [{ type: 'image', attachment: ref }])
})

test('PI-06 [Differential] images never change which turns are selected', () => {
  const messages = []
  for (let i = 0; i < 6; i += 1) {
    messages.push(user('question ' + String(i), imageBlock('i' + String(i))))
    messages.push(model('answer ' + String(i)))
  }
  for (const turns of [1, 2, 3, 6]) {
    assert.deepEqual(textPairs(collectTurns(messages, turns, 6000)), textPairs(collectTurns(withoutImages(messages), turns, 6000)), 'turns=' + String(turns))
  }
})

test('PI-07 [BVA chars ceiling] images do not count against the character ceiling', () => {
  // Many large images on every message; sweep ceilings so the cut falls on each turn edge.
  const many = (p) => Array.from({ length: 8 }, (_, k) => ({ type: 'image', attachment: { ...att(p + String(k)), bytes: 5_000_000, width: 4000, height: 3000 } }))
  const messages = []
  for (let i = 0; i < 4; i += 1) {
    messages.push(user('q'.repeat(30) + String(i), ...many('t' + String(i))))
    messages.push(model('a'.repeat(30) + String(i)))
  }
  for (let chars = 0; chars <= 300; chars += 5) {
    const plain = collectTurns(withoutImages(messages), 4, chars)
    const rich = collectTurns(messages, 4, chars)
    assert.deepEqual(textPairs(rich), textPairs(plain), 'contextChars=' + String(chars))
  }
})

test('PI-08 [EP images per turn] each kept turn carries only its own user message images', () => {
  const messages = [user('q0', imageBlock('x0')), model('a0'), user('q1', imageBlock('x1')), model('a1')]
  const turns = collectTurns(messages, 3, 6000)
  assert.deepEqual(turns.map((t) => t.images), [[expected('x0')], [expected('x1')]])
})

test('PI-09 [EP assistant images] images in an assistant message are not carried', () => {
  const reply = { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'a' }, imageBlock('fromModel')] }
  const turns = collectTurns([user('q'), reply], 3, 6000)
  assert.equal(turns.length, 1)
  assert.equal('images' in turns[0], false)
})

// ================================================================ improveDraft (D3, D4)

const CFG = resolveConfig({})
const ANAPHORIC = '把那个接口加上限流'
const REWRITE = '为登录接口增加按 IP 的限流，每分钟 60 次。'

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

const sessionsOf = (messages) => ({ get: () => ({ deriveMessages: () => messages }) })

async function refine(messages, { draft = ANAPHORIC, cfg = CFG, depsOver = {}, inputOver = {}, replies = [REWRITE] } = {}) {
  const llm = stubLlm(replies)
  const out = await improveDraft(
    { llm, selection: { provider: 'p', model: 'm' }, lastRoute: null, sessions: sessionsOf(messages), ...depsOver },
    cfg,
    { draft, sessionId: 's1', mode: 'standard', signal: new AbortController().signal, ...inputOver },
  )
  return { out, llm }
}

const content = (call) => call.messages[0].content
const sentImages = (call) => content(call).filter((b) => b.type === 'image')
const ids = (blocks) => blocks.map((b) => b.attachment.attachmentId).sort()

/**
 * Every non-text block (after the draft text) whose nearest preceding text block matches
 * `label`; null when no label matches. One label may precede all images or each group.
 */
function groupAfter(call, label) {
  const blocks = content(call)
  let found = false
  let under = false
  const group = []
  for (const [i, b] of blocks.entries()) {
    if (i === 0) continue
    if (b.type === 'text') { under = label.test(b.text); found = found || under; continue }
    if (under) group.push(b)
  }
  return found ? group : null
}

/** Four complete pairs plus every kind of message whose images must stay home. */
const SESSION = [
  user('最早的一轮：看这个旧页面', imageBlock('tooOld')), model('旧页面收到'), // older than the last 3 pairs
  user('用 FastAPI 写登录', imageBlock('p1')), model('好的，用 FastAPI + JWT'),
  { role: 'user', source: { kind: 'context' }, content: [{ type: 'text', text: '注入的上下文' }, imageBlock('injected')] },
  { role: 'tool', source: { kind: 'tool' }, content: [{ type: 'text', text: '工具输出' }, imageBlock('tool')] },
  user('这是登录接口的报错截图', imageBlock('p2a'), imageBlock('p2b', true)), model('看到了 500 错误'),
  user('再加上日志'), model('已加日志'),
  user('还没回复的消息', imageBlock('unanswered')),
]

test('PI-10 [EP selected turns] the images of the selected turns follow an "earlier turn" label', async () => {
  const { out, llm } = await refine(SESSION)
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.meta.contextUsed, 'anaphora')
  assert.match(content(llm.calls[0])[0].text, /<raw_prompt>/, 'the framed draft stays first')
  const group = groupAfter(llm.calls[0], /earlier turn/i)
  assert.ok(group !== null, 'a label block mentions "earlier turn"')
  assert.deepEqual(ids(group), ['sha256:p1', 'sha256:p2a', 'sha256:p2b'])
})

test('PI-11 [EP sent shape] earlier images are sent as plain {type, attachment} blocks, offloaded flag dropped', async () => {
  const { llm } = await refine(SESSION)
  const p2b = sentImages(llm.calls[0]).find((b) => b.attachment.attachmentId === 'sha256:p2b')
  assert.deepEqual(p2b, expected('p2b'))
})

test('PI-12 [EP older than kept pairs] an image from a turn older than the last 3 pairs is not sent', async () => {
  const { llm } = await refine(SESSION)
  assert.ok(!ids(sentImages(llm.calls[0])).includes('sha256:tooOld'))
})

test('PI-13 [EP no reply] an image on a user message without an assistant reply is not sent', async () => {
  const { llm } = await refine(SESSION)
  assert.ok(!ids(sentImages(llm.calls[0])).includes('sha256:unanswered'))
})

test('PI-14 [EP injected context] an image on an injected user-role message is not sent', async () => {
  const { llm } = await refine(SESSION)
  assert.ok(!ids(sentImages(llm.calls[0])).includes('sha256:injected'))
})

test('PI-15 [EP tool message] an image in a tool message is not sent', async () => {
  const { llm } = await refine(SESSION)
  assert.ok(!ids(sentImages(llm.calls[0])).includes('sha256:tool'))
})

test('PI-16 [BVA contextTurns 1] with one kept pair only the latest pair\'s images are sent', async () => {
  const messages = [user('用 FastAPI 写登录', imageBlock('first')), model('好的'), user('登录接口截图', imageBlock('last')), model('看到了')]
  const { llm } = await refine(messages, { cfg: resolveConfig({ contextTurns: 1 }) })
  assert.deepEqual(ids(sentImages(llm.calls[0])), ['sha256:last'])
})

test('PI-17 [EP short draft] a short draft (12 characters or fewer) also sends the selected turns\' images', async () => {
  const { out, llm } = await refine([user('登录页截图', imageBlock('s1')), model('收到截图')], { draft: '继续优化这个' })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.notEqual(out.meta.contextUsed, 'none')
  assert.deepEqual(groupAfter(llm.calls[0], /earlier turn/i)?.map((b) => b.attachment.attachmentId), ['sha256:s1'])
})

test('PI-18 [EP self-contained draft] a long self-contained draft sends no earlier images', async () => {
  const draft = '给登录接口增加按 IP 的限流，每分钟最多 60 次请求，超出时返回 429 状态码'
  const { out, llm } = await refine(SESSION, { draft, replies: ['为登录接口增加按 IP 的限流：每分钟最多 60 次请求，超出时返回 429 状态码。'] })
  assert.equal(out.ok, true, JSON.stringify(out))
  // The last turn is always carried; SESSION's last turn has no images.
  assert.equal(out.meta.contextUsed, 'last-turn')
  assert.equal(content(llm.calls[0]).length, 1, 'exactly the draft text block')
  assert.equal(sentImages(llm.calls[0]).length, 0)
})

test('PI-19 [EP no images in session] a triggering draft over a text-only session sends no image label or image', async () => {
  const { out, llm } = await refine(withoutImages(SESSION))
  assert.equal(out.meta.contextUsed, 'anaphora')
  assert.equal(content(llm.calls[0]).length, 1)
})

test('PI-20 [EP with attachments] earlier-turn images and the draft\'s own attachments are each sent under their own label', async () => {
  const own = [{ type: 'image', attachment: att('own') }]
  const readAttachments = async () => own
  const { llm } = await refine(SESSION, { depsOver: { readAttachments }, inputOver: { attachments: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }] } })
  assert.deepEqual(groupAfter(llm.calls[0], /Attachments sent with this draft/), own)
  assert.deepEqual(ids(groupAfter(llm.calls[0], /earlier turn/i)), ['sha256:p1', 'sha256:p2a', 'sha256:p2b'])
})

test('PI-21 [EP repair] the repair call carries the same earlier-turn images', async () => {
  const draft = '把那个接口改到 src/a.ts'
  const { out, llm } = await refine(SESSION, { draft, replies: ['把登录接口迁移一下。', '把登录接口迁移到 src/a.ts。'] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(llm.calls.length, 2, 'the dropped path triggers one repair')
  assert.deepEqual(ids(groupAfter(llm.calls[1], /earlier turn/i)), ids(groupAfter(llm.calls[0], /earlier turn/i)))
  assert.deepEqual(ids(groupAfter(llm.calls[1], /earlier turn/i)), ['sha256:p1', 'sha256:p2a', 'sha256:p2b'])
})
