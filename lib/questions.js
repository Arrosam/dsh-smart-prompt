/**
 * Follow-up questions about missing information.
 *
 * The first rewrite call may end with a `<missing_info>` block listing what the draft
 * lacks (see `prompts/questions.md`). The orchestrator asks those questions in the plugin's
 * own follow-up panel, then rewrites once more with the answers. Kept pure: parsing and
 * formatting only, no host access.
 *
 * @module dsh-smart-prompt/questions
 */
import { escapeClosingTag } from './prompts.js';
/** Tag wrapping the model's list of missing information. */
const BLOCK_RE = /<missing_info>([\s\S]*?)<\/missing_info>/gi;
/** One question inside the block. */
const QUESTION_RE = /<question>([\s\S]*?)<\/question>/gi;
/** Prefix of the question ids sent to the ask-user seam (`q1`, `q2`, …). */
const QUESTION_ID_PREFIX = 'q';
/**
 * Split a model reply into the rewrite and its follow-up questions.
 *
 * Every block is removed from the text, so a block the model emits where none was
 * asked for never reaches the composer.
 *
 * @param raw - the model reply.
 * @param max - most questions to keep.
 * @returns the rewrite text and the questions.
 */
export function parseRewrite(raw, max) {
    const questions = [];
    for (const block of raw.matchAll(BLOCK_RE)) {
        for (const item of (block[1] ?? '').matchAll(QUESTION_RE)) {
            const question = (item[1] ?? '').trim();
            if (question !== '')
                questions.push(question);
        }
    }
    return { text: raw.replace(BLOCK_RE, '').trim(), questions: questions.slice(0, Math.max(0, max)) };
}
/** Id of the question at one position. */
export function questionId(index) {
    return QUESTION_ID_PREFIX + String(index + 1);
}
/** Marker of one part of an answer made of several parts. */
const PART_BULLET = '- ';
/**
 * Pair the asked questions with the user's answers, dropping skipped ones.
 *
 * An answer may combine ideas the user picked with their own words (Stardea): every part is
 * kept, picked ideas first. One part is used as it is; several are listed one per line.
 *
 * @param questions - questions in ask order.
 * @param answer - the answer UI's reply.
 * @returns the answered questions, in ask order.
 */
export function answeredQuestions(questions, answer) {
    const out = [];
    questions.forEach((question, index) => {
        const item = answer.answers?.find((entry) => entry.id === questionId(index));
        if (item === undefined)
            return;
        const custom = typeof item.custom === 'string' ? item.custom.trim() : '';
        const selected = Array.isArray(item.selected) ? item.selected.filter((s) => typeof s === 'string' && s.trim() !== '').map((s) => s.trim()) : [];
        const parts = custom !== '' ? [...selected, custom] : selected;
        if (parts.length === 0)
            return;
        out.push({ question, answer: parts.length === 1 ? parts[0] : parts.map((part) => PART_BULLET + part).join('\n') });
    });
    return out;
}
/**
 * Render the answers for the rewrite call's user message.
 *
 * @param answered - answered questions.
 * @returns the `<user_answers>` block, or '' when there are none.
 */
export function formatAnswers(answered) {
    if (answered.length === 0)
        return '';
    // The answers are user text inside a frame: they must not be able to close it. An answer
    // made of several parts is a list, which starts on its own line.
    const lines = answered.map((a) => 'Q: ' + escapeClosingTag(a.question) + '\nA:' + (a.answer.includes('\n') ? '\n' : ' ') + escapeClosingTag(a.answer));
    return '<user_answers>\n' + lines.join('\n\n') + '\n</user_answers>';
}
//# sourceMappingURL=questions.js.map