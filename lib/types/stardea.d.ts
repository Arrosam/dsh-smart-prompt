/**
 * Stardea (星念): ideas for answering a follow-up question.
 *
 * The user may ask for ideas on any question the refinement asked. The model answers in
 * the refinement's own conversation with an `<ideas>` block (see `prompts/stardea.md`);
 * this module parses it and keeps every idea proposed so far, so a later request for the
 * same question returns only ideas that are new. Kept pure: parsing and bookkeeping only.
 *
 * @module dsh-smart-prompt/stardea
 */
/** Where an idea came from, as the model declared it. */
export declare const IDEA_SOURCES: readonly ["web", "conversation", "proposal"];
export type IdeaSource = typeof IDEA_SOURCES[number];
/** One idea offered to the user. */
export interface Idea {
    readonly id: string;
    readonly text: string;
    readonly source: IdeaSource;
}
/** What a Stardea request returns: the new ideas, or why there are none. */
export type StardeaOutcome = {
    readonly ok: true;
    readonly ideas: readonly Idea[];
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};
/** Asks for ideas for one question; `signal` cancels this request only. */
export type Stardea = (questionId: string, signal: AbortSignal) => Promise<StardeaOutcome>;
/** One parsed idea, before it is given an id. */
export interface ParsedIdea {
    readonly text: string;
    readonly source: IdeaSource;
}
/**
 * Read the ideas out of a model reply.
 *
 * @param raw - the model reply.
 * @returns the non-empty ideas in reply order; [] when the reply holds no `<ideas>` block.
 */
export declare function parseIdeas(raw: string): ParsedIdea[];
/** Every idea proposed in one refinement, per question. */
export declare class IdeaBook {
    private readonly byQuestion;
    /** Whether ideas were already proposed for a question. */
    has(questionId: string): boolean;
    /**
     * Keep the ideas that are new for a question, up to `max`.
     *
     * @param questionId - the question the ideas answer.
     * @param parsed - ideas read from one reply.
     * @param max - most ideas to keep from this reply.
     * @returns the new ideas with their ids, possibly none.
     */
    add(questionId: string, parsed: readonly ParsedIdea[], max: number): Idea[];
}
