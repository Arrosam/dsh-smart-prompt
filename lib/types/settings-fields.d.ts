/**
 * The settings-page fields' closed value sets, defaults and bounds.
 *
 * Pure data with no host imports, so both halves read the same values: the host Config
 * schema and resolver (config.ts) and the browser settings section (client/settings.ts),
 * which validates before Save and must agree with what the schema accepts.
 *
 * @module dsh-smart-prompt/settings-fields
 */
/** Settings-page mode choices, in display order. */
export declare const MODE_VALUES: readonly ["standard", "light"];
/** Settings-page model-source choices, in display order. */
export declare const MODEL_SOURCE_VALUES: readonly ["conversation", "dedicated"];
/** Enhancement mode. */
export type Mode = typeof MODE_VALUES[number];
/** Which model refines the prompt. */
export type ModelSource = typeof MODEL_SOURCE_VALUES[number];
/** Mode used when none is saved. */
export declare const DEFAULT_MODE: Mode;
/** Model source used when none is saved. */
export declare const DEFAULT_MODEL_SOURCE: ModelSource;
/** Fewest follow-up questions the cap may be set to. */
export declare const MIN_MAX_QUESTIONS = 1;
/** Default cap on follow-up questions per refinement (user-chosen). */
export declare const DEFAULT_MAX_QUESTIONS = 5;
/** Fewest lookup rounds; 0 turns session lookups off. */
export declare const MIN_LOOKUP_ROUNDS = 0;
/** Default session lookup rounds per refinement (user-chosen); 0 disables lookups. */
export declare const DEFAULT_LOOKUP_ROUNDS = 3;
/**
 * Upper bound on lookup rounds. Neither the host settings form nor the schema bounds a
 * number field, and every round is one more model call the user waits on with the
 * composer, so the setting is capped at a value with headroom over the default.
 */
export declare const MAX_LOOKUP_ROUNDS = 10;
/** Fewest ideas one Stardea click may suggest. */
export declare const MIN_STARDEA_IDEAS = 1;
/** Default ideas per Stardea click: the count Stardea shipped with (user-chosen). */
export declare const DEFAULT_STARDEA_IDEAS = 4;
/** Most ideas per Stardea click (user-chosen): every idea lengthens the reply the user waits on. */
export declare const MAX_STARDEA_IDEAS = 8;
/** Fewest lookup rounds per Stardea click; 0 means ideas without any search. */
export declare const MIN_STARDEA_ROUNDS = 0;
/** Default lookup rounds per Stardea click (user-chosen): one round keeps a click quick. */
export declare const DEFAULT_STARDEA_ROUNDS = 1;
/** Most lookup rounds per Stardea click (user-chosen); each round is one more model call per click. */
export declare const MAX_STARDEA_ROUNDS = 10;
/** Whether Stardea may search the web when nothing is saved (user-chosen: off). */
export declare const DEFAULT_STARDEA_WEB_SEARCH = false;
/**
 * Whether a value is one of a closed set of choices.
 *
 * @param value - anything.
 * @param allowed - the choices.
 * @returns true when `value` is one of them.
 */
export declare function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T;
