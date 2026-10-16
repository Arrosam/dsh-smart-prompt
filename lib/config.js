/**
 * Plugin configuration: schema, defaults, and defensive resolution.
 *
 * @module dsh-smart-prompt/config
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
/** Default cap on follow-up questions per refinement (user-chosen). */
export const DEFAULT_MAX_QUESTIONS = 5;
/** Light-mode length ceiling: the rewrite may reach this multiple of the draft. */
export const DEFAULT_LIGHT_MAX_RATIO = 2;
/**
 * Standard-mode length ceiling. 0 = uncapped (user decision): restructuring a draft
 * that needed follow-up answers was refused too often; set a positive ratio to cap it.
 */
export const DEFAULT_STANDARD_MAX_RATIO = 0;
/** Settings-page fields. `.volatile()` is what puts them on the DSH settings page (0.2.0+). */
export const MODE_VALUES = ['standard', 'light'];
export const MODEL_SOURCE_VALUES = ['conversation', 'dedicated'];
/** Loader schema — every key optional, defaults declared here. */
export const Config = z.object({
    defaultMode: z.union(MODE_VALUES).default('standard').volatile(),
    modelSource: z.union(MODEL_SOURCE_VALUES).default('conversation').volatile(),
    lightMaxRatio: z.number().default(DEFAULT_LIGHT_MAX_RATIO),
    standardMaxRatio: z.number().default(DEFAULT_STANDARD_MAX_RATIO),
    acceptanceCriteria: z.boolean().default(false),
    temperature: z.number().default(0.3),
    maxTokens: z.number().default(8192),
    timeoutMs: z.number().default(180000),
    maxInputChars: z.number().default(20000),
    contextTurns: z.number().default(3),
    contextChars: z.number().default(6000),
    smartContext: z.boolean().default(true),
    fidelityGate: z.boolean().default(true),
    lengthGate: z.boolean().default(true),
    provider: z.string().default('').volatile(),
    model: z.string().default('').volatile(),
    dedicatedReasoningEffort: z.string().default('').volatile(),
    maxQuestions: z.natural().min(1).default(DEFAULT_MAX_QUESTIONS).volatile(),
    // 'low' by default: a rewrite is a shallow task, and reasoning models at the
    // agent's default effort (often max) can burn minutes or exhaust a small token
    // budget on thinking before any answer text arrives.
    reasoningEffort: z.string().default('low'),
    logFailures: z.boolean().default(true),
});
/** Read one field that may be a volatile reference (`.get()`) or a plain value. */
function live(value) {
    return value !== null && typeof value === 'object' && typeof value.get === 'function'
        ? value.get()
        : value;
}
/**
 * Resolve the settings-page fields at call time.
 *
 * @param raw - config as handed to `apply` (volatile references or plain values).
 * @returns the current mode, model source, and dedicated route.
 */
export function readLiveSettings(raw) {
    const c = (raw !== null && typeof raw === 'object' ? raw : {});
    const source = live(c.modelSource);
    return {
        mode: pickMode(live(c.defaultMode), 'standard'),
        modelSource: source === 'dedicated' ? 'dedicated' : 'conversation',
        provider: text(live(c.provider)),
        model: text(live(c.model)),
        reasoningEffort: text(live(c.dedicatedReasoningEffort)),
        maxQuestions: wholeAtLeastOne(live(c.maxQuestions), DEFAULT_MAX_QUESTIONS),
    };
}
function pickMode(value, fallback) {
    return value === 'light' || value === 'standard' ? value : fallback;
}
function wholeAtLeastOne(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}
function positive(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
function nonNegative(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function flag(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * Apply defaults and reject nonsense without ever throwing at the user.
 *
 * A misconfigured plugin must still load: every field falls back independently.
 *
 * @param raw - config as handed to `apply` by the loader (possibly undefined).
 * @returns a complete, safe configuration.
 */
export function resolveConfig(raw) {
    const c = (raw !== null && typeof raw === 'object' ? raw : {});
    return {
        defaultMode: pickMode(live(c.defaultMode), 'standard'),
        lightMaxRatio: nonNegative(c.lightMaxRatio, DEFAULT_LIGHT_MAX_RATIO),
        standardMaxRatio: nonNegative(c.standardMaxRatio, DEFAULT_STANDARD_MAX_RATIO),
        acceptanceCriteria: flag(c.acceptanceCriteria, false),
        temperature: nonNegative(c.temperature, 0.3),
        maxTokens: positive(c.maxTokens, 8192),
        timeoutMs: positive(c.timeoutMs, 180000),
        maxInputChars: positive(c.maxInputChars, 20000),
        contextTurns: nonNegative(c.contextTurns, 3),
        contextChars: nonNegative(c.contextChars, 6000),
        smartContext: flag(c.smartContext, true),
        fidelityGate: flag(c.fidelityGate, true),
        lengthGate: flag(c.lengthGate, true),
        provider: text(live(c.provider)),
        model: text(live(c.model)),
        reasoningEffort: text(c.reasoningEffort) !== '' ? text(c.reasoningEffort) : 'low',
        logFailures: flag(c.logFailures, true),
    };
}
/** Ceiling for one mode. */
export function maxRatioFor(config, mode) {
    return mode === 'light' ? config.lightMaxRatio : config.standardMaxRatio;
}
/** `$DSH_HOME` (honouring an explicit env var) — web processes can disagree with homedir(). */
export function dshHome() {
    const fromEnv = process.env.DSH_HOME;
    return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh');
}
//# sourceMappingURL=config.js.map