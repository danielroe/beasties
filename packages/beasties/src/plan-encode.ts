import type { CompiledRule, CompiledSheet, SelectorMatch, StructuralProgram, TokenCondition } from './compiler'
import type { CompactAttr, CompactCompound, CompactMatch, CompactPlan, CompactProgram, CompactRule, PooledString } from './plan'

import {
  ATTR_ACTIONS,
  F_ALWAYS,
  F_CSS,
  F_FONT_FACE,
  F_FONTS_USED,
  F_KEYFRAMES,
  F_KEYFRAMES_USED,
  F_MATCH,
  F_SELECTORS,
  F_WRAP,
  M_CLASS,
  M_ID,
  M_TAG,
  M_TRUE,
} from './plan'

/**
 * Collects string frequencies so only strings used more than once are pooled;
 * pooling a unique string would cost more than inlining it.
 */
class StringPool {
  #counts = new Map<string, number>()
  #indices = new Map<string, number>()
  strings: string[] = []

  count(value: string | undefined): void {
    if (value === undefined) {
      return
    }
    this.#counts.set(value, (this.#counts.get(value) ?? 0) + 1)
  }

  finalize(): void {
    for (const [value, count] of this.#counts) {
      if (count > 1) {
        this.strings.push(value)
        this.#indices.set(value, this.strings.length)
      }
    }
  }

  /** A pooled string's one-based index, or the string itself when it isn't pooled */
  ref(value: string): PooledString {
    return this.#indices.get(value) ?? value
  }

  refs(values: string[]): PooledString[] {
    return values.map(value => this.ref(value))
  }
}

export function encodePlan(sheet: CompiledSheet): CompactPlan {
  const pool = new StringPool()
  const wrapKeys = new Map<string, number>()
  const wraps: string[][] = []

  for (const rule of sheet.rules) {
    countRule(rule, pool)
    if (rule.wrap) {
      const key = rule.wrap.join('\0')
      if (!wrapKeys.has(key)) {
        wrapKeys.set(key, wraps.length)
        wraps.push(rule.wrap)
      }
    }
  }
  for (const wrap of wraps) {
    for (const part of wrap) {
      pool.count(part)
    }
  }
  pool.finalize()

  return [
    1,
    sheet.href ?? 0,
    sheet.size,
    pool.strings,
    wraps.map(wrap => pool.refs(wrap)),
    sheet.rules.map(rule => encodeRule(rule, pool, wrapKeys)),
  ]
}

function countRule(rule: CompiledRule, pool: StringPool) {
  if (rule.selectors) {
    for (const selector of rule.selectors) {
      pool.count(selector)
    }
    pool.count(rule.body)
  }
  pool.count(rule.css)
  if (rule.match) {
    for (const condition of rule.match) {
      countCondition(condition, pool)
    }
  }
  for (const value of rule.fontsUsed ?? []) {
    pool.count(value)
  }
  for (const value of rule.keyframesUsed ?? []) {
    pool.count(value)
  }
  pool.count(rule.keyframes)
  pool.count(rule.fontFace?.family)
  pool.count(rule.fontFace?.src)
}

function countCondition(condition: SelectorMatch, pool: StringPool) {
  if (condition === true) {
    return
  }
  if (condition.program) {
    // token fields are dropped by the encoding when a program is present
    for (const compound of condition.program.compounds) {
      pool.count(compound.tag)
      for (const value of compound.classes ?? []) {
        pool.count(value)
      }
      for (const value of compound.ids ?? []) {
        pool.count(value)
      }
      for (const attr of compound.attrs ?? []) {
        pool.count(attr.name)
        pool.count(attr.value)
      }
    }
    return
  }
  for (const list of [condition.classes, condition.ids, condition.tags, condition.attrs]) {
    for (const value of list ?? []) {
      pool.count(value)
    }
  }
}

