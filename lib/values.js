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
export function asRecord(value) {
    return (value !== null && typeof value === 'object' ? value : {});
}
/**
 * A string value, trimmed.
 *
 * @param value - anything.
 * @returns the trimmed string, or '' for a non-string.
 */
export function trimmedText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * The human-readable message of a thrown value.
 *
 * @param error - anything that was thrown.
 * @returns the Error's message, else the value as a string.
 */
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=values.js.map