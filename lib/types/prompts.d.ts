/**
 * External prompt loading: behaviour lives in `prompts/*.md`, not in code, so a
 * user can retune the plugin without touching TypeScript.
 *
 * Resolution order per file: `$DSH_HOME/dsh-smart-prompt/prompts/<name>.md`
 * (user override) then the packaged `prompts/<name>.md`.
 *
 * @module dsh-smart-prompt/prompts
 */
import { type Mode, type ResolvedConfig } from './config.js';
/** Where a user may drop their own prompt overrides. */
export declare function userPromptDir(): string;
/** The always-loaded discipline layer. */
export declare function disciplinePrompt(): string;
/** One mode's template. */
export declare function modePrompt(mode: Mode): string;
/**
 * The instruction that lets the first call list missing information.
 *
 * @param maxQuestions - most questions the model may ask.
 * @returns the prompt text.
 */
export declare function questionsPrompt(maxQuestions: number): string;
/** The instruction for the rewrite that folds the user's answers in. */
export declare function answersPrompt(): string;
/**
 * Assemble the system prompt for one call.
 *
 * @param mode - active mode.
 * @param config - resolved configuration.
 * @param extra - further instructions appended last (follow-up questions or answers).
 * @returns the system prompt text.
 */
export declare function buildSystemPrompt(mode: Mode, config: ResolvedConfig, extra?: readonly string[]): string;
/** Neutralize a literal frame tag so user text cannot break out of its frame. */
export declare function escapeClosingTag(text: string): string;
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
export declare function buildUserMessage(draft: string, contextBlock: string, extraClause: string, answersBlock?: string): string;