function encodeRule(rule: CompiledRule, pool: StringPool, wrapKeys: Map<string, number>): CompactRule {
  let flags = 0
  const fields: unknown[] = []

  if (rule.selectors && rule.body !== undefined) {
    flags |= F_SELECTORS
    // the common single-selector case skips the array wrapper
    fields.push(
      rule.selectors.length === 1 ? pool.ref(rule.selectors[0]!) : pool.refs(rule.selectors),
      pool.ref(rule.body),
    )
  }
  if (rule.css !== undefined) {
    flags |= F_CSS
    fields.push(pool.ref(rule.css))
  }
  if (rule.match) {
    flags |= F_MATCH
    fields.push(rule.match.map((condition, index) => encodeMatch(condition, rule.selectors?.[index], pool)))
  }
  if (rule.always) {
    flags |= F_ALWAYS
  }
  if (rule.wrap) {
    flags |= F_WRAP
    fields.push(wrapKeys.get(rule.wrap.join('\0'))!)
  }
  if (rule.fontsUsed) {
    flags |= F_FONTS_USED
    fields.push(pool.refs(rule.fontsUsed))
  }
  if (rule.keyframesUsed) {
    flags |= F_KEYFRAMES_USED
    fields.push(pool.refs(rule.keyframesUsed))
  }
  if (rule.fontFace) {
    flags |= F_FONT_FACE
    const face: unknown[] = [
      rule.fontFace.family === undefined ? 0 : pool.ref(rule.fontFace.family),
      rule.fontFace.src === undefined ? 0 : pool.ref(rule.fontFace.src),
    ]
    if (rule.fontFace.ranges) {
      face.push(rule.fontFace.ranges)
    }
    fields.push(face)
  }
  if (rule.keyframes !== undefined) {
    flags |= F_KEYFRAMES
    fields.push(pool.ref(rule.keyframes))
  }

  return [flags, ...fields]
}

/**
 * Most conditions restate their selector (`.foo` -> `{ classes: ['foo'] }`).
 * Those are stored as a marker and rederived at decode time, but only when the
 * derivation round-trips exactly: escaped selectors (`.md\:flex`) parse to a
 * different value than their source text.
 *
 * When a structural program is present it decides the match on its own, so the
 * token fields are dropped. A scan that doesn't evaluate programs then treats
 * such a selector as critical rather than checking tokens, which over-inlines
 * but never drops a rule.
 */
function encodeMatch(condition: SelectorMatch, selector: string | undefined, pool: StringPool): CompactMatch {
  if (condition === true) {
    return M_TRUE
  }
  if (condition.program) {
    return encodeProgram(condition.program, pool)
  }
  if (selector !== undefined) {
    for (const marker of [M_CLASS, M_ID, M_TAG] as const) {
      const derived = deriveCondition(marker, selector)
      if (derived && sameCondition(derived, condition)) {
        return marker
      }
    }
  }

  return [
    condition.classes ? pool.refs(condition.classes) : 0,
    condition.ids ? pool.refs(condition.ids) : 0,
    condition.tags ? pool.refs(condition.tags) : 0,
    condition.attrs ? pool.refs(condition.attrs) : 0,
  ]
}

function deriveCondition(marker: typeof M_CLASS | typeof M_ID | typeof M_TAG, selector: string): TokenCondition | undefined {
  if (marker === M_TAG) {
    return { tags: [selector.toLowerCase()] }
  }
  const expectedPrefix = marker === M_CLASS ? '.' : '#'
  if (selector[0] !== expectedPrefix) {
    return undefined
  }
  const value = selector.slice(1)
  return marker === M_CLASS ? { classes: [value] } : { ids: [value] }
}

function sameCondition(a: TokenCondition, b: TokenCondition): boolean {
  for (const key of ['classes', 'ids', 'tags', 'attrs'] as const) {
    const left = a[key]
    const right = b[key]
    if (left === undefined || right === undefined) {
      if (left !== right) {
        return false
      }
      continue
    }
    if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
      return false
    }
  }
  return true
}

function encodeProgram(program: StructuralProgram, pool: StringPool): CompactProgram {
  return [
    program.combinators.join(''),
    program.compounds.map((compound): CompactCompound => {
      const onlyClass = compound.classes?.length === 1
        && compound.tag === undefined
        && !compound.ids
        && !compound.attrs
      if (onlyClass) {
        return pool.ref(compound.classes![0]!)
      }
      return [
        compound.tag === undefined ? 0 : pool.ref(compound.tag),
        compound.classes ? pool.refs(compound.classes) : 0,
        compound.ids ? pool.refs(compound.ids) : 0,
        compound.attrs
          ? compound.attrs.map((attr): CompactAttr => [
              pool.ref(attr.name),
              ATTR_ACTIONS.indexOf(attr.action),
              attr.value === undefined ? 0 : pool.ref(attr.value),
              attr.ignoreCase ? 1 : 0,
            ])
          : 0,
      ]
    }),
  ]
}
