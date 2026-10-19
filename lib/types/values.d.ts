/**
 * Coercions for values that arrive untyped from the host (loader config, request bodies,
 * service payloads). One implementation each, so every boundary treats malformed input
 * the same way.
 *
 * @module dsh-smart-prompt/values
 */
/**
 * View any value as a plain field bag.
 *
 * @param value - anything.
 * @returns the value itself when it is a non-null object, else an empty object.
 */
export declare function asRecord(value: unknown): Record<string, unknown>;
/**
 * A string value, trimmed.
 *
 * @param value - anything.
 * @returns the trimmed string, or '' for a non-string.
 */
export declare function trimmedText(value: unknown): string;
/**
 * The human-readable message of a thrown value.
 *
 * @param error - anything that was thrown.
 * @returns the Error's message, else the value as a string.
 */
export declare function errorMessage(error: unknown): string;
