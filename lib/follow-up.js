/**
 * Refinements waiting for the user's answers to their follow-up questions.
 *
 * A refinement that asks questions spans several HTTP requests: `/improve` starts it and
 * returns the questions, `/stardea` asks for ideas while they are open, and `/answer`
 * hands over the answers and returns the final result (`/cancel` ends it instead). The
 * refinement itself keeps running in between, awaiting the answers, so its conversation
 * (refine-chat.ts) and everything it looked up stay in memory for the later requests.
 *
 * Kept free of HTTP: index.ts maps requests onto these calls.
 *
 * @module dsh-smart-prompt/follow-up
 */
import { randomUUID } from 'node:crypto';
import { ERR } from './orchestrate.js';
import { errorMessage } from './values.js';
/** Copy of the outcomes the desk produces itself. */
const MESSAGE = Object.freeze({
    noRun: 'no open refinement with this id',
    dismissed: 'the follow-up questions were dismissed',
});
/** A request naming no open refinement. */
export const NO_RUN = Object.freeze({ ok: false, code: ERR.NO_RUN, message: MESSAGE.noRun });
/** A promise with its resolver (the project targets ES2023, before `Promise.withResolvers`). */
function deferred() {
    let resolve;
    const promise = new Promise((settle) => { resolve = settle; });
    return { promise, resolve };
}
/** Hands each exchange of one refinement to whichever request waits for it next. */
class Relay {
    waiter = deferred();
    /** The next exchange. */
    next() {
        return this.waiter.promise;
    }
    /** Deliver one exchange; a later {@link next} waits for the one after it. */
    emit(exchange) {
        const waiter = this.waiter;
        this.waiter = deferred();
        waiter.resolve(exchange);
    }
}
/** Every refinement of this plugin instance whose questions are open. */
export class FollowUpDesk {
    runs = new Map();
    /**
     * Start a refinement.
     *
     * At most one refinement per session waits for answers: the session's composer shows one
     * panel, so a new start (e.g. after a page reload lost the panel) cancels the old one.
     * Open runs are otherwise kept until they are answered or cancelled.
     *
     * @param sessionId - the session it refines for.
     * @param signal - the starting request; it cancels the refinement until the questions are out.
     * @param refine - the refinement.
     * @returns the questions, or the outcome when it asked none.
     */
    start(sessionId, signal, refine) {
        this.cancelSession(sessionId);
        const controller = new AbortController();
        const relay = new Relay();
        let runId;
        const release = follow(signal, controller);
        const ask = (questions, _signal, stardea) => new Promise((resolve, reject) => {
            // The starting request has its reply now; only /answer or /cancel may end the refinement.
            release();
            runId = randomUUID();
            this.runs.set(runId, {
                sessionId, relay, stardea, controller,
                answer: resolve,
                dismiss: () => { reject(new Error(MESSAGE.dismissed)); },
            });
            relay.emit({ kind: 'ask', runId, questions });
        });
        const first = relay.next();
        void refine(ask, controller.signal)
            .catch((error) => ({ ok: false, code: ERR.UNKNOWN, message: errorMessage(error) }))
            .then((outcome) => {
            release();
            if (runId !== undefined)
                this.runs.delete(runId);
            relay.emit({ kind: 'done', outcome });
        });
        return first;
    }
    /**
     * Ask for ideas for one open question.
     *
     * @param runId - the refinement.
     * @param questionId - the question.
     * @param signal - cancels this request only.
     */
    stardea(runId, questionId, signal) {
        const run = this.runs.get(runId);
        return run !== undefined ? run.stardea(questionId, signal) : Promise.resolve(NO_RUN);
    }
    /**
     * Hand over the answers.
     *
     * @param runId - the refinement.
     * @param reply - the answers; an empty batch skips every question.
     * @param signal - the answering request; it cancels the refinement while it waits.
     * @returns the final outcome, or undefined when no such refinement is open.
     */
    answer(runId, reply, signal) {
        const run = this.runs.get(runId);
        if (run === undefined)
            return undefined;
        this.runs.delete(runId);
        const next = run.relay.next();
        const release = follow(signal, run.controller);
        void next.then(release);
        run.answer(reply);
        return next;
    }
    /**
     * End a refinement whose questions are open; it finishes as cancelled.
     *
     * @returns whether one was open.
     */
    cancel(runId) {
        const run = this.runs.get(runId);
        if (run === undefined)
            return false;
        this.runs.delete(runId);
        run.controller.abort();
        run.dismiss();
        return true;
    }
    /** End every open refinement (plugin teardown). */
    dispose() {
        for (const runId of [...this.runs.keys()])
            this.cancel(runId);
    }
    cancelSession(sessionId) {
        for (const [runId, run] of [...this.runs])
            if (run.sessionId === sessionId)
                this.cancel(runId);
    }
}
/**
 * Let a request's signal cancel a refinement until released.
 *
 * @returns the release function (idempotent).
 */
function follow(signal, controller) {
    const onAbort = () => { controller.abort(); };
    if (signal.aborted)
        controller.abort();
    else
        signal.addEventListener('abort', onAbort, { once: true });
    return () => { signal.removeEventListener('abort', onAbort); };
}
//# sourceMappingURL=follow-up.js.map