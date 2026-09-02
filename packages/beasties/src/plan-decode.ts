import type { AttrTest, CompiledRule, CompiledSheet, CompoundTest, SelectorMatch, StructuralProgram, TokenCondition } from './compiler'
import type { CompactAttr, CompactCompound, CompactMatch, CompactPlan, CompactProgram, CompactRule, CompactTokens, PooledString } from './plan'

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

export function decodePlan(plan: CompactPlan): CompiledSheet {
  const [, href, size, pool, wraps, rules] = plan
  const deref = (value: PooledString): string => (typeof value === 'number' ? pool[value - 1]! : value)
  const derefAll = (values: PooledString[]): string[] => values.map(deref)
  const wrapChains = wraps.map(derefAll)

  return {
    href: href === 0 ? undefined : href,
    size,
    warnings: [],
    rules: rules.map(rule => decodeRule(rule, deref, derefAll, wrapChains)),
  }
}

function decodeRule(
  compact: CompactRule,
  deref: (value: PooledString) => string,
  derefAll: (values: PooledString[]) => string[],
  wrapChains: string[][],
): CompiledRule {
  const flags = compact[0] as number
  let cursor = 1
  const next = <T>(): T => compact[cursor++] as T
  const rule: CompiledRule = {}

  if (flags & F_SELECTORS) {
    const selectors = next<PooledString | PooledString[]>()
    rule.selectors = Array.isArray(selectors) ? derefAll(selectors) : [deref(selectors)]
    rule.body = deref(next<PooledString>())
  }
  if (flags & F_CSS) {
    rule.css = deref(next<PooledString>())
  }
  if (flags & F_MATCH) {
    rule.match = next<CompactMatch[]>().map((condition, index) => decodeMatch(condition, rule.selectors?.[index], deref, derefAll))
  }
  if (flags & F_ALWAYS) {
    rule.always = true
  }
  if (flags & F_WRAP) {
    rule.wrap = wrapChains[next<number>()]!
  }
  if (flags & F_FONTS_USED) {
    rule.fontsUsed = derefAll(next<PooledString[]>())
  }
  if (flags & F_KEYFRAMES_USED) {
    rule.keyframesUsed = derefAll(next<PooledString[]>())
  }
  if (flags & F_FONT_FACE) {
    const [family, src, ranges] = next<[PooledString | 0, PooledString | 0, number[]?]>()
    rule.fontFace = {
      family: family === 0 ? undefined : deref(family),
      src: src === 0 ? undefined : deref(src),
      ranges,
    }
  }
  if (flags & F_KEYFRAMES) {
    rule.keyframes = deref(next<PooledString>())
  }

  return rule
}

function decodeMatch(
  compact: CompactMatch,
  selector: string | undefined,
  deref: (value: PooledString) => string,
  derefAll: (values: PooledString[]) => string[],
): SelectorMatch {
  if (compact === M_TRUE) {
    return true
  }
  if (compact === M_CLASS) {
    return { classes: [selector!.slice(1)] }
  }
  if (compact === M_ID) {
    return { ids: [selector!.slice(1)] }
  }
  if (compact === M_TAG) {
    return { tags: [selector!.toLowerCase()] }
  }
  // only a program's first slot is a string (its combinator sequence)
  if (typeof compact[0] === 'string') {
    return { program: decodeProgram(compact as CompactProgram, deref, derefAll) }
  }

  const [classes, ids, tags, attrs] = compact as CompactTokens
  const condition: TokenCondition = {}
  if (classes !== 0) {
    condition.classes = derefAll(classes)
  }
  if (ids !== 0) {
    condition.ids = derefAll(ids)
  }
  if (tags !== 0) {
    condition.tags = derefAll(tags)
  }
  if (attrs !== 0) {
    condition.attrs = derefAll(attrs)
  }
  return condition
}

function decodeProgram(
  compact: CompactProgram,
  deref: (value: PooledString) => string,
  derefAll: (values: PooledString[]) => string[],
): StructuralProgram {
  const [combinators, compounds] = compact
  return {
    combinators: [...combinators] as StructuralProgram['combinators'],
    compounds: compounds.map(compound => decodeCompound(compound, deref, derefAll)),
  }
}

function decodeCompound(
  compact: CompactCompound,
  deref: (value: PooledString) => string,
  derefAll: (values: PooledString[]) => string[],
): CompoundTest {
  if (!Array.isArray(compact)) {
    return { classes: [deref(compact)] }
  }

  const [tag, classes, ids, attrs] = compact
  const compound: CompoundTest = {}
  if (tag !== 0) {
    compound.tag = deref(tag)
  }
  if (classes !== 0) {
    compound.classes = derefAll(classes)
  }
  if (ids !== 0) {
    compound.ids = derefAll(ids)
  }
  if (attrs !== 0) {
    compound.attrs = attrs.map(([name, action, value, ignoreCase]: CompactAttr): AttrTest => {
      const test: AttrTest = { name: deref(name), action: ATTR_ACTIONS[action]! }
      if (value !== 0) {
        test.value = deref(value)
      }
      if (ignoreCase) {
        test.ignoreCase = true
      }
      return test
    })
  }
  return compound
}
