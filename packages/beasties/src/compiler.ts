/**
 * Build-time compiler for beasties.
 *
 * Compiles a CSS stylesheet into a JSON-serializable plan that the zero-dependency
 * runtime (`beasties/runtime`) can evaluate against rendered HTML. All parsing
 * (postcss, css-what), selector normalization, comment-marker handling and
 * minification happens here, ahead of time.
 */

import type { Selector } from 'css-what'
import type { AtRule, Container, Rule } from 'postcss'
import { parse as parseSelectorAst } from 'css-what'
import { parseStylesheet, serializeStylesheet } from './css'
import { CRITTERS_DEPRECATION_WARNING, parseDirective } from './directives'
import { isAlwaysCriticalSelector, normalizeCssSelector } from './selectors'
import { resolveCssUrl, rewriteCssUrls } from './urls'

export type { CompactPlan } from './plan'
export { encodePlan } from './plan-encode'

const FONT_FAMILY_RE = /\bfont(?:-family)?\b/i
const WHITESPACE_RE = /\s+/
// eslint-disable-next-line regexp/no-super-linear-backtracking,regexp/no-misleading-capturing-group
const URL_RE = /url\s*\(\s*(['"]?)(.+?)\1\s*\)/

const COMBINATOR_TOKENS: Record<string, Combinator> = {
  descendant: ' ',
  child: '>',
  adjacent: '+',
  sibling: '~',
}

const SUPPORTED_ATTR_ACTIONS = new Set(['exists', 'equals', 'element', 'start', 'end', 'any', 'hyphen'])

/**
 * Tokens which must all be present in the document for a selector to
 * possibly match. This is a necessary (not sufficient) condition: selectors
 * with combinators may be kept even though they don't match structurally.
 *
 * When `program` is present, the runtime evaluates it for an exact structural
 * match during its scan pass, and the token fields serve only as a fallback
 * for scans that did not evaluate programs.
 */
export interface TokenCondition {
  classes?: string[]
  ids?: string[]
  tags?: string[]
  attrs?: string[]
  program?: StructuralProgram
}

export interface AttrTest {
  name: string
  action: 'exists' | 'equals' | 'element' | 'start' | 'end' | 'any' | 'hyphen'
  value?: string
  ignoreCase?: boolean
}

/** A single compound selector (no combinators); empty object matches any element */
export interface CompoundTest {
  tag?: string
  ids?: string[]
  classes?: string[]
  attrs?: AttrTest[]
}

export type Combinator = ' ' | '>' | '+' | '~'

/**
 * A compiled selector for exact structural matching in a single streaming
 * pass: `compounds` are separated by `combinators` (one fewer than compounds).
 */
export interface StructuralProgram {
  compounds: CompoundTest[]
  combinators: Combinator[]
}

/** `true` means the selector is always critical. */
export type SelectorMatch = TokenCondition | true

export interface CompiledRule {
  /** Pre-serialized css text for atomic rules (at-rules, nested rules, markers) */
  css?: string
  /** Selector list, parallel to `match`, for rules whose selectors can be subset at runtime */
  selectors?: string[]
  /** Pre-serialized `{...}` body for `selectors` */
  body?: string
  /** Per-selector conditions (parallel to `selectors`), or rule-level conditions for atomic rules */
  match?: SelectorMatch[]
  /** Rule is always critical (markers, @import, etc.) */
  always?: true
  /** Chain of enclosing at-rule wrappers, each ending with `{` */
  wrap?: string[]
  /** Font-family values referenced by this rule's declarations */
  fontsUsed?: string[]
  /** Animation names referenced by this rule's declarations */
  keyframesUsed?: string[]
  /** This rule is an @font-face */
  fontFace?: { family?: string, src?: string }
  /** This rule is a @keyframes block with this name */
  keyframes?: string
}

export interface CompiledSheet {
  href?: string
  rules: CompiledRule[]
  /** Total size in bytes of the source stylesheet, for stats/thresholds */
  size: number
  warnings: string[]
}

export interface CompileOptions {
  /** Identifier used to match this sheet against `<link>` hrefs at runtime */
  href?: string
  /**
   * Always include rules matching these selectors or patterns in the critical CSS.
   */
  allowRules?: Array<string | RegExp>
  /**
   * Use PostCSS safe parser for fault-tolerant CSS parsing _(default: `true`)_
   */
  safeParser?: boolean
  /**
   * Compile selectors that need structural matching (combinators, compound
   * co-occurrence, attribute values) into match programs the runtime evaluates
   * exactly during its scan pass _(default: `true`)_.
   *
   * When disabled, such selectors fall back to token presence checks, which
   * are cheaper but may over-inline rules whose parts all exist in the
   * document without matching structurally.
   */
  exact?: boolean
}

interface MarkerState {
  includeNext: boolean
  excludeNext: boolean
  includeAll: boolean
  excludeAll: boolean
  warnedCritters: boolean
}

export function compileSheet(css: string, options: CompileOptions = {}): CompiledSheet {
  const ast = parseStylesheet(css, { safeParser: options.safeParser !== false })
  // once inlined, relative `url()` references resolve against the document
  // rather than the stylesheet they came from, so they are rebased up front
  const rebase = options.href
    ? (text: string) => rewriteCssUrls(text, options.href!)
    : (text: string) => text
  const sheet: CompiledSheet = {
    href: options.href,
    rules: [],
    size: css.length,
    warnings: [],
  }
  const state: MarkerState = {
    includeNext: false,
    excludeNext: false,
    includeAll: false,
    excludeAll: false,
    warnedCritters: false,
  }

  walk(ast, [], sheet, state, options, rebase)

  return sheet
}

type Rebase = (text: string) => string

function walk(container: Container, wrap: string[], sheet: CompiledSheet, state: MarkerState, options: CompileOptions, rebase: Rebase) {
  for (const node of container.nodes ?? []) {
    if (node.type === 'comment') {
      const { command, deprecated, warning } = parseDirective(node.text)
      if (warning) {
        sheet.warnings.push(warning)
      }
      if (deprecated && !state.warnedCritters) {
        state.warnedCritters = true
        sheet.warnings.push(CRITTERS_DEPRECATION_WARNING)
      }
      if (command) {
        switch (command) {
          case 'include':
            state.includeNext = true
            break
          case 'exclude':
            state.excludeNext = true
            break
          case 'include start':
            state.includeAll = true
            break
          case 'include end':
            state.includeAll = false
            break
          case 'exclude start':
            state.excludeAll = true
            break
          case 'exclude end':
            state.excludeAll = false
            break
        }
      }
      continue
    }

    if (node.type === 'rule') {
      compileRule(node, wrap, sheet, state, options, rebase)
      continue
    }

    if (node.type === 'atrule') {
      compileAtRule(node, wrap, sheet, state, options, rebase)
    }
  }
}

function compileRule(rule: Rule, wrap: string[], sheet: CompiledSheet, state: MarkerState, options: CompileOptions, rebase: Rebase) {
  if (state.includeNext) {
    state.includeNext = false
    // marker-included rules don't contribute font/keyframe usage
    sheet.rules.push(withWrap({ css: rebase(serializeStylesheet(rule, { compress: true })), always: true }, wrap))
    return
  }
  if (state.excludeNext) {
    state.excludeNext = false
    return
  }
  if (state.includeAll) {
    sheet.rules.push(withWrap({ css: rebase(serializeStylesheet(rule, { compress: true })), always: true }, wrap))
    return
  }
  if (state.excludeAll) {
    return
  }

  const selectors: string[] = []
  const match: SelectorMatch[] = []

  for (const sel of rule.selectors) {
    const condition = compileSelector(sel, sheet, options)
    if (condition === false) {
      continue
    }
    selectors.push(sel)
    match.push(condition)
  }

  if (selectors.length === 0) {
    return
  }

  const compiled: CompiledRule = { selectors, match }

  const hasNested = rule.nodes?.some(n => n.type === 'rule' || n.type === 'atrule')
  if (hasNested) {
    // CSS nesting: treat the rule as atomic, matched on its top-level selectors
    compiled.css = rebase(serializeStylesheet(rule, { compress: true }))
    delete compiled.selectors
    compiled.match = match
  }
  else {
    const original = rule.selector
    rule.selector = '\0'
    const text = serializeStylesheet(rule, { compress: true })
    rule.selector = original
    compiled.body = rebase(text.slice(text.indexOf('\0') + 1))
  }

  collectDependencies(rule, compiled)

  sheet.rules.push(withWrap(compiled, wrap))
}

function compileAtRule(rule: AtRule, wrap: string[], sheet: CompiledSheet, state: MarkerState, options: CompileOptions, rebase: Rebase) {
  const name = rule.name

  if (name === 'keyframes' || name === '-webkit-keyframes') {
    sheet.rules.push(withWrap({
      css: rebase(serializeStylesheet(rule, { compress: true })),
      keyframes: rule.params,
    }, wrap))
    return
  }

  if (name === 'font-face') {
    let family: string | undefined
    let src: string | undefined
    for (const decl of rule.nodes ?? []) {
      if (!('prop' in decl))
        continue
      if (decl.prop === 'src') {
        src = (decl.value.match(URL_RE) || [])[2]
      }
      else if (decl.prop === 'font-family') {
        family = decl.value
      }
    }
    sheet.rules.push(withWrap({
      css: rebase(serializeStylesheet(rule, { compress: true })),
      fontFace: { family, src: src && options.href ? resolveCssUrl(src.trim(), options.href) : src },
    }, wrap))
    return
  }

  const hasNestedRules = rule.nodes?.some(n => n.type === 'rule' || n.type === 'atrule')

  if (hasNestedRules) {
    const open = `@${name}${rule.raws.afterName ?? ' '}${rule.params}${rule.raws.between ?? ''}{`
    const childWrap = [...wrap, open]
    if (name === 'layer') {
      // @layer blocks establish cascade order, so they're preserved even when
      // all their rules are pruned; this marker forces the wrapper to be emitted
      sheet.rules.push({ css: '', always: true, wrap: childWrap })
    }
    walk(rule, childWrap, sheet, state, options, rebase)
    return
  }

  // statement at-rules (@import, @charset, @namespace, `@layer a, b;`, ...)
  // need an explicit terminator as they're serialized standalone
  let css = rebase(serializeStylesheet(rule, { compress: true }))
  if (!css.endsWith(';')) {
    css += ';'
  }
  sheet.rules.push(withWrap({ css, always: true }, wrap))
}

function compileSelector(sel: string, sheet: CompiledSheet, options: CompileOptions): SelectorMatch | false {
  const isAllowedRule = options.allowRules?.some((exp) => {
    if (exp instanceof RegExp) {
      return exp.test(sel)
    }
    return exp === sel
  })
  if (isAllowedRule) {
    return true
  }

  if (isAlwaysCriticalSelector(sel)) {
    return true
  }

  const normalized = normalizeCssSelector(sel)
  if (!normalized) {
    return false
  }

  let parsed
  try {
    parsed = parseSelectorAst(normalized)
  }
  catch (e) {
    sheet.warnings.push(`${normalized} -> ${(e as Error).message || String(e)}`)
    return false
  }

  const condition: TokenCondition = {}
  let simpleTokens = 0
  let compounds = 1
  let hasValuedAttr = false
  for (const token of parsed.flat()) {
    if (token.type === 'attribute') {
      simpleTokens++
      if (token.name === 'class' && (token.action === 'element' || token.action === 'equals')) {
        for (const cls of token.value.split(WHITESPACE_RE)) {
          if (cls)
            (condition.classes ??= []).push(cls)
        }
      }
      else if (token.name === 'id' && token.action === 'equals') {
        (condition.ids ??= []).push(token.value)
      }
      else {
        if (token.action !== 'exists') {
          hasValuedAttr = true
        }
        (condition.attrs ??= []).push(token.name.toLowerCase())
      }
    }
    else if (token.type === 'tag') {
      simpleTokens++;
      (condition.tags ??= []).push(token.name.toLowerCase())
    }
    else if (token.type in COMBINATOR_TOKENS) {
      compounds++
    }
  }

  if (!condition.classes && !condition.ids && !condition.tags && !condition.attrs) {
    return true
  }

  // a single simple token is exactly decided by document-level presence
  if (compounds === 1 && simpleTokens === 1 && !hasValuedAttr) {
    return condition
  }

  if (options.exact !== false && parsed.length === 1) {
    const program = buildProgram(parsed[0]!)
    if (program) {
      condition.program = program
    }
  }

  return condition
}

function buildProgram(tokens: Selector[]): StructuralProgram | null {
  const compounds: CompoundTest[] = []
  const combinators: Combinator[] = []
  let current: CompoundTest = {}

  for (const token of tokens) {
    if (token.type === 'universal') {
      continue
    }
    if (token.type in COMBINATOR_TOKENS) {
      compounds.push(current)
      combinators.push(COMBINATOR_TOKENS[token.type]!)
      current = {}
      continue
    }
    if (token.type === 'tag') {
      current.tag = token.name.toLowerCase()
      continue
    }
    if (token.type === 'attribute') {
      if (token.name === 'class' && token.action === 'element') {
        (current.classes ??= []).push(token.value)
        continue
      }
      if (token.name === 'id' && token.action === 'equals') {
        (current.ids ??= []).push(token.value)
        continue
      }
      if (!SUPPORTED_ATTR_ACTIONS.has(token.action)) {
        return null
      }
      (current.attrs ??= []).push({
        name: token.name.toLowerCase(),
        action: token.action as AttrTest['action'],
        value: token.value,
        ignoreCase: token.ignoreCase === true || undefined,
      })
      continue
    }
    return null
  }

  compounds.push(current)
  return { compounds, combinators }
}

function collectDependencies(rule: Rule, compiled: CompiledRule) {
  for (const decl of rule.nodes ?? []) {
    if (!('prop' in decl)) {
      continue
    }
    if (FONT_FAMILY_RE.test(decl.prop)) {
      (compiled.fontsUsed ??= []).push(decl.value)
    }
    if (decl.prop === 'animation' || decl.prop === 'animation-name') {
      for (const name of decl.value.split(WHITESPACE_RE)) {
        const trimmed = name.trim()
        if (trimmed)
          (compiled.keyframesUsed ??= []).push(trimmed)
      }
    }
  }
}

function withWrap(rule: CompiledRule, wrap: string[]): CompiledRule {
  if (wrap.length > 0) {
    rule.wrap = wrap
  }
  return rule
}
