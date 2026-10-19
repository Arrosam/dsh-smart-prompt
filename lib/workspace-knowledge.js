/**
 * Workspace knowledge: one Markdown file at the workspace root that the refinement model
 * reads at the start of every refinement and keeps up to date after a successful one.
 *
 * The file holds what helps the model understand FUTURE drafts in the same workspace (the
 * project's vocabulary, the things the user keeps referring to, standing preferences), not
 * the current task: the criteria live in `prompts/knowledge-update.md`.
 *
 * @module dsh-smart-prompt/workspace-knowledge
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { charLength } from './length-gate.js';
import { escapeClosingTag, referenceBlock } from './prompts.js';
/** File name at the workspace root. Named after the plugin so its owner is obvious to a reader. */
export const KNOWLEDGE_FILE = 'SMART-PROMPT.md';
/** Frame of the knowledge in the first user message, and of the model's updated version. */
export const KNOWLEDGE_TAG = 'workspace_knowledge';
const KNOWLEDGE_DESCRIPTION = 'What earlier refinements learned about this workspace (file ' + KNOWLEDGE_FILE + ').';
/**
 * The knowledge file of one workspace root.
 *
 * Concurrent refinements in one workspace each write their own complete version; the last
 * one wins. Accepted because the file is a small, regenerable summary, not a log.
 *
 * @param root - absolute workspace root directory.
 */
export function fileKnowledgeStore(root) {
    const path = join(root, KNOWLEDGE_FILE);
    return {
        read: async () => {
            try {
                return await readFile(path, 'utf8');
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return '';
                throw error;
            }
        },
        write: (text) => writeFile(path, text, 'utf8'),
    };
}
/**
 * Read the knowledge for one refinement. Knowledge only informs the rewrite, so an
 * unreadable file degrades to none rather than failing the refinement.
 *
 * @param store - the workspace's store.
 * @param maxChars - the size limit in codepoints.
 */
export async function loadKnowledge(store, maxChars) {
    let text;
    try {
        text = (await store.read()).trim();
    }
    catch {
        return { text: '', complete: false };
    }
    if (charLength(text) <= maxChars)
        return { text, complete: true };
    return { text: Array.from(text).slice(0, maxChars).join(''), complete: false };
}
/**
 * The knowledge as a reference block placed first in the first user message, the way
 * workspace instructions come first in an agent's conversation.
 *
 * @returns the block, or '' when there is no knowledge.
 */
export function knowledgeBlock(text) {
    return text === '' ? '' : referenceBlock(KNOWLEDGE_TAG, KNOWLEDGE_DESCRIPTION, 'it', escapeClosingTag(text));
}
const UPDATE_PATTERN = new RegExp('<' + KNOWLEDGE_TAG + '>([\\s\\S]*?)</' + KNOWLEDGE_TAG + '>');
/**
 * The new file text from the model's update reply.
 *
 * @param reply - the model's reply to the update turn.
 * @param current - the knowledge the model saw.
 * @param maxChars - the size limit in codepoints.
 * @returns the text to write (newline-terminated), or null when nothing should be written:
 *   no new version, an empty or unchanged one, or one over the limit.
 */
export function parseKnowledgeUpdate(reply, current, maxChars) {
    const next = UPDATE_PATTERN.exec(reply)?.[1]?.trim() ?? '';
    if (next === '' || next === current.trim() || charLength(next) > maxChars)
        return null;
    return next + '\n';
}
//# sourceMappingURL=workspace-knowledge.js.map