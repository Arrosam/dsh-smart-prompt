/**
 * The follow-up panel: while a refine waits for answers it takes the composer seat (a
 * `conversation.composer` chain entry), shows the draft being refined, and lets the user
 * answer each question with Stardea ideas, own words, or both.
 *
 * Everything it shows lives in the session store (see `AskRun`); the panel only renders it
 * and forwards the user's actions to the refine flow.
 *
 * @module dsh-smart-prompt/client/follow-up
 */

import React from 'react'
import { SPARKLE_PATH, StrokeIcon, useSessionState, type TFn } from './components.js'
import { asFollowUp, cancelRefine, requestIdeas, setOwnWords, skipAsk, submitAsk, toggleIdea } from './refine.js'
import { storeFor, type AskQuestion, type Idea } from './store.js'

/** Locale key of each idea source's tag; an idea from an unknown source shows no tag. */
const SOURCE_TAG_KEY: Readonly<Record<string, string>> = Object.freeze({
  web: 'sourceWeb',
  conversation: 'sourceConversation',
  proposal: 'sourceProposal',
})

/** Short burst rays (16x16 grid) on the diagonals between the Stardea star's four points. */
const STARDEA_RAYS_PATH = 'M12.2 3.8L13.6 2.4M3.8 3.8L2.4 2.4M12.2 12.2L13.6 13.6M3.8 12.2L2.4 13.6'
/** Shrinks the composer sparkle about its centre so the rays fit around it. */
const STARDEA_STAR_TRANSFORM = 'translate(8 8) scale(.68) translate(-8 -8)'

/**
 * The Stardea glyph: a four-point star with burst rays. `pops` counts clicks: a new count
 * remounts the svg, which replays the pop/burst animation in styles.ts once per click.
 * The star sits in its own group because the animation's CSS transform would otherwise
 * replace the path's shrinking transform.
 */
