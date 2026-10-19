/**
 * Plugin configuration: schema, defaults, and defensive resolution.
 *
 * @module dsh-smart-prompt/config
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_LOOKUP_ROUNDS, DEFAULT_MAX_QUESTIONS, DEFAULT_MODE, DEFAULT_MODEL_SOURCE, DEFAULT_STARDEA_IDEAS, DEFAULT_STARDEA_ROUNDS, DEFAULT_STARDEA_WEB_SEARCH, MAX_LOOKUP_ROUNDS, MAX_STARDEA_IDEAS, MAX_STARDEA_ROUNDS, MIN_LOOKUP_ROUNDS, MIN_MAX_QUESTIONS, MIN_STARDEA_IDEAS, MIN_STARDEA_ROUNDS, MODE_VALUES, MODEL_SOURCE_VALUES, isOneOf, } from './settings-fields.js';
import { asRecord, trimmedText } from './values.js';
export { DEFAULT_LOOKUP_ROUNDS, DEFAULT_MAX_QUESTIONS, MAX_LOOKUP_ROUNDS, MODE_VALUES, MODEL_SOURCE_VALUES };
/** Light-mode length ceiling: the rewrite may reach this multiple of the draft. */
export const DEFAULT_LIGHT_MAX_RATIO = 2;
/**
 * Standard-mode length ceiling. 0 = uncapped (user decision): restructuring a draft
 * that needed follow-up answers was refused too often; set a positive ratio to cap it.
 */
export const DEFAULT_STANDARD_MAX_RATIO = 0;
/**
 * Defaults of the loader-only fields. The schema declares them and `resolveConfig` falls
 * back to them, so both read this one table.
 */
