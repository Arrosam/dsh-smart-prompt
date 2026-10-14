/**
 * Plugin configuration: schema, defaults, and defensive resolution.
 *
 * @module dsh-improve-prompt/config
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Enhancement mode. */
export type Mode = 'light' | 'standard'

/** Runtime configuration after defaults are applied. */
export interface ResolvedConfig {
  readonly defaultMode: Mode
  readonly lightMaxRatio: number
  readonly standardMaxRatio: number
  readonly acceptanceCriteria: boolean
  readonly temperature: number
  readonly maxTokens: number
  readonly timeoutMs: number
  readonly maxInputChars: number
  readonly contextTurns: number
  readonly contextChars: number
  readonly smartContext: boolean
  readonly fidelityGate: boolean
  readonly lengthGate: boolean
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly logFailures: boolean
}

/** Loader schema — every key optional, defaults declared here. */
export const Config = z.object({
  defaultMode: z.string().default('standard'),
  lightMaxRatio: z.number().default(1.2),
  standardMaxRatio: z.number().default(2.5),
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
  provider: z.string().default(''),
  model: z.string().default(''),
  // 'low' by default: a rewrite is a shallow task, and reasoning models at the
  // agent's default effort (often max) can burn minutes or exhaust a small token
  // budget on thinking before any answer text arrives.
  reasoningEffort: z.string().default('low'),
  logFailures: z.boolean().default(true),
})

function pickMode(value: unknown, fallback: Mode): Mode {
  return value === 'light' || value === 'standard' ? value : fallback
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Apply defaults and reject nonsense without ever throwing at the user.
 *
 * A misconfigured plugin must still load: every field falls back independently.
 *
 * @param raw - config as handed to `apply` by the loader (possibly undefined).
 * @returns a complete, safe configuration.
 */
export function resolveConfig(raw: unknown): ResolvedConfig {
  const c = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    defaultMode: pickMode(c.defaultMode, 'standard'),
    lightMaxRatio: positive(c.lightMaxRatio, 1.2),
    standardMaxRatio: positive(c.standardMaxRatio, 2.5),
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
    provider: text(c.provider),
    model: text(c.model),
    reasoningEffort: text(c.reasoningEffort) !== '' ? text(c.reasoningEffort) : 'low',
    logFailures: flag(c.logFailures, true),
  }
}

/** Ceiling for one mode. */
export function maxRatioFor(config: ResolvedConfig, mode: Mode): number {
  return mode === 'light' ? config.lightMaxRatio : config.standardMaxRatio
}

/** `$DSH_HOME` (honouring an explicit env var) — web processes can disagree with homedir(). */
export function dshHome(): string {
  const fromEnv = process.env.DSH_HOME
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}
