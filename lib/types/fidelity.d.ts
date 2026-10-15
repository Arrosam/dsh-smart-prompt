/**
 * Fidelity gate — the plugin's core differentiator.
 *
 * Every other prompt enhancer in the ecosystem asks the model, in its system
 * prompt, to "preserve the original details". None of them checks whether it did.
 * This module checks, deterministically, and then repairs.
 *
 * @module dsh-smart-prompt/fidelity
 */
import { type Anchor } from './anchors.js';
/** Result of one fidelity check. */
export interface FidelityOutcome {
    /** How many hard facts the draft carried. */
    readonly total: number;
    /** How many survived the rewrite. */
    readonly kept: number;
    /** The facts that did not survive, in draft order. */
    readonly missing: Anchor[];
}
/**
 * Verify that every hard fact in the draft survived the rewrite.
 *
 * @param anchors - facts extracted from the draft.
 * @param enhanced - the rewrite.
 * @returns counts plus the exact list of dropped facts.
 */
export declare function checkFidelity(anchors: readonly Anchor[], enhanced: string): FidelityOutcome;
/**
 * One repair instruction appended to the user message for the single retry that
 * a failed gate is allowed. Lists the exact strings so the model can place them
 * naturally instead of guessing.
 *
 * @param missing - facts the first pass dropped.
 * @returns the instruction text.
 */
export declare function repairClause(missing: readonly Anchor[]): string;
/**
 * Deterministic last resort: a block appended to the rewrite so no fact is ever
 * silently lost, even when the model refuses to re-include it.
 *
 * Only reached after the repair pass failed. Kept visually separate and explicitly
 * labelled so it reads as a preserved-details note rather than as prose the user wrote.
 *
 * @param missing - facts still absent.
 * @returns the block to append, or '' when nothing is missing.
 */
export declare function reinjectionBlock(missing: readonly Anchor[]): string;
/**
 * Human-readable account of a partial result, shown in the composer status bar.
 *
 * @param missing - facts that had to be re-appended.
 * @returns one short line, or '' when nothing is missing.
 */
export declare function fidelityNote(missing: readonly Anchor[]): string;
