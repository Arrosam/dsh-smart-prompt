/**
 * Plugin configuration: schema, defaults, and defensive resolution.
 *
 * @module dsh-improve-prompt/config
 */
import z from '@deepseek-ai/schemastery';
/** Enhancement mode. */
export type Mode = 'light' | 'standard';
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
export declare const Config: z<Schemastery.ObjectS<{
    defaultMode: z<string, string>;
    lightMaxRatio: z<number, number>;
    standardMaxRatio: z<number, number>;
    acceptanceCriteria: z<boolean, boolean>;
    temperature: z<number, number>;
    maxTokens: z<number, number>;
    timeoutMs: z<number, number>;
    maxInputChars: z<number, number>;
    contextTurns: z<number, number>;
    contextChars: z<number, number>;
    smartContext: z<boolean, boolean>;
    fidelityGate: z<boolean, boolean>;
    lengthGate: z<boolean, boolean>;
    provider: z<string, string>;
    model: z<string, string>;
    reasoningEffort: z<string, string>;
    logFailures: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    defaultMode: z<string, string>;
    lightMaxRatio: z<number, number>;
    standardMaxRatio: z<number, number>;
    acceptanceCriteria: z<boolean, boolean>;
    temperature: z<number, number>;
    maxTokens: z<number, number>;
    timeoutMs: z<number, number>;
    maxInputChars: z<number, number>;
    contextTurns: z<number, number>;
    contextChars: z<number, number>;
    smartContext: z<boolean, boolean>;
    fidelityGate: z<boolean, boolean>;
    lengthGate: z<boolean, boolean>;
    provider: z<string, string>;
    model: z<string, string>;
    reasoningEffort: z<string, string>;
    logFailures: z<boolean, boolean>;
}>>;
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
