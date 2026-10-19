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
import type { HistoryTurn } from './history.js';
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
/**
 * The instruction offering session lookups.
 *
 * @param maxRounds - most lookup rounds the rewrite may use.
 * @returns the prompt text.
 */
export declare function lookupPrompt(maxRounds: number): string;
/** The instruction for a draft that comes with attachments or earlier images. */
export declare function attachmentsPrompt(): string;
/**
 * The user turn, sent after a successful refinement, asking the model to update the
 * workspace knowledge file.
 *
 * @param maxChars - the file's size limit in codepoints.
 * @returns the turn text.
 */
export declare function knowledgeUpdateTurn(maxChars: number): string;
/** The instruction for the rewrite that folds the user's answers in. */
export declare function answersPrompt(): string;
/**
 * The instruction for Stardea idea requests, part of the system prompt whenever the user
 * can be asked follow-up questions.
 *
 * @param maxIdeas - most ideas one request may return.
 * @param maxRounds - most lookup rounds one request may use.
 * @returns the prompt text.
 */
export declare function stardeaPrompt(maxIdeas: number, maxRounds: number): string;
/**
 * The user turn carrying the answers, sent after the first rewrite in the same conversation.
 *
 * @param answersBlock - the rendered `<user_answers>` block.
 * @returns the turn text.
 */
export declare function answersTurn(answersBlock: string): string;
/**
 * The user turn asking for ideas for one follow-up question.
 *
 * @param questionId - the question's id.
 * @param question - the question text (model-written, escaped here).
 * @param more - whether ideas were already proposed for it.
 * @param maxIdeas - most ideas this request may return.
 * @returns the turn text.
 */
export declare function stardeaTurn(questionId: string, question: string, more: boolean, maxIdeas: number): string;
/**
 * Assemble the system prompt for one call.
 *
 * @param mode - active mode.
 * @param config - resolved configuration.
 * @param extra - further instructions appended last (follow-up questions or answers).
 * @returns the system prompt text.
 */
export declare function buildSystemPrompt(mode: Mode, config: ResolvedConfig, extra?: readonly string[]): string;
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
export declare function referenceBlock(tag: string, description: string, pronoun: 'it' | 'them', body: string): string;
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
/** One model-request content block (text, image, or file reference). */
type ContentBlock = unknown;
/**
 * The content blocks that follow the user-message text: images the user attached to the
 * turns kept as conversation context, then the attachments sent with this draft.
 *
 * @param turns - the turns carried in `<conversation_context>` (only these, so images
 *   follow exactly the same selection as the text context).
 * @param current - the draft's own attachments, already as model content blocks.
 * @returns labelled blocks, or [] when there is nothing to attach.
 */
export declare function buildAttachmentContent(turns: readonly HistoryTurn[], current: readonly ContentBlock[]): ContentBlock[];
export {};
