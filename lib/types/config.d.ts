/**
 * Plugin configuration: schema, defaults, and defensive resolution.
 *
 * @module dsh-smart-prompt/config
 */
import z from '@deepseek-ai/schemastery';
import { DEFAULT_LOOKUP_ROUNDS, DEFAULT_MAX_QUESTIONS, MAX_LOOKUP_ROUNDS, MODE_VALUES, MODEL_SOURCE_VALUES, type Mode, type ModelSource } from './settings-fields.js';
export { DEFAULT_LOOKUP_ROUNDS, DEFAULT_MAX_QUESTIONS, MAX_LOOKUP_ROUNDS, MODE_VALUES, MODEL_SOURCE_VALUES, type Mode, type ModelSource };
/** Values the settings page edits; re-read on every request so a save applies at once. */
export interface LiveSettings {
    readonly mode: Mode;
    readonly modelSource: ModelSource;
    /** Dedicated route; both empty unless the user picked one. */
    readonly provider: string;
    readonly model: string;
    /** Effort for the dedicated model; empty sends none (adapter default). */
    readonly reasoningEffort: string;
    /** Most follow-up questions one refinement may ask about missing information. */
    readonly maxQuestions: number;
    /** Most rounds of session search/read the rewrite may run; 0 turns its lookups off. */
    readonly sessionLookupRounds: number;
    /** Most new ideas one Stardea click returns. */
    readonly stardeaIdeas: number;
    /** Most lookup rounds one Stardea click may run; 0 proposes ideas without searching. */
    readonly stardeaRounds: number;
    /** Whether Stardea may search the web (through DSH's web search service). */
    readonly stardeaWebSearch: boolean;
}
/** Light-mode length ceiling: the rewrite may reach this multiple of the draft. */
export declare const DEFAULT_LIGHT_MAX_RATIO = 2;
/**
 * Standard-mode length ceiling. 0 = uncapped (user decision): restructuring a draft
 * that needed follow-up answers was refused too often; set a positive ratio to cap it.
 */
export declare const DEFAULT_STANDARD_MAX_RATIO = 0;
/** Runtime configuration after defaults are applied. */
export interface ResolvedConfig {
    readonly defaultMode: Mode;
    readonly lightMaxRatio: number;
    readonly standardMaxRatio: number;
    readonly acceptanceCriteria: boolean;
    readonly temperature: number;
    readonly maxTokens: number;
    readonly timeoutMs: number;
    readonly maxInputChars: number;
    readonly contextTurns: number;
    readonly contextChars: number;
    readonly smartContext: boolean;
    readonly fidelityGate: boolean;
    readonly lengthGate: boolean;
    /** Size limit of the workspace knowledge file in characters; 0 turns the file off. */
    readonly knowledgeChars: number;
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort: string;
    readonly logFailures: boolean;
}
/** Loader schema — every key optional. `.volatile()` is what puts a field on the DSH settings page (0.2.0+). */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    defaultMode: z<"standard" | "detailed" | "light", "standard" | "detailed" | "light", "volatile-defined">;
    modelSource: z<"conversation" | "dedicated", "conversation" | "dedicated", "volatile-defined">;
    lightMaxRatio: z<number, number, "defined">;
    standardMaxRatio: z<number, number, "defined">;
    acceptanceCriteria: z<boolean, boolean, "defined">;
    temperature: z<number, number, "defined">;
    maxTokens: z<number, number, "defined">;
    timeoutMs: z<number, number, "defined">;
    maxInputChars: z<number, number, "defined">;
    contextTurns: z<number, number, "defined">;
    contextChars: z<number, number, "defined">;
    smartContext: z<boolean, boolean, "defined">;
    fidelityGate: z<boolean, boolean, "defined">;
    lengthGate: z<boolean, boolean, "defined">;
    knowledgeChars: z<number, number, "defined">;
    provider: z<string, string, "volatile-defined">;
    model: z<string, string, "volatile-defined">;
    dedicatedReasoningEffort: z<string, string, "volatile-defined">;
    maxQuestions: z<number, number, "volatile-defined">;
    sessionLookupRounds: z<number, number, "volatile-defined">;
    stardeaIdeas: z<number, number, "volatile-defined">;
    stardeaRounds: z<number, number, "volatile-defined">;
    stardeaWebSearch: z<boolean, boolean, "volatile-defined">;
    reasoningEffort: z<string, string, "defined">;
    logFailures: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    defaultMode: z<"standard" | "detailed" | "light", "standard" | "detailed" | "light", "volatile-defined">;
    modelSource: z<"conversation" | "dedicated", "conversation" | "dedicated", "volatile-defined">;
    lightMaxRatio: z<number, number, "defined">;
    standardMaxRatio: z<number, number, "defined">;
    acceptanceCriteria: z<boolean, boolean, "defined">;
    temperature: z<number, number, "defined">;
    maxTokens: z<number, number, "defined">;
    timeoutMs: z<number, number, "defined">;
    maxInputChars: z<number, number, "defined">;
    contextTurns: z<number, number, "defined">;
    contextChars: z<number, number, "defined">;
    smartContext: z<boolean, boolean, "defined">;
    fidelityGate: z<boolean, boolean, "defined">;
    lengthGate: z<boolean, boolean, "defined">;
    knowledgeChars: z<number, number, "defined">;
    provider: z<string, string, "volatile-defined">;
    model: z<string, string, "volatile-defined">;
    dedicatedReasoningEffort: z<string, string, "volatile-defined">;
    maxQuestions: z<number, number, "volatile-defined">;
    sessionLookupRounds: z<number, number, "volatile-defined">;
    stardeaIdeas: z<number, number, "volatile-defined">;
    stardeaRounds: z<number, number, "volatile-defined">;
    stardeaWebSearch: z<boolean, boolean, "volatile-defined">;
    reasoningEffort: z<string, string, "defined">;
    logFailures: z<boolean, boolean, "defined">;
}>>, "plain">;
/**
 * Resolve the settings-page fields at call time.
 *
 * @param raw - config as handed to `apply` (volatile references or plain values).
 * @returns the current mode, model source, and dedicated route.
 */
export declare function readLiveSettings(raw: unknown): LiveSettings;
/**
 * Apply defaults and reject nonsense without ever throwing at the user.
 *
 * A misconfigured plugin must still load: every field falls back independently.
 *
 * @param raw - config as handed to `apply` by the loader (possibly undefined).
 * @returns a complete, safe configuration.
 */
export declare function resolveConfig(raw: unknown): ResolvedConfig;
/** Ceiling for one mode. Light has its own; every restructuring mode (standard, detailed) shares standard's. */
export declare function maxRatioFor(config: ResolvedConfig, mode: Mode): number;
/** `$DSH_HOME` (honouring an explicit env var) — web processes can disagree with homedir(). */
export declare function dshHome(): string;
