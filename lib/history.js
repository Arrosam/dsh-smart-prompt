/**
 * Session-history collection for the smart-context path.
 *
 * Only human messages (with the images the user attached to them) and assistant prose
 * are ever carried: tool results (file contents, command output) and plugin-injected
 * context are excluded by design, so enabling context never leaks project data the user
 * did not provide.
 *
 * @module dsh-smart-prompt/history
 */
import { charLength } from './length-gate.js';
import { referenceBlock } from './prompts.js';
/**
 * The live session's current messages.
 *
 * @param sessions - the host sessions service, when present.
 * @param sessionId - the session to read.
 * @returns `deriveMessages()` output, or [] when the host or session cannot say.
 */
export function liveMessages(sessions, sessionId) {
    const session = sessions?.get(sessionId);
    return typeof session?.deriveMessages === 'function' ? session.deriveMessages() : [];
}
/** Characters kept from the tail of one assistant reply. */
const ASSISTANT_TAIL = 600;
/** Speaker labels of one rendered turn. */
const TURN_LABEL = Object.freeze({ user: '用户: ', assistant: '助手结论: ' });
function blocksOf(message) {
    if (!Array.isArray(message.content))
        return [];
    return message.content.filter((block) => block !== null && typeof block === 'object');
}
/**
 * The visible text of one message: its text blocks only (no reasoning, tool calls or
 * attachments).
 *
 * @param message - a derived or logged message, or anything else.
 * @returns the joined text, trimmed; '' when there is none.
 */
export function textOf(message) {
    const parts = [];
    for (const block of blocksOf(message)) {
        if (block.type === 'text' && typeof block.text === 'string')
            parts.push(block.text);
    }
    return parts.join('\n').trim();
}
/**
 * The image blocks of one message, rebuilt from their durable references. The
 * conversation's `offloaded` mark is left behind on purpose: it records a budget
 * decision for the agent's own requests, and the refinement request is a different,
 * much smaller one that should see the image itself.
 */
function imagesOf(message) {
    return blocksOf(message)
        .filter((block) => block.type === 'image' && block.attachment !== null && typeof block.attachment === 'object')
        .map((block) => Object.freeze({ type: 'image', attachment: block.attachment }));
}
/**
 * Whether a message is one the user typed or a reply the model wrote: the only two
 * kinds this plugin ever reads from a session. Injected user-role context (file
 * notices, skills, compaction summaries) and tool results are neither.
 *
 * @param message - a derived or logged message, or anything else.
 * @returns 'user', 'assistant', or null for every other message.
 */
export function speakerOf(message) {
    if (message === null || typeof message !== 'object')
        return null;
    const raw = message;
    const kind = raw.source !== undefined && raw.source !== null ? raw.source.kind : undefined;
    if (raw.role === 'user' && kind === 'user')
        return 'user';
    if (raw.role === 'assistant' && kind === 'model')
        return 'assistant';
    return null;
}
/** The last `limit` codepoints of a text, marked with a leading ellipsis when clipped. */
function tail(text, limit) {
    if (charLength(text) <= limit)
        return text;
    return '…' + Array.from(text).slice(-limit).join('');
}
/**
 * Collect the last N question/answer pairs from a session's derived messages.
 *
 * Feature-detected throughout: a host without the sessions service, an old session
 * object without `deriveMessages`, or any throw all degrade to an empty list —
 * context is an optimization, never a precondition.
 *
 * @param messages - `session.deriveMessages()` output, or anything else.
 * @param turns - how many pairs to keep (0 disables).
 * @param totalChars - hard character ceiling across all kept turns.
 * @returns the turns in chronological order.
 */
export function collectTurns(messages, turns, totalChars) {
    if (!Array.isArray(messages) || turns <= 0 || totalChars <= 0)
        return [];
    const pairs = [];
    let pendingUser = null;
    // The turn's LAST assistant text: an agent turn writes prose between tool calls, and the
    // final reply is the one the user actually read and reacts to in the next draft.
    let reply = '';
    const flush = () => {
        if (pendingUser === null || reply === '')
            return;
        // Images ride along with the user message they belong to; they never change
        // which turns are kept, and they do not count against the character ceiling.
        const images = imagesOf(pendingUser);
        pairs.push({ user: textOf(pendingUser), assistant: tail(reply, ASSISTANT_TAIL), ...(images.length > 0 ? { images } : {}) });
    };
    for (const raw of messages) {
        const speaker = speakerOf(raw);
        if (speaker === null)
            continue;
        const text = textOf(raw);
        if (text === '')
            continue;
        if (speaker === 'user') {
            flush();
            pendingUser = raw;
            reply = '';
        }
        else if (pendingUser !== null) {
            reply = text;
        }
    }
    flush();
    const kept = [];
    let used = 0;
    for (let i = pairs.length - 1; i >= 0 && kept.length < turns; i -= 1) {
        const pair = pairs[i];
        const cost = pair.user.length + pair.assistant.length;
        if (kept.length > 0 && used + cost > totalChars)
            break;
        used += cost;
        kept.unshift(pair);
    }
    return kept;
}
/**
 * Render turns as one reference block placed before the draft.
 *
 * @param turns - collected turns.
 * @returns the block, or '' when there is nothing to carry.
 */
export function formatHistoryBlock(turns) {
    if (turns.length === 0)
        return '';
    const body = turns
        .map((turn) => TURN_LABEL.user + turn.user + '\n' + TURN_LABEL.assistant + turn.assistant)
        .join('\n\n');
    return referenceBlock('conversation_context', 'Recent turns of the conversation this draft belongs to (' + String(turns.length) + ' most recent).', 'it', body);
}
//# sourceMappingURL=history.js.map