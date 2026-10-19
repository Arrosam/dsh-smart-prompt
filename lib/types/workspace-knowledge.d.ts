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
/** File name at the workspace root. Named after the plugin so its owner is obvious to a reader. */
export declare const KNOWLEDGE_FILE = "SMART-PROMPT.md";
/** Frame of the knowledge in the first user message, and of the model's updated version. */
export declare const KNOWLEDGE_TAG = "workspace_knowledge";
/** Where one workspace's knowledge is kept. */
export interface KnowledgeStore {
    /** The file's text; '' when it does not exist yet. Rejects on any other read failure. */
    read(): Promise<string>;
    /** Replace the file's text, creating it when missing. */
    write(text: string): Promise<void>;
}
/**
 * The knowledge file of one workspace root.
 *
 * Concurrent refinements in one workspace each write their own complete version; the last
 * one wins. Accepted because the file is a small, regenerable summary, not a log.
 *
 * @param root - absolute workspace root directory.
 */
export declare function fileKnowledgeStore(root: string): KnowledgeStore;
/** The knowledge as read for one refinement. */
export interface LoadedKnowledge {
    /** The text shown to the model (trimmed, at most the size limit). */
    readonly text: string;
    /**
     * Whether the model saw the whole file. A clipped file is never rewritten: the update
     * would silently drop the part the model did not see.
     */
    readonly complete: boolean;
}
/**
 * Read the knowledge for one refinement. Knowledge only informs the rewrite, so an
 * unreadable file degrades to none rather than failing the refinement.
 *
 * @param store - the workspace's store.
 * @param maxChars - the size limit in codepoints.
 */
export declare function loadKnowledge(store: KnowledgeStore, maxChars: number): Promise<LoadedKnowledge>;
/**
 * The knowledge as a reference block placed first in the first user message, the way
 * workspace instructions come first in an agent's conversation.
 *
 * @returns the block, or '' when there is no knowledge.
 */
export declare function knowledgeBlock(text: string): string;
/**
 * The new file text from the model's update reply.
 *
 * @param reply - the model's reply to the update turn.
 * @param current - the knowledge the model saw.
 * @param maxChars - the size limit in codepoints.
 * @returns the text to write (newline-terminated), or null when nothing should be written:
 *   no new version, an empty or unchanged one, or one over the limit.
 */
export declare function parseKnowledgeUpdate(reply: string, current: string, maxChars: number): string | null;
