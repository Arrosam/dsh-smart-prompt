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
 * Assemble the system prompt for one call.
 *
 * @param mode - active mode.
 * @param config - resolved configuration.
 * @returns the system prompt text.
 */
export declare function buildSystemPrompt(mode: Mode, config: ResolvedConfig): string;
/**
 * Frame the call's user message: optional context block, then the draft inside
 * `<raw_prompt>` tags so user text is never mistaken for an instruction.
 *
 * @param draft - the user's raw draft.
 * @param contextBlock - rendered history block, or ''.
 * @param extraClause - a repair instruction, or ''.
 * @returns the user message body.
 */
export declare function buildUserMessage(draft: string, contextBlock: string, extraClause: string): string;
