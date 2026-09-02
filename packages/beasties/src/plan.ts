/**
 * Compact wire format for compiled plans.
 *
 * `CompiledSheet` is convenient to produce and consume but verbose to embed in
 * a server bundle: object keys repeat per rule, and most `match` conditions
 * merely restate their selector. `encodePlan` rewrites a sheet as positional
 * arrays with a shared string pool, and `decodePlan` restores it, so the
 * runtime's hot path works on exactly the same shapes as before.
 *
 * Build-time diagnostics (`warnings`) are dropped by the encoding.
 */

import type { AttrTest } from './compiler'

/**
 * A string, or a one-based index into the plan's string pool. References are
 * biased by one so that `0` is free to mean "field absent" in the slots typed
 * `PooledString | 0`.
 */
export type PooledString = string | number

export type CompactPlan = [
  version: 1,
  href: string | 0,
  size: number,
  pool: string[],
  wraps: PooledString[][],
  rules: CompactRule[],
]

/** `[flags, ...present fields in flag order]` */
export type CompactRule = unknown[]

/**
 * A selector's match condition. Small integers are markers for conditions
 * rederivable from the selector text; arrays are discriminated by their first
 * slot, which is a string only for programs (the combinator sequence).
 */
export type CompactMatch = 0 | 1 | 2 | 3 | CompactProgram | CompactTokens

export type CompactTokens = [
  classes: PooledString[] | 0,
  ids: PooledString[] | 0,
  tags: PooledString[] | 0,
  attrs: PooledString[] | 0,
]

export type CompactProgram = [combinators: string, compounds: CompactCompound[]]

/** A bare value is a compound of one class; anything else uses the array form */
export type CompactCompound = PooledString | [
  tag: PooledString | 0,
  classes: PooledString[] | 0,
  ids: PooledString[] | 0,
  attrs: CompactAttr[] | 0,
]

export type CompactAttr = [name: PooledString, action: number, value: PooledString | 0, ignoreCase: 0 | 1]

export const F_SELECTORS = 1
export const F_CSS = 2
export const F_MATCH = 4
export const F_ALWAYS = 8
export const F_WRAP = 16
export const F_FONTS_USED = 32
export const F_KEYFRAMES_USED = 64
export const F_FONT_FACE = 128
export const F_KEYFRAMES = 256

/** condition is exactly `{ classes: [selector.slice(1)] }`, etc. */
export const M_TRUE = 0
export const M_CLASS = 1
export const M_ID = 2
export const M_TAG = 3

export const ATTR_ACTIONS: AttrTest['action'][] = ['exists', 'equals', 'element', 'start', 'end', 'any', 'hyphen']

/** Whether a value is a compact plan rather than a `CompiledSheet` */
export function isCompactPlan(plan: unknown): plan is CompactPlan {
  return Array.isArray(plan) && plan[0] === 1
}