const DEFAULTS = Object.freeze({
    lightMaxRatio: DEFAULT_LIGHT_MAX_RATIO,
    standardMaxRatio: DEFAULT_STANDARD_MAX_RATIO,
    acceptanceCriteria: false,
    temperature: 0.3,
    maxTokens: 8192,
    timeoutMs: 180000,
    maxInputChars: 20000,
    contextTurns: 3,
    contextChars: 6000,
    smartContext: true,
    fidelityGate: true,
    lengthGate: true,
    // Size limit of the workspace knowledge file (SMART-PROMPT.md), in characters; 0 turns it off.
    // Read in full at the start of every refinement, so it is kept to a small share of the prompt.
    knowledgeChars: 4000,
    // 'low' by default: a rewrite is a shallow task, and reasoning models at the
    // agent's default effort (often max) can burn minutes or exhaust a small token
    // budget on thinking before any answer text arrives.
    reasoningEffort: 'low',
    logFailures: true,
});
/** Loader schema — every key optional. `.volatile()` is what puts a field on the DSH settings page (0.2.0+). */
export const Config = z.object({
    defaultMode: z.union(MODE_VALUES).default(DEFAULT_MODE).volatile(),
    modelSource: z.union(MODEL_SOURCE_VALUES).default(DEFAULT_MODEL_SOURCE).volatile(),
    lightMaxRatio: z.number().default(DEFAULTS.lightMaxRatio),
    standardMaxRatio: z.number().default(DEFAULTS.standardMaxRatio),
    acceptanceCriteria: z.boolean().default(DEFAULTS.acceptanceCriteria),
    temperature: z.number().default(DEFAULTS.temperature),
    maxTokens: z.number().default(DEFAULTS.maxTokens),
    timeoutMs: z.number().default(DEFAULTS.timeoutMs),
    maxInputChars: z.number().default(DEFAULTS.maxInputChars),
    contextTurns: z.number().default(DEFAULTS.contextTurns),
    contextChars: z.number().default(DEFAULTS.contextChars),
    smartContext: z.boolean().default(DEFAULTS.smartContext),
    fidelityGate: z.boolean().default(DEFAULTS.fidelityGate),
    lengthGate: z.boolean().default(DEFAULTS.lengthGate),
    knowledgeChars: z.number().default(DEFAULTS.knowledgeChars),
    provider: z.string().default('').volatile(),
    model: z.string().default('').volatile(),
    dedicatedReasoningEffort: z.string().default('').volatile(),
    maxQuestions: z.natural().min(MIN_MAX_QUESTIONS).default(DEFAULT_MAX_QUESTIONS).volatile(),
    sessionLookupRounds: z.natural().max(MAX_LOOKUP_ROUNDS).default(DEFAULT_LOOKUP_ROUNDS).volatile(),
    stardeaIdeas: z.natural().min(MIN_STARDEA_IDEAS).max(MAX_STARDEA_IDEAS).default(DEFAULT_STARDEA_IDEAS).volatile(),
    stardeaRounds: z.natural().max(MAX_STARDEA_ROUNDS).default(DEFAULT_STARDEA_ROUNDS).volatile(),
    stardeaWebSearch: z.boolean().default(DEFAULT_STARDEA_WEB_SEARCH).volatile(),
    reasoningEffort: z.string().default(DEFAULTS.reasoningEffort),
    logFailures: z.boolean().default(DEFAULTS.logFailures),
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
    const c = asRecord(raw);
    const mode = live(c.defaultMode);
    const source = live(c.modelSource);
    return {
        mode: isOneOf(mode, MODE_VALUES) ? mode : DEFAULT_MODE,
        modelSource: isOneOf(source, MODEL_SOURCE_VALUES) ? source : DEFAULT_MODEL_SOURCE,
        provider: trimmedText(live(c.provider)),
        model: trimmedText(live(c.model)),
        reasoningEffort: trimmedText(live(c.dedicatedReasoningEffort)),
        maxQuestions: wholeInRange(live(c.maxQuestions), MIN_MAX_QUESTIONS, Infinity, DEFAULT_MAX_QUESTIONS),
        sessionLookupRounds: wholeInRange(live(c.sessionLookupRounds), MIN_LOOKUP_ROUNDS, MAX_LOOKUP_ROUNDS, DEFAULT_LOOKUP_ROUNDS),
        stardeaIdeas: wholeInRange(live(c.stardeaIdeas), MIN_STARDEA_IDEAS, MAX_STARDEA_IDEAS, DEFAULT_STARDEA_IDEAS),
        stardeaRounds: wholeInRange(live(c.stardeaRounds), MIN_STARDEA_ROUNDS, MAX_STARDEA_ROUNDS, DEFAULT_STARDEA_ROUNDS),
        stardeaWebSearch: flag(live(c.stardeaWebSearch), DEFAULT_STARDEA_WEB_SEARCH),
    };
}
/** A whole number within the schema's bounds, else the default (a hand-edited file may hold anything). */
function wholeInRange(value, min, max, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
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
/**
 * Apply defaults and reject nonsense without ever throwing at the user.
 *
 * A misconfigured plugin must still load: every field falls back independently.
 *
 * @param raw - config as handed to `apply` by the loader (possibly undefined).
 * @returns a complete, safe configuration.
 */
export function resolveConfig(raw) {
    const c = asRecord(raw);
    // The settings-page fields have one resolver; this snapshot only mirrors it.
    const settings = readLiveSettings(raw);
    const effort = trimmedText(c.reasoningEffort);
    return {
        defaultMode: settings.mode,
        lightMaxRatio: nonNegative(c.lightMaxRatio, DEFAULTS.lightMaxRatio),
        standardMaxRatio: nonNegative(c.standardMaxRatio, DEFAULTS.standardMaxRatio),
        acceptanceCriteria: flag(c.acceptanceCriteria, DEFAULTS.acceptanceCriteria),
        temperature: nonNegative(c.temperature, DEFAULTS.temperature),
        maxTokens: positive(c.maxTokens, DEFAULTS.maxTokens),
        timeoutMs: positive(c.timeoutMs, DEFAULTS.timeoutMs),
        maxInputChars: positive(c.maxInputChars, DEFAULTS.maxInputChars),
        contextTurns: nonNegative(c.contextTurns, DEFAULTS.contextTurns),
        contextChars: nonNegative(c.contextChars, DEFAULTS.contextChars),
        smartContext: flag(c.smartContext, DEFAULTS.smartContext),
        fidelityGate: flag(c.fidelityGate, DEFAULTS.fidelityGate),
        lengthGate: flag(c.lengthGate, DEFAULTS.lengthGate),
        knowledgeChars: nonNegative(c.knowledgeChars, DEFAULTS.knowledgeChars),
        provider: settings.provider,
        model: settings.model,
        reasoningEffort: effort !== '' ? effort : DEFAULTS.reasoningEffort,
        logFailures: flag(c.logFailures, DEFAULTS.logFailures),
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