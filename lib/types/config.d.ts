/**
 * Plugin configuration: schema, defaults, and defensive resolution.
 *
 * @module dsh-smart-prompt/config
 */
import z from '@deepseek-ai/schemastery';
/** Enhancement mode. */
export type Mode = 'light' | 'standard';
/** Which model refines the prompt. */
export type ModelSource = 'conversation' | 'dedicated';
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
}
/** Default cap on follow-up questions per refinement (user-chosen). */
export declare const DEFAULT_MAX_QUESTIONS = 5;
/** Settings-page fields. `.volatile()` is what puts them on the DSH settings page (0.2.0+). */
export declare const MODE_VALUES: readonly ["standard", "light"];
export declare const MODEL_SOURCE_VALUES: readonly ["conversation", "dedicated"];
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
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort: string;
    readonly logFailures: boolean;
}
/** Loader schema — every key optional, defaults declared here. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    defaultMode: z<"light" | "standard", "light" | "standard", "volatile-defined">;
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
    provider: z<string, string, "volatile-defined">;
    model: z<string, string, "volatile-defined">;
    dedicatedReasoningEffort: z<string, string, "volatile-defined">;
    maxQuestions: z<number, number, "volatile-defined">;
    reasoningEffort: z<string, string, "defined">;
    logFailures: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    defaultMode: z<"light" | "standard", "light" | "standard", "volatile-defined">;
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
    provider: z<string, string, "volatile-defined">;
    model: z<string, string, "volatile-defined">;
    dedicatedReasoningEffort: z<string, string, "volatile-defined">;
    maxQuestions: z<number, number, "volatile-defined">;
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
/** Ceiling for one mode. */
export declare function maxRatioFor(config: ResolvedConfig, mode: Mode): number;
/** `$DSH_HOME` (honouring an explicit env var) — web processes can disagree with homedir(). */
export declare function dshHome(): string;
