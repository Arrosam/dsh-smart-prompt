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
    // Built output lives in <plugin>/lib/, sources in <plugin>/src/.
    const pluginRoot = base.endsWith(join('', 'lib')) || base.endsWith('lib') ? dirname(base) : dirname(base);
    return join(pluginRoot, 'prompts');
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
    light: 'Mode: light. Clean up filler, typos and redundancy. Do not restructure. At most ~1.2x the draft.',
    standard: 'Mode: standard. Restate the request so an agent can execute it: deliverable, constraints, steps, format. Add nothing new. At most ~2.5x the draft.',
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
/**
 * The instruction that lets the first call list missing information.
 *
 * @param maxQuestions - most questions the model may ask.
 * @returns the prompt text.
 */
export function questionsPrompt(maxQuestions) {
    return readPrompt('questions', FALLBACK_QUESTIONS).split(MAX_QUESTIONS_TOKEN).join(String(maxQuestions));
}
/** The instruction for the rewrite that folds the user's answers in. */
export function answersPrompt() {
    return readPrompt('answers', FALLBACK_ANSWERS);
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
/** Neutralize a literal frame tag so user text cannot break out of its frame. */
export function escapeClosingTag(text) {
    return text.replace(/<\/?(raw_prompt|conversation_context|user_answers)>/gi, '<\\/$1>');
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
//# sourceMappingURL=prompts.js.map