function StardeaGlyph(pops: number): React.ReactElement {
  return React.createElement('svg', {
    key: pops,
    className: 'dip-stardea-glyph',
    viewBox: '0 0 16 16',
    'data-pop': pops > 0 ? 'true' : 'false',
    'aria-hidden': 'true',
    focusable: 'false',
  },
  React.createElement('g', { className: 'dip-stardea-star' },
    React.createElement('path', { d: SPARKLE_PATH, transform: STARDEA_STAR_TRANSFORM, fill: 'currentColor' })),
  React.createElement('path', { className: 'dip-stardea-rays', d: STARDEA_RAYS_PATH, fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
  )
}

/** The Stardea button of one question; busy (and disabled) while its request runs. */
function StardeaButton(props: { busy: boolean; t: TFn; onClick: () => void }): React.ReactElement {
  const { busy, t } = props
  const [pops, setPops] = React.useState(0)
  const onClick = (): void => {
    setPops((count: number) => count + 1)
    props.onClick()
  }
  return React.createElement('button', {
    type: 'button',
    className: 'dip-stardea',
    'aria-label': t('stardeaAria'),
    title: t('stardeaAria'),
    'data-busy': busy ? 'true' : 'false',
    disabled: busy,
    onClick,
  },
  StardeaGlyph(pops),
  React.createElement('span', { className: 'dip-stardea-label' }, t('stardea')),
  )
}

/** One idea as a checkbox; ticking it adds the idea's text to the question's answer. */
function IdeaOption(sessionId: string, question: AskQuestion, idea: Idea, t: TFn): React.ReactElement {
  const tagKey = Object.hasOwn(SOURCE_TAG_KEY, idea.source) ? SOURCE_TAG_KEY[idea.source] : undefined
  return React.createElement('label', { key: idea.id, className: 'dip-idea' },
    React.createElement('input', {
      type: 'checkbox',
      className: 'dip-idea-check',
      checked: question.selected.has(idea.id),
      onChange: () => { toggleIdea(sessionId, question, idea.id) },
    }),
    React.createElement('span', { className: 'dip-idea-text' }, idea.text),
    tagKey !== undefined ? React.createElement('span', { className: 'dip-idea-source', 'data-source': idea.source }, t(tagKey)) : null,
  )
}

/** One question: its text, the Stardea button, its ideas, the last Stardea note, and own words. */
function QuestionBlock(props: { sessionId: string; question: AskQuestion; t: TFn }): React.ReactElement {
  const { sessionId, question, t } = props
  const textId = React.useId()
  const notice = question.notice
  return React.createElement('div', { className: 'dip-ask-q', role: 'group', 'aria-labelledby': textId },
    React.createElement('div', { className: 'dip-ask-q-head' },
      React.createElement('p', { className: 'dip-ask-q-text', id: textId }, question.question),
      React.createElement(StardeaButton, { busy: question.pending, t, onClick: () => { void requestIdeas(sessionId, question, t) } }),
    ),
    question.ideas.length > 0
      ? React.createElement('div', { className: 'dip-ideas' }, question.ideas.map((idea) => IdeaOption(sessionId, question, idea, t)))
      : null,
    notice !== null
      ? React.createElement('p', { className: 'dip-ask-error', 'data-kind': notice.kind, role: notice.kind === 'error' ? 'alert' : 'status' }, notice.text)
      : null,
    React.createElement('textarea', {
      className: 'dip-ask-own',
      rows: 2,
      placeholder: t('askOwnWords'),
      'aria-label': t('askOwnWords'),
      'aria-describedby': textId,
      value: question.custom,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => { setOwnWords(sessionId, question, event.target.value) },
    }),
  )
}

/**
 * The composer-chain entry. Renders only for this plugin's interaction and only while the
 * session's open run is the one the interaction names; anything else renders nothing.
 *
 * @param props - the chain's props: `matched` is the interaction the entry's selector returned.
 */
export function FollowUpPanel(props: { matched?: unknown; t: TFn }): React.ReactElement | null {
  const { t } = props
  const interaction = asFollowUp(props.matched)
  useSessionState(interaction?.sessionId)
  const titleId = React.useId()
  const originalId = React.useId()
  const card = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    // The panel replaces the composer the user was typing in, which takes the focus with it.
    // Bring the focus here then, but never pull it away from anywhere still on screen.
    const node = card.current
    if (node === null || typeof document === 'undefined') return
    const active = document.activeElement
    if (active === null || active === document.body || active.getClientRects().length === 0) node.focus()
  }, [interaction?.key])

  if (interaction === null) return null
  const { sessionId } = interaction
  const state = storeFor(sessionId)
  const run = state.ask
  // The store is the authority: an interaction whose run already ended renders nothing.
  if (run === null || run.runId !== interaction.key) return null

  return React.createElement('div', { className: 'dip-ask' },
    React.createElement('section', { ref: card, className: 'dip-ask-card', 'aria-labelledby': titleId, tabIndex: -1 },
      React.createElement('header', { className: 'dip-ask-head' },
        React.createElement('h2', { className: 'dip-ask-title', id: titleId }, t('askTitle')),
        React.createElement('button', {
          type: 'button',
          className: 'dip-ask-close',
          'aria-label': t('askCancel'),
          title: t('askCancel'),
          onClick: () => { cancelRefine(sessionId, t) },
        }, StrokeIcon('dip-ask-close-icon', 'close')),
      ),
      React.createElement('div', { className: 'dip-ask-body' },
        React.createElement('div', { className: 'dip-ask-label', id: originalId }, t('askOriginal')),
        // `backup` is the draft the refine was started with: what the user typed.
        React.createElement('div', { className: 'dip-ask-original', role: 'region', 'aria-labelledby': originalId, tabIndex: 0 }, state.backup),
        run.questions.map((question) => React.createElement(QuestionBlock, { key: question.id, sessionId, question, t })),
      ),
      React.createElement('footer', { className: 'dip-ask-foot' },
        React.createElement('button', { type: 'button', className: 'dip-ask-btn dip-ask-skip', onClick: () => { skipAsk(sessionId, t) } }, t('askSkip')),
        React.createElement('button', { type: 'button', className: 'dip-ask-btn dip-ask-submit', onClick: () => { submitAsk(sessionId, t) } }, t('askSubmit')),
      ),
    ),
  )
}
