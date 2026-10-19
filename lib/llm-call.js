/**
 * One streaming model call: route resolution, cancellation, timeout, and reply
 * assembly. A call sends a whole conversation and returns the model's reply as an
 * assistant message the caller appends to that conversation (see refine-chat.ts), plus
 * the reply's text, its tool calls, and the token usage the adapter reported.
 *
 * The llm service is addressed STRUCTURALLY (type-only import + an inline message
 * object) rather than through a runtime import of `@deepseek-ai/dsh-llm`. A plugin
 * installed with its own copy of that package would otherwise resolve a different
 * version than the running host, and the two copies need not agree on the message
 * object. Type-only imports are erased at emit, so the built plugin carries no
 * runtime dependency on the harness at all.
 *
 * @module dsh-smart-prompt/llm-call
 */
import { errorMessage, trimmedText } from './values.js';
/** Reason a route could not be resolved. */
export class NoRouteError extends Error {
    constructor() {
        super('dsh-smart-prompt: no provider/model route available (pick a model in the plugin settings or in this conversation)');
        this.name = 'NoRouteError';
    }
}
let messageSeq = 0;
/** A message id unique within this host process (adapters never send ids to the model). */
function nextMessageId() {
    messageSeq += 1;
    return 'dsh-smart-prompt-' + String(messageSeq);
}
/**
 * Build one user message, shape-complete for the host's `Message` contract without
 * importing the constructor.
 *
 * @param text - the full user-message body.
 * @param extra - content blocks that follow the text (images, attached files).
 * @returns a frozen user message.
 */
export function userMessage(text, extra = []) {
    return Object.freeze({
        id: nextMessageId(),
        role: 'user',
        content: Object.freeze([Object.freeze({ type: 'text', text }), ...extra]),
        source: Object.freeze({ kind: 'user' }),
    });
}
/**
 * Build an assistant message holding only text: a reply re-sent without its tool calls
 * or reasoning, to a route that takes no tools.
 *
 * @param route - the route that produced the reply.
 * @param text - the reply's visible text.
 * @returns a frozen assistant message.
 */
export function assistantTextMessage(route, text) {
    return Object.freeze({
        id: nextMessageId(),
        role: 'assistant',
        content: Object.freeze([Object.freeze({ type: 'text', text })]),
        source: Object.freeze({ kind: 'model', provider: route.provider, model: route.model }),
    });
}
/**
 * Build the tool-role message answering one tool call of the previous assistant reply.
 *
 * @param callId - id of the call it answers.
 * @param text - the tool output.
 * @returns a frozen tool-result message.
 */
export function toolResultMessage(callId, text) {
    return Object.freeze({
        id: nextMessageId(),
        role: 'tool',
        toolCallId: callId,
        content: Object.freeze([Object.freeze({ type: 'text', text })]),
        source: Object.freeze({ kind: 'tool', callId }),
    });
}
/**
 * Every block of one response, assembled from its deltas, in first-seen stream order.
 *
 * The whole response is kept, reasoning included, because it goes back to the model as
 * the assistant turn of the next call: a provider replays thinking from it, and the
 * finish chunk's replay envelope lists its entries in exactly this first-seen block order.
 * Blocks are keyed by kind and index: a compliant stream gives each index one kind, so
 * this matches the host's own assembly, while a stream that reuses an index across kinds
 * still keeps both blocks instead of gluing a tool call's arguments onto text.
 */
class ReplyAssembler {
    blocks = new Map();
    /** Feed one chunk; anything but a delta or a finished block is ignored. */
    push(chunk) {
        switch (chunk.type) {
            case 'text-delta':
            case 'reasoning-delta': {
                const delta = chunk;
                this.at(chunk.type === 'text-delta' ? 'text' : 'reasoning', delta.index).text += delta.text;
                return;
            }
            case 'tool-call-delta': {
                const delta = chunk;
                const call = this.at('tool-call', delta.index);
                if (typeof delta.id === 'string' && delta.id !== '')
                    call.id = delta.id;
                if (typeof delta.name === 'string' && delta.name !== '')
                    call.name = delta.name;
                if (typeof delta.argumentsDelta === 'string')
                    call.arguments += delta.argumentsDelta;
                return;
            }
            case 'block-end': {
                // The finished block is authoritative over the deltas it was assembled from.
                const end = chunk;
                if (end.block !== undefined && typeof end.block.type === 'string')
                    this.at(end.block.type, end.index).done = end.block;
                return;
            }
            default:
        }
    }
    /** The visible text of the response. */
    text() {
        return this.list().filter((block) => block.type === 'text').map((block) => block.text).join('');
    }
    /** The tool calls of the response, in stream order. */
    toolCalls() {
        return this.list().filter((block) => block.type === 'tool-call')
            .map((call, position) => ({ id: call.id !== '' ? call.id : 'call-' + String(position), name: call.name, arguments: call.arguments }));
    }
    /**
     * The response as an assistant message.
     *
     * @param route - the route that produced it (the message's model source).
     * @param replayState - the finish chunk's replay envelope, when the adapter sent one.
     */
    message(route, replayState) {
        const content = this.list().map((block) => {
            if (block.done !== null)
                return Object.freeze({ ...block.done });
            if (block.type === 'tool-call')
                return Object.freeze({ type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments });
            return Object.freeze({ type: block.type, text: block.text });
        });
        return Object.freeze({
            id: nextMessageId(),
            role: 'assistant',
            content: Object.freeze(content),
            source: Object.freeze({ kind: 'model', provider: route.provider, model: route.model, ...(replayState !== undefined ? { replayState } : {}) }),
        });
    }
    /** Blocks in first-seen order, finished blocks read through. */
    list() {
        return [...this.blocks.values()].map((block) => block.done === null ? block : {
            ...block,
            text: typeof block.done.text === 'string' ? block.done.text : block.text,
            id: typeof block.done.id === 'string' && block.done.id !== '' ? block.done.id : block.id,
            name: typeof block.done.name === 'string' && block.done.name !== '' ? block.done.name : block.name,
            arguments: typeof block.done.arguments === 'string' ? block.done.arguments : block.arguments,
        });
    }
    at(type, index) {
        const key = type + ':' + String(typeof index === 'number' ? index : 0);
        let block = this.blocks.get(key);
        if (block === undefined) {
            block = { type, text: '', id: '', name: '', arguments: '', done: null };
            this.blocks.set(key, block);
        }
        return block;
    }
}
function routeOf(candidate) {
    const provider = trimmedText(candidate?.provider);
    const model = trimmedText(candidate?.model);
    return provider !== '' && model !== '' ? { provider, model } : null;
}
/**
 * Resolve the route for one call, in precedence order: the dedicated model (when the
 * user chose one), the conversation's own model, the harness default selection, then
 * the last route seen on the live `llm/stream` waterfall.
 *
 * @param sources - the candidate routes.
 * @returns the route to use.
 * @throws {NoRouteError} when nothing is available.
 */
