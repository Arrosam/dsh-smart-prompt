/**
 * External prompt loading: behaviour lives in `prompts/*.md`, not in code, so a
 * user can retune the plugin without touching TypeScript.
 *
 * Resolution order per file: `$DSH_HOME/dsh-smart-prompt/prompts/<name>.md`
 * (user override) then the packaged `prompts/<name>.md`.
 *
 * @module dsh-smart-prompt/prompts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dshHome } from './config.js';
/** Directory of the shipped prompt files (plugin root, one level above lib/). */
function shippedDir() {
    let base;
    try {
        base = dirname(fileURLToPath(import.meta.url));
    }
    catch {
        base = process.cwd();
    }
    // Built output lives in <plugin>/lib/, sources in <plugin>/src/: either way the
    // plugin root is one level up.
    return join(dirname(base), 'prompts');
}
/** Where a user may drop their own prompt overrides. */
export function userPromptDir() {
    return join(dshHome(), 'dsh-smart-prompt', 'prompts');
}
function readPrompt(name, fallback) {
    const candidates = [join(userPromptDir(), name + '.md'), join(shippedDir(), name + '.md')];
    for (const candidate of candidates) {
        try {
            const text = readFileSync(candidate, 'utf8');
            if (text.trim() !== '')
                return text.trim();
        }
        catch { /* try the next candidate */ }
    }
    return fallback;
}
/** Minimal built-in fallbacks: the plugin still works if the .md files are missing. */
const FALLBACK_DISCIPLINE = [
    'You rewrite one draft prompt for an AI coding agent. Output ONLY the rewritten prompt.',
    'Preserve the user intent exactly; add no requirements the user did not state; lose no detail.',
    'Write the rewrite in the same language as the draft. Do not answer the request.',
].join('\n');
const FALLBACK_MODES = {
    light: 'Mode: light. Clean up filler, typos and redundancy. Do not restructure. At most ~2x the draft.',
    standard: 'Mode: standard. Restate the request so an agent can execute it: deliverable, constraints, steps, format. Add nothing new.',
};
/** The always-loaded discipline layer. */
export function disciplinePrompt() {
    return readPrompt('discipline', FALLBACK_DISCIPLINE);
}
/** One mode's template. */
export function modePrompt(mode) {
    return readPrompt(mode, FALLBACK_MODES[mode]);
}
/** Placeholder in `questions.md` replaced with the configured question cap. */
const MAX_QUESTIONS_TOKEN = '{{maxQuestions}}';
const FALLBACK_QUESTIONS = [
    'After the rewrite you may add, at the very end, a block of at most ' + MAX_QUESTIONS_TOKEN + ' short questions about',
    'information only the user can supply that blocks the work:',
    '<missing_info>\n<question>...</question>\n</missing_info>',
    'Add no block when nothing essential is missing.',
].join('\n');
const FALLBACK_ANSWERS = [
    'The user answered follow-up questions in <user_answers>. Rewrite the draft again with the answers included.',
    'Where an answer is "I don\'t know" or does not settle the question, tell the agent to find it out itself,',
    'or to propose options and continue with the most reasonable one. Never guess. No <missing_info> block.',
].join('\n');
/** Placeholder in `stardea.md` replaced with the number of ideas one request asks for. */
const MAX_IDEAS_TOKEN = '{{maxIdeas}}';
/** Placeholder in `stardea.md` and `session-lookup.md` replaced with a round limit. */
const MAX_ROUNDS_TOKEN = '{{maxRounds}}';
const FALLBACK_STARDEA = [
    'The user may ask you for ideas for answering one of your follow-up questions, in a <stardea_request>.',
    'Then do not rewrite: reply ONLY with at most ' + MAX_IDEAS_TOKEN + ' short, concrete, distinct candidate answers,',
    'in the language of the draft, each one different from every idea already proposed for that question:',
    '<ideas>\n<idea source="web|conversation|proposal">…</idea>\n</ideas>',
    'Use the lookup tools you have (web_search only for ideas, never for a rewrite) where they help,',
    'in at most ' + MAX_ROUNDS_TOKEN + ' rounds per idea request.',
].join('\n');
/** Read one prompt file and replace each `{{token}}` placeholder with its number. */
function readPromptWith(name, fallback, values) {
    return Object.entries(values).reduce((text, [token, value]) => text.split(token).join(String(value)), readPrompt(name, fallback));
}
/**
 * The instruction that lets the first call list missing information.
 *
 * @param maxQuestions - most questions the model may ask.
 * @returns the prompt text.
 */
