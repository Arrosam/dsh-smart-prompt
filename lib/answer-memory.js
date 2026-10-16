/**
 * Follow-up answers kept across a failed refinement, so a retry does not ask again.
 *
 * Answering the question card is the costly part of a refinement for the user; a
 * later failure (timeout, upstream error, length refusal, cancel) used to throw those
 * answers away. The orchestrator records them here once given and drops them when a
 * refinement for that session succeeds.
 *
 * @module dsh-smart-prompt/answer-memory
 */
/** Sessions kept at once; the oldest is dropped beyond this, bounding a long-lived host. */
const MAX_SESSIONS = 50;
/**
 * Per-session memo keyed by the exact draft body it answers.
 *
 * One entry per session: only the latest draft can be retried from the composer, and
 * answers to an earlier, different draft do not apply to a new one.
 */
export class AnswerMemory {
    entries = new Map();
    /** Answers given for exactly this draft in this session, if any. */
    recall(sessionId, draft) {
        const entry = this.entries.get(sessionId);
        return entry !== undefined && entry.draft === draft ? entry.memo : undefined;
    }
    /** Record answers for this draft, replacing the session's previous entry. */
    remember(sessionId, draft, memo) {
        this.entries.delete(sessionId);
        this.entries.set(sessionId, { draft, memo });
        if (this.entries.size > MAX_SESSIONS) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined)
                this.entries.delete(oldest);
        }
    }
    /** Drop the session's answers (after a successful refinement). */
    forget(sessionId) {
        this.entries.delete(sessionId);
    }
}
//# sourceMappingURL=answer-memory.js.map