export function resolveRoute(sources) {
    const dedicated = routeOf(sources.dedicated);
    if (dedicated !== null) {
        return { ...dedicated, reasoningEffort: trimmedText(sources.dedicated?.reasoningEffort) };
    }
    const picked = routeOf(sources.conversation) ?? routeOf(sources.defaults) ?? sources.lastSeen ?? null;
    if (picked !== null)
        return picked;
    throw new NoRouteError();
}
/**
 * Run one model call and assemble its reply.
 *
 * Cancellation and timeout both abort the underlying stream, and an aborted call
 * yields no text at all — so a cancelled enhancement can never half-replace the
 * user's draft.
 *
 * @param llm - the llm service.
 * @param request - route, conversation, config, and caller signal.
 * @returns the assembled reply or a typed failure, each with the call's token usage.
 */
export async function callModel(llm, request) {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => { controller.abort(); };
    request.signal.addEventListener('abort', onAbort, { once: true });
    const timer = request.config.timeoutMs > 0
        ? setTimeout(() => { timedOut = true; controller.abort(); }, request.config.timeoutMs)
        : null;
    // Adapters emit usage before the terminal finish, so a call that fails after it still reports it.
    let usage;
    const fail = (failure) => ({ ok: false, failure, usage });
    // Timeout outranks the caller's cancel: the timer is what aborted the stream then.
    const interrupted = () => {
        if (timedOut)
            return fail({ code: 'TIMEOUT' });
        if (request.signal.aborted)
            return fail({ code: 'ABORTED' });
        return null;
    };
    // The host turns an adapter failure into a terminal `error` finish rather than a throw.
    let upstreamError = null;
    let replayState;
    const reply = new ReplyAssembler();
    const offersTools = request.tools !== undefined && request.tools.length > 0;
    try {
        const options = {
            provider: request.route.provider,
            model: request.route.model,
            system: request.system,
            messages: request.messages,
            temperature: request.config.temperature,
            maxTokens: request.config.maxTokens,
            signal: controller.signal,
        };
        // Only send a reasoning effort when the user asked for one: gateways disagree
        // on whether they accept the parameter at all.
        const effort = request.route.reasoningEffort !== undefined ? request.route.reasoningEffort : request.config.reasoningEffort;
        if (effort !== '')
            options.reasoningEffort = effort;
        if (offersTools)
            options.tools = request.tools;
        const iterator = llm.stream(options)[Symbol.asyncIterator]();
        let finished = false;
        try {
            while (finished === false) {
                const step = await iterator.next();
                if (step.done === true)
                    break;
                const chunk = step.value;
                if (chunk.type === 'usage')
                    usage = chunk.usage;
                else if (chunk.type === 'finish') {
                    finished = true;
                    const finish = chunk;
                    const reason = finish.reason;
                    if (reason?.kind === 'error')
                        upstreamError = typeof reason.failure?.message === 'string' ? reason.failure.message : 'model call failed';
                    replayState = finish.replayState;
                }
                else
                    reply.push(chunk);
            }
        }
        finally {
            // Release the upstream stream on every exit path, including cancellation.
            if (typeof iterator.return === 'function') {
                try {
                    await iterator.return(undefined);
                }
                catch { /* the stream is already settling */ }
            }
        }
    }
    catch (error) {
        return interrupted() ?? fail({ code: 'UPSTREAM', message: errorMessage(error) });
    }
    finally {
        if (timer !== null)
            clearTimeout(timer);
        request.signal.removeEventListener('abort', onAbort);
    }
    const stopped = interrupted();
    if (stopped !== null)
        return stopped;
    const text = reply.text();
    const calls = reply.toolCalls();
    const blank = text.trim() === '';
    // Only a failure that left nothing behind: a partial answer keeps its old handling.
    if (upstreamError !== null && blank && calls.length === 0)
        return fail({ code: 'UPSTREAM', message: upstreamError });
    if (offersTools && calls.length > 0)
        return { ok: true, text, toolCalls: calls, reply: reply.message(request.route, replayState), usage };
    if (calls.length > 0 && blank)
        return fail({ code: 'TOOL_CALL' });
    if (blank)
        return fail({ code: 'EMPTY' });
    return { ok: true, text, toolCalls: [], reply: reply.message(request.route, replayState), usage };
}
//# sourceMappingURL=llm-call.js.map