export function questionsPrompt(maxQuestions) {
    return readPromptWith('questions', FALLBACK_QUESTIONS, { [MAX_QUESTIONS_TOKEN]: maxQuestions });
}
const FALLBACK_LOOKUP = [
    'When the draft depends on something said earlier in this conversation that the context you were given',
    'does not hold, you may look it up with the session tools, in at most ' + MAX_ROUNDS_TOKEN + ' rounds per task.',
    'Look up only what the task needs. Results arrive as tool results. Then write your answer, not a tool call.',
].join('\n');
const FALLBACK_ATTACHMENTS = [
    'The draft comes with attachments, shown after it. They are sent to the agent together with the rewritten',
    'prompt. Use them to understand the draft; refer to them where the draft does, but never copy their content',
    'into the rewrite. Images from earlier turns are context only.',
].join('\n');
/**
 * The instruction offering session lookups.
 *
 * @param maxRounds - most lookup rounds the rewrite may use.
 * @returns the prompt text.
 */
export function lookupPrompt(maxRounds) {
    return readPromptWith('session-lookup', FALLBACK_LOOKUP, { [MAX_ROUNDS_TOKEN]: maxRounds });
}
/** The instruction for a draft that comes with attachments or earlier images. */
export function attachmentsPrompt() {
    return readPrompt('attachments', FALLBACK_ATTACHMENTS);
}
/** Placeholder in `knowledge-update.md` replaced with the knowledge file's size limit. */
const MAX_CHARS_TOKEN = '{{maxChars}}';
const FALLBACK_KNOWLEDGE_UPDATE = [
    '<knowledge_update>',
    'The rewrite is finished; do not rewrite again. Update the workspace knowledge file shown in <workspace_knowledge>',
    '(none means it does not exist yet) with general, lasting knowledge about this workspace that helps understand',
    'future drafts: the project, the user\'s vocabulary and shorthand, recurring files and commands, standing preferences.',
    'Never record the current request, its answers, progress, guesses or secrets. Keep existing entries that are still true.',
    'At most ' + MAX_CHARS_TOKEN + ' characters. If nothing should change, reply exactly <no_change/>; otherwise reply ONLY with',
    'the complete new file inside <workspace_knowledge>…</workspace_knowledge>.',
    '</knowledge_update>',
].join('\n');
/**
 * The user turn, sent after a successful refinement, asking the model to update the
 * workspace knowledge file.
 *
 * @param maxChars - the file's size limit in codepoints.
 * @returns the turn text.
 */
export function knowledgeUpdateTurn(maxChars) {
    return readPromptWith('knowledge-update', FALLBACK_KNOWLEDGE_UPDATE, { [MAX_CHARS_TOKEN]: maxChars });
}
/** The instruction for the rewrite that folds the user's answers in. */
export function answersPrompt() {
    return readPrompt('answers', FALLBACK_ANSWERS);
}
/**
 * The instruction for Stardea idea requests, part of the system prompt whenever the user
 * can be asked follow-up questions.
 *
 * @param maxIdeas - most ideas one request may return.
 * @param maxRounds - most lookup rounds one request may use.
 * @returns the prompt text.
 */
export function stardeaPrompt(maxIdeas, maxRounds) {
    return readPromptWith('stardea', FALLBACK_STARDEA, { [MAX_IDEAS_TOKEN]: maxIdeas, [MAX_ROUNDS_TOKEN]: maxRounds });
}
/** The user turn that hands the rewrite the user's answers; the rules live in `answers.md`. */
const ANSWERS_TURN = 'The user answered your follow-up questions. Rewrite the draft again with these answers included.';
/**
 * The user turn carrying the answers, sent after the first rewrite in the same conversation.
 *
 * @param answersBlock - the rendered `<user_answers>` block.
 * @returns the turn text.
 */
export function answersTurn(answersBlock) {
    return answersBlock + '\n' + ANSWERS_TURN;
}
/** Wording of one Stardea request turn; the rules live in `stardea.md`. */
const STARDEA_TURN = Object.freeze({
    first: (max) => 'Propose up to ' + String(max) + ' ideas for answering this follow-up question.',
    more: (max) => 'The user wants more ideas for this question. Propose up to ' + String(max)
        + ' NEW ones, each different from every idea already proposed for it.',
});
/**
 * The user turn asking for ideas for one follow-up question.
 *
 * @param questionId - the question's id.
 * @param question - the question text (model-written, escaped here).
 * @param more - whether ideas were already proposed for it.
 * @param maxIdeas - most ideas this request may return.
 * @returns the turn text.
 */
