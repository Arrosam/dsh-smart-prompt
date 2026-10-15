/**
 * dsh-improve-prompt — host half.
 *
 * One loopback route that rewrites a composer draft into a sharper, agent-ready
 * prompt, wrapped in two deterministic gates that no other prompt enhancer in the
 * ecosystem has:
 *
 * - **fidelity gate** — extracts the draft's hard facts (paths, identifiers,
 *   numbers, URLs, code, @references) and verifies each one literally survived the
 *   rewrite; a dropped fact triggers exactly one repair call, then a deterministic
 *   re-append, so nothing is ever silently lost.
 * - **length gate** — refuses to let a one-line request become a specification,
 *   matching WorkBuddy's own "less filler, fewer tokens" positioning.
 *
 * At most TWO model calls per click (one generation + one repair), never a pipeline.
 *
 * @module dsh-improve-prompt
 */
import { readLiveSettings, resolveConfig } from './config.js';
import { improveDraft, ERR } from './orchestrate.js';
/** Cordis plugin name. */
export const name = 'dsh-improve-prompt';
/** Required services: the model registry and the HTTP carrier. */
export const inject = ['llm', 'webServer'];
export { Config } from './config.js';
/** Route namespace. */
const API = '/dsh-improve-prompt/api';
/** Request body cap; the composer limit is far lower, this only stops abuse. */
const MAX_BODY_BYTES = 512 * 1024;
function sendJson(res, status, payload) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (...args) => {
            const chunk = args[0];
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('body too large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')); });
        req.on('error', (error) => { reject(error instanceof Error ? error : new Error(String(error))); });
    });
}
/**
 * Attach the plugin.
 *
 * @param ctx - cordis context carrying `llm` and `webServer`.
 * @param rawConfig - loader-supplied configuration (all keys optional).
 */
export function apply(ctx, rawConfig) {
    const config = resolveConfig(rawConfig);
    const log = ctx.logger;
    // ctx.get() is the non-throwing accessor for a service outside the declared inject
    // list; reading ctx.<service> directly throws for an uninjected one.
    const service = (serviceName) => ctx.get(serviceName);
    // Last route observed on the live waterfall: the fallback when neither the config
    // nor the default-model selection names one. Waterfall listeners MUST delegate.
    let lastRoute = null;
    ctx.on('llm/stream', ((options, next) => {
        if (typeof options.provider === 'string' && typeof options.model === 'string'
            && options.provider !== '' && options.model !== '') {
            lastRoute = { provider: options.provider, model: options.model };
        }
        return next();
    }));
    // The model picked in one conversation: the host's durable `modelSelection` session
    // projection (`next` = pending pick, else the last request's route). Read structurally
    // and defensively — on hosts without it the route falls back to the default model.
    const conversationModel = (sessionId) => {
        const sessions = service('sessions');
        const projections = service('sessionProjections');
        if (typeof sessions?.get !== 'function' || typeof projections?.stateOf !== 'function')
            return undefined;
        try {
            const session = sessions.get(sessionId);
            if (session === undefined)
                return undefined;
            const state = projections.stateOf(session, 'modelSelection');
            return state?.pending ?? state?.lastUsed ?? undefined;
        }
        catch {
            return undefined;
        }
    };
    const deps = () => {
        const defaults = service('agentDefaultModel');
        const settings = readLiveSettings(rawConfig);
        return {
            dedicated: settings.modelSource === 'dedicated'
                ? { provider: settings.provider, model: settings.model, reasoningEffort: settings.reasoningEffort }
                : undefined,
            conversationModel,
            llm: service('llm'),
            selection: typeof defaults?.currentSelection === 'function'
                ? defaults.currentSelection()
                : undefined,
            lastRoute,
            sessions: service('sessions'),
        };
    };
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: API,
        handler: async (req, res) => {
            const url = typeof req.url === 'string' ? req.url : '';
            if (req.method === 'GET' && (url === API + '/config' || url === API + '/config/')) {
                sendJson(res, 200, {
                    ok: true,
                    defaultMode: readLiveSettings(rawConfig).mode,
                    modes: ['light', 'standard'],
                    maxRatio: { light: config.lightMaxRatio, standard: config.standardMaxRatio },
                    smartContext: config.smartContext,
                });
                return;
            }
            if (url !== API + '/improve' && url !== API + '/improve/') {
                sendJson(res, 404, { ok: false, code: ERR.UNKNOWN, message: 'unknown route: ' + url });
                return;
            }
            if (req.method !== 'POST') {
                sendJson(res, 405, { ok: false, code: ERR.UNKNOWN, message: 'POST required' });
                return;
            }
            let body;
            try {
                body = JSON.parse(await readBody(req));
            }
            catch (error) {
                sendJson(res, 400, { ok: false, code: 'BAD_BODY', message: error instanceof Error ? error.message : 'invalid JSON' });
                return;
            }
            const input = (body !== null && typeof body === 'object' ? body : {});
            const draft = typeof input.text === 'string' ? input.text : '';
            const sessionId = typeof input.sessionId === 'string' && input.sessionId !== '' ? input.sessionId : '';
            // The settings page owns the mode; a request may still name one explicitly.
            const mode = input.mode === 'light' || input.mode === 'standard' ? input.mode : readLiveSettings(rawConfig).mode;
            // Cancellation: a browser aborting the fetch must stop the model.
            const controller = new AbortController();
            let clientGone = false;
            res.on('close', () => {
                if (res.writableEnded !== true) {
                    clientGone = true;
                    controller.abort();
                }
            });
            const started = Date.now();
            try {
                const result = await improveDraft(deps(), config, { draft, sessionId, mode, signal: controller.signal });
                if (clientGone)
                    return;
                // Every refusal is observable: the handled failure payloads below used to
                // return silently, leaving nothing in the host log to diagnose with.
                if (result.ok === false && config.logFailures) {
                    log?.warn?.('[dsh-improve-prompt] ' + result.code + ' (' + String(Date.now() - started) + 'ms): ' + result.message);
                }
                sendJson(res, 200, result);
            }
            catch (error) {
                if (clientGone)
                    return;
                if (config.logFailures)
                    log?.warn?.('[dsh-improve-prompt] ' + (error instanceof Error ? error.message : String(error)));
                sendJson(res, 200, {
                    ok: false,
                    code: ERR.UNKNOWN,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        },
    }), 'dsh-improve-prompt: improve api');
}
//# sourceMappingURL=index.js.map