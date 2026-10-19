/**
 * Session lookups: two small tools the refinement model may call when the draft depends
 * on something said earlier in the conversation that the attached context does not hold,
 * or while it looks for ideas to answer a follow-up question (Stardea).
 *
 * Only what the user typed and what the assistant replied is searchable, through the same
 * message filter as the smart-context path (`speakerOf` in history.ts): tool results and
 * injected context never reach the refinement model (user decision).
 *
 * The results go back to the model as tool results in the refinement's own conversation
 * (refine-chat.ts), where every later call of the refinement still sees them.
 *
 * @module dsh-smart-prompt/session-lookup
 */
import { speakerOf, textOf } from './history.js';
import { argsOf } from './lookups.js';
import { escapeClosingTag } from './prompts.js';
/** Tool names, as the model sees them. */
export const SEARCH_TOOL = 'search_session';
export const READ_TOOL = 'read_session_messages';
/** Most matches one search returns. */
const SEARCH_LIMIT = 8;
/** Characters of context around a search match. */
const SNIPPET_CHARS = 240;
/** Most messages one read returns. */
const READ_MAX_MESSAGES = 5;
/** Characters kept from one message a read returns. */
const READ_MESSAGE_CHARS = 4000;
/** The tool schemas offered while lookup rounds remain. */
export const LOOKUP_TOOLS = Object.freeze([
    Object.freeze({
        name: SEARCH_TOOL,
        description: 'Search the earlier messages of this conversation (the user\'s messages and the assistant\'s replies) for words or a phrase. '
            + 'Returns matching messages by number (#1 is the oldest) with a short excerpt.',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Words or a phrase to find, in the language the conversation uses.' } },
            required: ['query'],
            additionalProperties: false,
        },
    }),
    Object.freeze({
        name: READ_TOOL,
        description: 'Read earlier messages of this conversation in full, by number (#1 is the oldest), up to '
            + String(READ_MAX_MESSAGES) + ' at a time.',
        parameters: {
            type: 'object',
            properties: {
                from: { type: 'integer', minimum: 1, description: 'Number of the first message to read.' },
                count: { type: 'integer', minimum: 1, maximum: READ_MAX_MESSAGES, description: 'How many messages to read; default 1.' },
            },
            required: ['from'],
            additionalProperties: false,
        },
    }),
]);
/**
 * The conversation's earlier messages as a lookup source. The transcript is loaded once
 * per refinement, on the first lookup.
 */
export class SessionLookup {
    load;
    tools = LOOKUP_TOOLS;
    transcript = null;
    /** @param load - reads the conversation; called at most once, on the first lookup. */
    constructor(load) {
        this.load = load;
    }
    /** Run one search or read call. */
    async run(call) {
        return runCall(await this.entries(), call);
    }
    entries() {
        // A failure becomes an empty transcript: lookups are an optimization, never a reason
        // for the refinement itself to fail.
        this.transcript ??= this.load().then(toEntries, () => []);
        return this.transcript;
    }
}
/**
 * The messages of a raw session log (`sessionQuery.readSession().events`), oldest first.
 * The log keeps messages a compaction has since summarized away, which the live derived
 * surface no longer holds; `speakerOf` later drops everything but the user's and the
 * model's own messages.
 *
 * @param events - logged session events, or anything else.
 * @returns the message of every user and assistant message event.
 */
export function messagesOfLog(events) {
    if (!Array.isArray(events))
        return [];
    const messages = [];
    for (const event of events) {
        if (event === null || typeof event !== 'object' || event.data === null || typeof event.data !== 'object')
            continue;
        if (event.type === 'user/message')
            messages.push(event.data);
        else if (event.type === 'assistant/message')
            messages.push(event.data.message);
    }
    return messages;
}
/** Keep the user's and the assistant's messages, numbered from the oldest. */
function toEntries(messages) {
    if (!Array.isArray(messages))
        return [];
    const entries = [];
    for (const message of messages) {
        const speaker = speakerOf(message);
        if (speaker === null)
            continue;
        const text = textOf(message);
        if (text === '')
            continue;
        entries.push({ index: entries.length + 1, speaker, text: escapeClosingTag(text) });
    }
    return entries;
}
function runCall(entries, call) {
    const args = argsOf(call.arguments);
    if (call.name === SEARCH_TOOL)
        return search(entries, typeof args.query === 'string' ? args.query : '');
    if (call.name === READ_TOOL)
        return read(entries, args.from, args.count);
    return 'Unknown tool. Available: ' + SEARCH_TOOL + ', ' + READ_TOOL + '.';
}
/**
 * Literal, case-insensitive search. Messages matching more of the query's words rank
 * first, newer before older; whitespace splits words, so a phrase without spaces (as in
 * Chinese) is matched as a whole.
 */
function search(entries, query) {
    const terms = query.toLowerCase().split(/\s+/u).filter((term) => term !== '');
    if (terms.length === 0)
        return 'Empty query.';
    const hits = entries
        .map((entry) => {
        const lower = entry.text.toLowerCase();
        const positions = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0);
        return { entry, score: positions.length, at: positions.length > 0 ? Math.min(...positions) : -1 };
    })
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || b.entry.index - a.entry.index)
        .slice(0, SEARCH_LIMIT);
    if (hits.length === 0)
        return 'No earlier message matches.';
    return hits.map((hit) => label(hit.entry) + ': ' + snippet(hit.entry.text, hit.at)).join('\n');
}
function read(entries, from, count) {
    if (typeof from !== 'number' || !Number.isInteger(from) || from < 1 || from > entries.length) {
        return entries.length === 0 ? 'This conversation has no earlier messages.' : 'No such message; messages are #1 to #' + String(entries.length) + '.';
    }
    const wanted = typeof count === 'number' && Number.isInteger(count) ? Math.min(Math.max(count, 1), READ_MAX_MESSAGES) : 1;
    return entries.slice(from - 1, from - 1 + wanted)
        .map((entry) => label(entry) + ':\n' + clip(entry.text, READ_MESSAGE_CHARS))
        .join('\n\n');
}
function label(entry) {
    return '#' + String(entry.index) + ' ' + entry.speaker;
}
function snippet(text, at) {
    const start = Math.max(0, at - SNIPPET_CHARS / 2);
    const piece = text.slice(start, start + SNIPPET_CHARS).replace(/\s+/gu, ' ').trim();
    return (start > 0 ? '…' : '') + piece + (start + SNIPPET_CHARS < text.length ? '…' : '');
}
function clip(text, limit) {
    return text.length <= limit ? text : text.slice(0, limit) + '\n… (truncated)';
}
//# sourceMappingURL=session-lookup.js.map