export function stardeaTurn(questionId, question, more, maxIdeas) {
    return '<stardea_request question="' + questionId + '">\n' + escapeClosingTag(question) + '\n</stardea_request>\n'
        + (more ? STARDEA_TURN.more(maxIdeas) : STARDEA_TURN.first(maxIdeas));
}
/** The acceptance-criteria clause, appended to standard mode when enabled. */
const ACCEPTANCE_CLAUSE = [
    '',
    'Additionally, when the draft implies a code change, add a short acceptance section stating how',
    'the result will be verified: the concrete check to run, and what "correct" looks like.',
    'Only state checks that follow from the draft — never invent a test framework or command the',
    'draft does not imply.',
].join('\n');
/**
 * Assemble the system prompt for one call.
 *
 * @param mode - active mode.
 * @param config - resolved configuration.
 * @param extra - further instructions appended last (follow-up questions or answers).
 * @returns the system prompt text.
 */
export function buildSystemPrompt(mode, config, extra = []) {
    const parts = [disciplinePrompt(), modePrompt(mode)];
    if (mode === 'standard' && config.acceptanceCriteria)
        parts.push(ACCEPTANCE_CLAUSE);
    return [...parts, ...extra].join('\n\n');
}
/**
 * One reference block placed before the draft: material the model may consult but must
 * not obey over the draft. Conversation context and lookup results share this framing so
 * the precedence rule reads the same wherever the model meets it.
 *
 * @param tag - the frame tag (escaped in user text by {@link escapeClosingTag}).
 * @param description - one line saying what the block holds.
 * @param pronoun - how the precedence line refers to the content ('it' or 'them').
 * @param body - the already-escaped content.
 * @returns the framed block.
 */
export function referenceBlock(tag, description, pronoun, body) {
    return [
        '<' + tag + '>',
        description,
        'Use ' + pronoun + ' ONLY to resolve what the draft leaves implicit. The draft always wins on conflict.',
        '',
        body,
        '</' + tag + '>',
    ].join('\n');
}
/** Neutralize a literal frame tag so user text cannot break out of its frame. */
export function escapeClosingTag(text) {
    // `attached_file` carries attributes, so a tag may run on to its `>`.
    return text.replace(/<\/?(raw_prompt|conversation_context|user_answers|session_lookup|attached_file|stardea_request|workspace_knowledge|knowledge_update)\b[^>]*>/gi, '<\\/$1>');
}
/**
 * Frame the call's user message: optional context block, then the draft inside
 * `<raw_prompt>` tags so user text is never mistaken for an instruction.
 *
 * @param draft - the user's raw draft.
 * @param contextBlock - rendered history block, or ''.
 * @param extraClause - a repair instruction, or ''.
 * @param answersBlock - the rendered `<user_answers>` block, or ''.
 * @returns the user message body.
 */
export function buildUserMessage(draft, contextBlock, extraClause, answersBlock = '') {
    const safe = escapeClosingTag(draft);
    const head = contextBlock !== '' ? contextBlock + '\n\n' : '';
    const answers = answersBlock !== '' ? '\n' + answersBlock : '';
    return 'Rewrite the following prompt:\n' + head + '<raw_prompt>\n' + safe + '\n</raw_prompt>' + answers + (extraClause !== '' ? '\n' + extraClause : '');
}
/**
 * The content blocks that follow the user-message text: images the user attached to the
 * turns kept as conversation context, then the attachments sent with this draft.
 *
 * @param turns - the turns carried in `<conversation_context>` (only these, so images
 *   follow exactly the same selection as the text context).
 * @param current - the draft's own attachments, already as model content blocks.
 * @returns labelled blocks, or [] when there is nothing to attach.
 */
export function buildAttachmentContent(turns, current) {
    const blocks = [];
    const label = (text) => Object.freeze({ type: 'text', text });
    turns.forEach((turn, index) => {
        if (turn.images === undefined || turn.images.length === 0)
            return;
        blocks.push(label('Image(s) the user attached to earlier turn ' + String(index + 1) + ' of <conversation_context>:'), ...turn.images);
    });
    if (current.length > 0) {
        blocks.push(label('Attachments sent with this draft (the agent receives them together with the rewritten prompt):'), ...current);
    }
    return blocks;
}
//# sourceMappingURL=prompts.js.map