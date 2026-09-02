/**
 * Zero-dependency runtime for beasties.
 *
 * Consumes plans produced by `beasties/compiler` and evaluates them against
 * rendered HTML using a single-pass token scanner (no DOM, no CSS parser).
 * Selectors compiled to structural programs are matched exactly during the
 * same pass, using the open-element stack for ancestor/sibling context.
 * Suitable for per-request use in a server runtime (Nitro, workers, etc.).
 */

import type { AttrTest, CompiledRule, CompiledSheet, CompoundTest, SelectorMatch, StructuralProgram } from './compiler'
import type { CompactPlan } from './plan'
import { normalizeFontFamily } from './fonts'
import { isSafeMediaValue } from './media'
import { isCompactPlan } from './plan'
import { decodePlan } from './plan-decode'

export type { CompactPlan }
export { decodePlan }

export interface DocumentTokens {
  tags: Set<string>
  classes: Set<string>
  ids: Set<string>
  attrs: Set<string>
  /** Exact results for structural programs evaluated during the scan */
  matchedPrograms?: Map<StructuralProgram, boolean>
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'xmp'])

const TAG_START_RE = /[a-z]/
const TAG_NAME_END_RE = /[\s/>]/
const ATTR_NAME_END_RE = /[\s=/>]/
const WHITESPACE_RE = /\s/
const CLASS_SPLIT_RE = /\s+/

function createTokens(): DocumentTokens {
  return {
    tags: new Set(),
    classes: new Set(),
    ids: new Set(),
    attrs: new Set(),
  }
}

interface ScannedElement {
  tag: string
  id: string | null
  classes: string[]
  attrs: Array<[name: string, value: string | null]>
}

/**
 * Flattened structural programs, prepared for evaluation. Positions are
 * indices into `flat`; a program matches when its final compound matches.
 *
 * In avail/candidate lists, positions are encoded as `position << 1 | flag`,
 * where the flag records whether every element matched so far sits strictly
 * inside a beasties container (classic css-select bounds the whole selector,
 * ancestors included, to the container subtree).
 */
interface PreparedPrograms {
  programs: StructuralProgram[]
  flat: Array<{ test: CompoundTest, edge: ' ' | '>' | '+' | '~' | null, last: boolean, program: number }>
  /** anchor indices: start positions looked up by a token of their first compound */
  byClass: Map<string, number[]>
  byId: Map<string, number[]>
  byTag: Map<string, number[]>
  byAttr: Map<string, number[]>
  universal: number[]
}

function preparePrograms(programs: StructuralProgram[]): PreparedPrograms {
  const prepared: PreparedPrograms = {
    programs,
    flat: [],
    byClass: new Map(),
    byId: new Map(),
    byTag: new Map(),
    byAttr: new Map(),
    universal: [],
  }

  for (let p = 0; p < programs.length; p++) {
    const { compounds, combinators } = programs[p]!
    const start = prepared.flat.length
    for (let c = 0; c < compounds.length; c++) {
      prepared.flat.push({
        test: compounds[c]!,
        edge: combinators[c] ?? null,
        last: c === compounds.length - 1,
        program: p,
      })
    }
    const first = compounds[0]!
    if (first.classes?.length) {
      pushIndex(prepared.byClass, first.classes[0]!, start)
    }
    else if (first.ids?.length) {
      pushIndex(prepared.byId, first.ids[0]!, start)
    }
    else if (first.tag) {
      pushIndex(prepared.byTag, first.tag, start)
    }
    else if (first.attrs?.length) {
      pushIndex(prepared.byAttr, first.attrs[0]!.name, start)
    }
    else {
      prepared.universal.push(start)
    }
  }

  return prepared
}

function pushIndex(map: Map<string, number[]>, key: string, position: number) {
  const list = map.get(key)
  if (list) {
    list.push(position)
  }
  else {
    map.set(key, [position])
  }
}

function getAttrValue(element: ScannedElement, name: string): string | undefined {
  for (const [attrName, value] of element.attrs) {
    if (attrName === name) {
      return value ?? ''
    }
  }
  return undefined
}

function matchesAttr(test: AttrTest, element: ScannedElement): boolean {
  let value = getAttrValue(element, test.name)
  if (value === undefined) {
    return false
  }
  if (test.action === 'exists') {
    return true
  }
  let expected = test.value ?? ''
  if (test.ignoreCase) {
    value = value.toLowerCase()
    expected = expected.toLowerCase()
  }
  switch (test.action) {
    case 'equals':
      return value === expected
    case 'element':
      return expected.length > 0 && value.split(CLASS_SPLIT_RE).includes(expected)
    case 'start':
      return expected.length > 0 && value.startsWith(expected)
    case 'end':
      return expected.length > 0 && value.endsWith(expected)
    case 'any':
      return expected.length > 0 && value.includes(expected)
    case 'hyphen':
      return value === expected || value.startsWith(`${expected}-`)
  }
  return false
}

function matchesCompound(test: CompoundTest, element: ScannedElement): boolean {
  if (test.tag && test.tag !== element.tag) {
    return false
  }
  if (test.ids) {
    for (const id of test.ids) {
      if (element.id !== id) {
        return false
      }
    }
  }
  if (test.classes) {
    for (const cls of test.classes) {
      if (!element.classes.includes(cls)) {
        return false
      }
    }
  }
  if (test.attrs) {
    for (const attr of test.attrs) {
      if (!matchesAttr(attr, element)) {
        return false
      }
    }
  }
  return true
}

/**
 * Per-open-element matcher state, holding the program positions available to
 * this element's children and later siblings.
 */
interface ScanFrame {
  /** this element is (or is inside) a beasties container */
  container: boolean
  /** positions reachable at any depth below (descendant edges) */
  desc: number[]
  /** positions reachable only by direct children (child edges) */
  child: number[]
  /** positions reachable only by the immediately-next child element */
  adjacent: number[]
  /** positions reachable by any later child element (general sibling edges) */
  sibling: number[]
}

function createFrame(container: boolean, desc: number[], child: number[]): ScanFrame {
  return { container, desc, child, adjacent: [], sibling: [] }
}

/**
 * Scan HTML in a single pass, collecting the tag names, class names, ids and
 * attribute names present in the document, and evaluating any structural
 * programs against it. If `data-beasties-container` elements are present,
 * only tokens (and program completions) within those subtrees count.
 */
export function scanHtml(html: string, programs?: StructuralProgram[]): DocumentTokens {
  const lower = html.toLowerCase()
  const all = createTokens()
  const contained = createTokens()

  const prepared = programs && programs.length > 0 ? preparePrograms(programs) : undefined
  const matchedAll = prepared ? Array.from<boolean>({ length: prepared.programs.length }).fill(false) : []
  const matchedContained = prepared ? Array.from<boolean>({ length: prepared.programs.length }).fill(false) : []
  const candidateSet = new Set<number>()

  let containerFound = false
  const frames: ScanFrame[] = [createFrame(false, [], [])]

  let i = 0
  const length = html.length

  while (i < length) {
    i = lower.indexOf('<', i)
    if (i === -1) {
      break
    }

    const next = lower[i + 1]

    if (next === '/') {
      const end = lower.indexOf('>', i)
      if (end === -1) {
        break
      }
      if (frames.length > 1) {
        frames.pop()
      }
      i = end + 1
      continue
    }

    if (next === '!') {
      if (lower.startsWith('<!--', i)) {
        const end = lower.indexOf('-->', i + 4)
        i = end === -1 ? length : end + 3
      }
      else {
        const end = lower.indexOf('>', i)
        i = end === -1 ? length : end + 1
      }
      continue
    }

    if (next === '?') {
      const end = lower.indexOf('>', i)
      i = end === -1 ? length : end + 1
      continue
    }

    if (!next || !TAG_START_RE.test(next)) {
      i++
      continue
    }

    // parse tag name
    let pos = i + 1
    while (pos < length && !TAG_NAME_END_RE.test(lower[pos]!)) {
      pos++
    }
    const tagName = lower.slice(i + 1, pos)

    const element: ScannedElement = { tag: tagName, id: null, classes: [], attrs: [] }
    let isContainer = false
    let selfClosing = false

    // parse attributes
    while (pos < length) {
      while (pos < length && WHITESPACE_RE.test(lower[pos]!)) {
        pos++
      }
      if (lower[pos] === '/') {
        selfClosing = true
        pos++
        continue
      }
      if (lower[pos] === '>' || pos >= length) {
        break
      }
      selfClosing = false

      const nameStart = pos
      while (pos < length && !ATTR_NAME_END_RE.test(lower[pos]!)) {
        pos++
      }
      const attrName = lower.slice(nameStart, pos)
      let value: string | null = null

      while (pos < length && WHITESPACE_RE.test(lower[pos]!)) {
        pos++
      }
      if (lower[pos] === '=') {
        pos++
        while (pos < length && WHITESPACE_RE.test(lower[pos]!)) {
          pos++
        }
        const quote = lower[pos]
        if (quote === '"' || quote === '\'') {
          const valueEnd = lower.indexOf(quote, pos + 1)
          value = html.slice(pos + 1, valueEnd === -1 ? length : valueEnd)
          pos = valueEnd === -1 ? length : valueEnd + 1
        }
        else {
          const valueStart = pos
          while (pos < length && !WHITESPACE_RE.test(lower[pos]!) && lower[pos] !== '>') {
            pos++
          }
          value = html.slice(valueStart, pos)
        }
      }

      if (attrName) {
        element.attrs.push([attrName, value])
        if (attrName === 'data-beasties-container') {
          isContainer = true
          containerFound = true
        }
        else if (attrName === 'class' && value !== null) {
          for (const cls of value.trim().split(CLASS_SPLIT_RE)) {
            if (cls) {
              element.classes.push(cls)
            }
          }
        }
        else if (attrName === 'id' && value !== null) {
          element.id = value.trim() || null
        }
      }
    }

    const frame = frames[frames.length - 1]!
    const insideContainer = frame.container || isContainer

    collectElement(all, element)
    if (insideContainer) {
      collectElement(contained, element)
    }

    let descOut: number[] | undefined
    let childOut: number[] | undefined

    if (prepared) {
      // the container element itself doesn't participate in structural matching
      const strictlyInside = frame.container

      candidateSet.clear()
      for (const list of [frame.desc, frame.child, frame.adjacent, frame.sibling]) {
        for (const encoded of list) {
          candidateSet.add(encoded)
        }
      }
      addAnchoredStarts(candidateSet, prepared, element)

      const adjacentOut: number[] = []
      frame.adjacent = adjacentOut

      for (const encoded of candidateSet) {
        const position = encoded >> 1
        const compound = prepared.flat[position]!
        if (!matchesCompound(compound.test, element)) {
          continue
        }
        const chainContained = (encoded & 1) === 1 && strictlyInside
        if (compound.last) {
          matchedAll[compound.program] = true
          if (chainContained) {
            matchedContained[compound.program] = true
          }
          continue
        }
        const nextEncoded = ((position + 1) << 1) | (chainContained ? 1 : 0)
        switch (compound.edge) {
          case ' ':
            (descOut ??= []).push(nextEncoded)
            break
          case '>':
            (childOut ??= []).push(nextEncoded)
            break
          case '+':
            adjacentOut.push(nextEncoded)
            break
          case '~':
            frame.sibling.push(nextEncoded)
            break
        }
      }
    }
    else {
      frame.adjacent = []
    }

    const isVoid = VOID_ELEMENTS.has(tagName) || selfClosing
    const isRawText = RAW_TEXT_ELEMENTS.has(tagName)

    if (!isVoid && !isRawText) {
      frames.push(createFrame(
        insideContainer,
        descOut ? frame.desc.concat(descOut) : frame.desc,
        childOut ?? [],
      ))
    }

    i = lower[pos] === '>' ? pos + 1 : pos

    if (!isVoid && isRawText) {
      const close = lower.indexOf(`</${tagName}`, i)
      if (close === -1) {
        break
      }
      const end = lower.indexOf('>', close)
      i = end === -1 ? length : end + 1
    }
  }

  const tokens = containerFound ? contained : all
  if (prepared) {
    const matched = containerFound ? matchedContained : matchedAll
    tokens.matchedPrograms = new Map()
    for (let p = 0; p < prepared.programs.length; p++) {
      tokens.matchedPrograms.set(prepared.programs[p]!, matched[p]!)
    }
  }
  return tokens
}

function collectElement(tokens: DocumentTokens, element: ScannedElement) {
  tokens.tags.add(element.tag)
  if (element.id) {
    tokens.ids.add(element.id)
  }
  for (const cls of element.classes) {
    tokens.classes.add(cls)
  }
  for (const [name] of element.attrs) {
    tokens.attrs.add(name)
  }
}

// start positions are encoded with an optimistic contained flag; each element
// in the chain (this one included) then ANDs its own containment into it
function addAnchoredStarts(candidates: Set<number>, prepared: PreparedPrograms, element: ScannedElement) {
  for (const cls of element.classes) {
    const starts = prepared.byClass.get(cls)
    if (starts) {
      for (const position of starts) {
        candidates.add((position << 1) | 1)
      }
    }
  }
  if (element.id) {
    const starts = prepared.byId.get(element.id)
    if (starts) {
      for (const position of starts) {
        candidates.add((position << 1) | 1)
      }
    }
  }
  const tagStarts = prepared.byTag.get(element.tag)
  if (tagStarts) {
    for (const position of tagStarts) {
      candidates.add((position << 1) | 1)
    }
  }
  for (const [name] of element.attrs) {
    const starts = prepared.byAttr.get(name)
    if (starts) {
      for (const position of starts) {
        candidates.add((position << 1) | 1)
      }
    }
  }
  for (const position of prepared.universal) {
    candidates.add((position << 1) | 1)
  }
}

function matchesCondition(condition: SelectorMatch, tokens: DocumentTokens): boolean {
  if (condition === true) {
    return true
  }
  if (condition.program) {
    const exact = tokens.matchedPrograms?.get(condition.program)
    if (exact !== undefined) {
      return exact
    }
    // fall through to token checks when this program wasn't evaluated
  }
  if (condition.classes) {
    for (const cls of condition.classes) {
      if (!tokens.classes.has(cls)) {
        return false
      }
    }
  }
  if (condition.ids) {
    for (const id of condition.ids) {
      if (!tokens.ids.has(id)) {
        return false
      }
    }
  }
  if (condition.tags) {
    for (const tag of condition.tags) {
      if (!tokens.tags.has(tag)) {
        return false
      }
    }
  }
  if (condition.attrs) {
    for (const attr of condition.attrs) {
      if (!tokens.attrs.has(attr)) {
        return false
      }
    }
  }
  return true
}

/** Collect structural programs referenced by the compiled sheets */
export function collectPrograms(sheets: CompiledSheet[]): StructuralProgram[] {
  const programs: StructuralProgram[] = []
  for (const sheet of sheets) {
    for (const rule of sheet.rules) {
      if (!rule.match) {
        continue
      }
      for (const condition of rule.match) {
        if (condition !== true && condition.program) {
          programs.push(condition.program)
        }
      }
    }
  }
  return programs
}

export interface RuntimeOptions {
  /**
   * Controls which keyframes rules are inlined _(default: `'critical'`)_
   */
  keyframes?: 'critical' | 'all' | 'none' | boolean
  /**
   * Inline critical font-face rules _(default: `false`)_
   */
  inlineFonts?: boolean
  /**
   * Preload critical fonts _(default: `true` when `fonts` is set)_
   */
  preloadFonts?: boolean
  /**
   * Shorthand for setting `inlineFonts` + `preloadFonts`
   */
  fonts?: boolean
}

export interface CriticalResult {
  css: string
  /** Font URLs that should be preloaded */
  fontPreloads: string[]
  /**
   * The rules *not* inlined, i.e. what the external stylesheet still needs to
   * provide. Only populated when `inverse` is requested.
   */
  inverseCss?: string
}

/**
 * Evaluate a compiled sheet against scanned document tokens, producing the
 * critical CSS subset.
 */
export function renderCriticalCss(sheet: CompiledSheet, tokens: DocumentTokens, options: RuntimeOptions & { inverse?: boolean } = {}): CriticalResult {
  let keyframesMode = options.keyframes ?? 'critical'
  if (keyframesMode === true) {
    keyframesMode = 'all'
  }
  if (keyframesMode === false) {
    keyframesMode = 'none'
  }
  const shouldPreloadFonts = options.fonts === true || options.preloadFonts === true
  const shouldInlineFonts = options.fonts !== false && options.inlineFonts === true

  const rules = sheet.rules
  const texts: (string | null)[] = Array.from<string | null>({ length: rules.length }).fill(null)
  const inverseTexts: (string | null)[] | undefined = options.inverse
    ? Array.from<string | null>({ length: rules.length }).fill(null)
    : undefined

  const criticalFonts = new Set<string>()
  const criticalKeyframeNames = new Set<string>()
  const fontPreloads: string[] = []
  const preloadedFonts = new Set<string>()

  // first pass: style rules
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!
    if (rule.fontFace) {
      if (rule.fontFace.src && shouldPreloadFonts && !preloadedFonts.has(rule.fontFace.src)) {
        preloadedFonts.add(rule.fontFace.src)
        fontPreloads.push(rule.fontFace.src.trim())
      }
      continue
    }
    if (rule.keyframes !== undefined) {
      continue
    }

    const text = ruleText(rule, tokens)
    if (inverseTexts) {
      inverseTexts[i] = ruleText(rule, tokens, true)
    }
    if (text === null) {
      continue
    }
    texts[i] = text

    if (rule.fontsUsed) {
      for (const family of rule.fontsUsed) {
        criticalFonts.add(normalizeFontFamily(family))
      }
    }
    if (rule.keyframesUsed) {
      for (const name of rule.keyframesUsed) {
        criticalKeyframeNames.add(name)
      }
    }
  }

  // second pass: @font-face and @keyframes, using usage data from the first
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!
    if (rule.keyframes !== undefined) {
      const keep = keyframesMode !== 'none' && (keyframesMode === 'all' || criticalKeyframeNames.has(rule.keyframes))
      if (keep) {
        texts[i] = rule.css ?? ''
      }
      else if (inverseTexts) {
        inverseTexts[i] = rule.css ?? ''
      }
      continue
    }
    if (rule.fontFace) {
      const { family } = rule.fontFace
      if (shouldInlineFonts && family && criticalFonts.has(normalizeFontFamily(family))) {
        texts[i] = rule.css ?? ''
      }
      else if (inverseTexts) {
        inverseTexts[i] = rule.css ?? ''
      }
    }
  }

  const result: CriticalResult = { css: assemble(texts, rules), fontPreloads }
  if (inverseTexts) {
    result.inverseCss = assemble(inverseTexts, rules)
  }
  return result
}

/** Emit every rule in the sheet, as when a stylesheet is inlined in full */
export function renderFullCss(sheet: CompiledSheet): string {
  return assemble(sheet.rules.map(wholeRuleText), sheet.rules)
}

function wholeRuleText(rule: CompiledRule): string {
  if (rule.css !== undefined) {
    return rule.css
  }
  return rule.selectors ? rule.selectors.join(',') + rule.body! : ''
}

/** Join rule texts, opening and closing at-rule wrappers as needed */
function assemble(texts: (string | null)[], rules: CompiledRule[]): string {
  const out: string[] = []
  let openWrap: string[] = []
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    if (text == null) {
      continue
    }
    const wrap = rules[i]!.wrap ?? []
    let common = 0
    while (common < openWrap.length && common < wrap.length && openWrap[common] === wrap[common]) {
      common++
    }
    for (let j = openWrap.length; j > common; j--) {
      out.push('}')
    }
    for (let j = common; j < wrap.length; j++) {
      out.push(wrap[j]!)
    }
    openWrap = wrap
    out.push(text)
  }
  for (let j = openWrap.length; j > 0; j--) {
    out.push('}')
  }
  return out.join('')
}

/**
 * The rule's text as inlined, or `null` when it isn't. With `invert`, returns
 * the complement instead: what the external stylesheet still has to provide.
 */
function ruleText(rule: CompiledRule, tokens: DocumentTokens, invert = false): string | null {
  if (rule.always) {
    return invert ? null : wholeRuleText(rule)
  }
  if (!rule.match) {
    return invert ? null : rule.css ?? null
  }
  const body = rule.body
  if (rule.selectors && body !== undefined) {
    const kept = rule.selectors.filter((_, index) => matchesCondition(rule.match![index]!, tokens) !== invert)
    if (kept.length === 0) {
      return null
    }
    return kept.join(',') + body
  }
  if (rule.match.some(condition => matchesCondition(condition, tokens)) !== invert) {
    return rule.css ?? ''
  }
  return null
}

/**
 * The mechanism to use for lazy-loading stylesheets, mirroring the classic
 * beasties `preload` option.
 */
export type PreloadStrategy = 'body' | 'media' | 'media-script' | 'swap' | 'swap-high' | 'swap-low' | 'js' | 'js-lazy'

export interface ProcessorOptions extends RuntimeOptions {
  /**
   * Which preload strategy to use for the original stylesheet links.
   * _(default: move stylesheet links to the end of the document and insert preload links in their place)_
   */
  preload?: PreloadStrategy | false
  /**
   * Add `<noscript>` fallback to JS-based strategies _(default: `true`)_
   */
  noscriptFallback?: boolean
  /**
   * CSP nonce to set on every `<style>` and `<script>` element beasties
   * injects. A processor is typically long-lived and a nonce must be unique
   * per response, so pass it to `process()` instead unless it is genuinely
   * constant for the lifetime of the processor.
   */
  nonce?: string
  /**
   * Cache rendered critical CSS keyed by the set of tokens found in the
   * document, so pages with the same shape don't re-evaluate the compiled
   * sheets _(default: `true`, keeping up to 100 entries)_
   */
  cache?: boolean | { maxSize?: number }
  /**
   * Inline stylesheets smaller than this many bytes in full, dropping their
   * `<link>` entirely _(default: `0`, disabled)_
   */
  inlineThreshold?: number
  /**
   * If the rules left for the external stylesheet to provide would be below
   * this many bytes, inline the stylesheet in full instead and drop its
   * `<link>` _(default: `0`, disabled)_
   */
  minimumExternalSize?: number
  /**
   * Receives warnings, e.g. for `<link rel="stylesheet">` tags with no
   * matching compiled sheet _(default: no warnings are emitted)_
   */
  logger?: { warn?: (message: string) => void }
}

const DEFAULT_CACHE_SIZE = 100

/**
 * Fingerprint the scanned tokens. Token sets iterate in insertion order,
 * which is deterministic for a given document shape; a differently-ordered
 * but equal set only costs a cache miss, never a wrong hit.
 */
function fingerprintTokens(tokens: DocumentTokens): string {
  const parts: string[] = []
  for (const set of [tokens.tags, tokens.classes, tokens.ids, tokens.attrs]) {
    for (const token of set) {
      parts.push(token)
    }
    parts.push('\n')
  }
  if (tokens.matchedPrograms) {
    for (const matched of tokens.matchedPrograms.values()) {
      parts.push(matched ? '1' : '0')
    }
  }
  return parts.join(' ')
}

const CSS_HREF_RE = /\.css(?:[?#]|$)/i
const LINK_TAG_RE = /<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
const REL_STYLESHEET_RE = /\brel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet(?=[\s>]))/i
const REL_PRELOAD_RE = /\brel\s*=\s*(?:"preload"|'preload'|preload(?=[\s>]))/i
const AS_FONT_RE = /\bas\s*=\s*(?:"font"|'font'|font(?=[\s>]))/i

const CSS_LOADER_PREAMBLE = 'function $loadcss(u,m,l){(l=document.createElement(\'link\')).rel=\'stylesheet\';l.href=u;document.head.appendChild(l)}'
const CSS_LOADER_LAZY_PREAMBLE = CSS_LOADER_PREAMBLE.replace(
  'l.href',
  'l.media=\'print\';l.onload=function(){l.media=m};l.href',
)
const CSS_LOADER_INVOKE = '$loadcss(document.currentScript.dataset.href,document.currentScript.dataset.media)'

const DEFERRED_MEDIA_ATTR = 'data-beasties-media'
const DEFERRED_MEDIA_SCRIPT = `document.querySelectorAll('link[${DEFERRED_MEDIA_ATTR}]').forEach(function(l){l.media=l.getAttribute('${DEFERRED_MEDIA_ATTR}');l.removeAttribute('${DEFERRED_MEDIA_ATTR}')})`

function attrValueRegex(name: string): RegExp {
  return new RegExp(`(^|\\s)(${name})\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i')
}

function attrNameRegex(name: string): RegExp {
  return new RegExp(`(^|\\s)${name}(?=[\\s/>=])`, 'i')
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;')
}

/** Get a (raw, un-decoded) attribute value from a tag string */
function getAttr(tag: string, name: string): string | null {
  const match = tag.match(attrValueRegex(name))
  if (match) {
    const raw = match[3]!
    if (raw[0] === '"' || raw[0] === '\'') {
      return raw.slice(1, -1)
    }
    return raw
  }
  return attrNameRegex(name).test(tag) ? '' : null
}

/** Set an attribute in a tag string, replacing in place or appending before `>` */
function setAttr(tag: string, name: string, value: string): string {
  const valueRe = attrValueRegex(name)
  if (valueRe.test(tag)) {
    return tag.replace(valueRe, `$1$2="${escapeAttr(value)}"`)
  }
  const nameRe = attrNameRegex(name)
  if (nameRe.test(tag)) {
    return tag.replace(nameRe, `$1${name}="${escapeAttr(value)}"`)
  }
  if (!tag.endsWith('>')) {
    return tag
  }
  // scanned back rather than matched, since an anchored `/(\s*\/?)>$/` backtracks
  // quadratically over whitespace runs earlier in the tag
  let cut = tag.length - 1
  if (tag[cut - 1] === '/') {
    cut--
  }
  while (cut > 0 && WHITESPACE_RE.test(tag[cut - 1]!)) {
    cut--
  }
  return `${tag.slice(0, cut)} ${name}="${escapeAttr(value)}"${tag.slice(cut)}`
}

/** Remove an attribute from a tag string */
function removeAttr(tag: string, name: string): string {
  return tag
    .replace(attrValueRegex(name), '')
    .replace(attrNameRegex(name), '')
}

function toPreload(tag: string): string {
  return setAttr(setAttr(tag, 'rel', 'preload'), 'as', 'style')
}

// scanned rather than matched, since `/[?#].*$/` backtracks quadratically on a
// href with many `?`/`#` characters
function normalizeHref(href: string): string {
  const query = href.indexOf('?')
  const hash = href.indexOf('#')
  let end = href.length
  if (query !== -1) {
    end = query
  }
  if (hash !== -1 && hash < end) {
    end = hash
  }
  let start = 0
  if (href[0] === '.' && href[1] === '/') {
    start = 2
  }
  else if (href[0] === '/') {
    start = 1
  }
  return href.slice(start, end)
}

function sheetForHref(sheets: CompiledSheet[], href: string): CompiledSheet | undefined {
  const normalized = normalizeHref(href)
  return sheets.find((sheet) => {
    if (!sheet.href) {
      return false
    }
    const sheetHref = normalizeHref(sheet.href)
    return normalized === sheetHref || normalized.endsWith(`/${sheetHref}`)
  })
}

interface Edit {
  start: number
  end: number
  text: string
}

function applyEdits(html: string, edits: Edit[]): string {
  edits.sort((a, b) => a.start - b.start || a.end - b.end)
  let out = ''
  let cursor = 0
  for (const edit of edits) {
    if (edit.start < cursor) {
      continue
    }
    out += html.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return out + html.slice(cursor)
}

/**
 * Create a `process(html)` function which inlines critical CSS from the
 * compiled sheets into rendered HTML.
 */
export interface ProcessOptions {
  /**
   * CSP nonce to set on every `<style>` and `<script>` element injected into
   * this document, overriding any nonce given to `createProcessor`.
   */
  nonce?: string
}

export function createProcessor(plans: Array<CompiledSheet | CompactPlan>, options: ProcessorOptions = {}): {
  process: (html: string, processOptions?: ProcessOptions) => string
  extract: (html: string) => CriticalResult
} {
  const sheets = plans.map(plan => (isCompactPlan(plan) ? decodePlan(plan) : plan))
  const programs = collectPrograms(sheets)

  const cacheSize = options.cache === false ? 0 : (typeof options.cache === 'object' ? options.cache.maxSize ?? DEFAULT_CACHE_SIZE : DEFAULT_CACHE_SIZE)
  const cache = cacheSize > 0 ? new Map<string, Map<CompiledSheet, CriticalResult>>() : undefined

  // the inverse is only needed to compare against `minimumExternalSize`
  const renderOptions = { ...options, inverse: !!options.minimumExternalSize }
  const fullCssCache = new Map<CompiledSheet, string>()

  function fullCss(sheet: CompiledSheet): string {
    let css = fullCssCache.get(sheet)
    if (css === undefined) {
      css = renderFullCss(sheet)
      fullCssCache.set(sheet, css)
    }
    return css
  }

  /**
   * Whether the whole stylesheet should be inlined, making its `<link>`
   * unnecessary: either it is small enough outright, or what would be left for
   * it to serve is small enough that the request isn't worth saving.
   */
  function inlineInFull(sheet: CompiledSheet, critical: CriticalResult): boolean {
    if (options.inlineThreshold && sheet.size < options.inlineThreshold) {
      return true
    }
    if (options.minimumExternalSize && critical.inverseCss !== undefined) {
      return critical.inverseCss.length < options.minimumExternalSize
    }
    return false
  }

  function renderSheet(sheet: CompiledSheet, tokens: DocumentTokens, key: string | undefined): CriticalResult {
    if (!cache || key === undefined) {
      return renderCriticalCss(sheet, tokens, renderOptions)
    }
    let bySheet = cache.get(key)
    if (bySheet) {
      // refresh recency
      cache.delete(key)
      cache.set(key, bySheet)
    }
    else {
      bySheet = new Map()
      cache.set(key, bySheet)
      if (cache.size > cacheSize) {
        cache.delete(cache.keys().next().value!)
      }
    }
    let result = bySheet.get(sheet)
    if (!result) {
      result = renderCriticalCss(sheet, tokens, renderOptions)
      bySheet.set(sheet, result)
    }
    return result
  }

  function skippedSheets(html: string): Set<CompiledSheet> | undefined {
    let skipped: Set<CompiledSheet> | undefined
    for (const match of html.matchAll(LINK_TAG_RE)) {
      const tag = match[0]
      if (!REL_STYLESHEET_RE.test(tag) || getAttr(tag, 'data-beasties-skip') === null) {
        continue
      }
      const href = getAttr(tag, 'href')
      const sheet = href ? sheetForHref(sheets, href) : undefined
      if (sheet) {
        (skipped ??= new Set()).add(sheet)
      }
    }
    return skipped
  }

  function extract(html: string): CriticalResult {
    const tokens = scanHtml(html, programs)
    const key = cache ? fingerprintTokens(tokens) : undefined
    const skipped = skippedSheets(html)
    const css: string[] = []
    const fontPreloads: string[] = []
    for (const sheet of sheets) {
      if (skipped?.has(sheet)) {
        continue
      }
      const result = renderSheet(sheet, tokens, key)
      css.push(inlineInFull(sheet, result) ? fullCss(sheet) : result.css)
      fontPreloads.push(...result.fontPreloads)
    }
    return { css: css.join(''), fontPreloads }
  }

  function process(html: string, processOptions?: ProcessOptions): string {
    const tokens = scanHtml(html, programs)
    const key = cache ? fingerprintTokens(tokens) : undefined
    const strategy = options.preload
    const nonce = processOptions?.nonce ?? options.nonce
    const nonceAttr = nonce ? ` nonce="${escapeAttr(nonce)}"` : ''

    let firstLinkIndex = -1
    const edits: Edit[] = []
    const bodyAppends: string[] = []
    let deferredMedia = false
    const criticalParts: string[] = []
    const fontPreloads = new Set<string>()
    const existingFontPreloads = new Set<string>()
    let isFirstSheet = true

    for (const match of html.matchAll(LINK_TAG_RE)) {
      const tag = match[0]
      if (!REL_STYLESHEET_RE.test(tag)) {
        if (REL_PRELOAD_RE.test(tag) && AS_FONT_RE.test(tag)) {
          const preloaded = getAttr(tag, 'href')
          if (preloaded) {
            existingFontPreloads.add(preloaded)
          }
        }
        continue
      }
      if (getAttr(tag, 'data-beasties-skip') !== null) {
        continue
      }
      const href = getAttr(tag, 'href')
      if (!href) {
        continue
      }
      const sheet = sheetForHref(sheets, href)
      if (!sheet) {
        if (CSS_HREF_RE.test(href)) {
          options.logger?.warn?.(`Unable to locate stylesheet: ${href}`)
        }
        continue
      }

      const result = renderSheet(sheet, tokens, key)
      const wholeSheet = inlineInFull(sheet, result)
      criticalParts.push(wholeSheet ? fullCss(sheet) : result.css)
      for (const preload of result.fontPreloads) {
        fontPreloads.add(preload)
      }

      const start = match.index
      const end = start + tag.length
      if (firstLinkIndex === -1) {
        firstLinkIndex = start
      }

      if (wholeSheet) {
        // nothing left to load, so the link (and any loader for it) goes away
        edits.push({ start, end, text: '' })
        continue
      }

      if (strategy === false) {
        continue
      }

      const rawMedia = getAttr(tag, 'media')
      const media = rawMedia && isSafeMediaValue(rawMedia) ? rawMedia : undefined
      let newTag = tag
      let noscriptFallback = false
      let scriptAfter: string | undefined

      if (strategy === 'body') {
        bodyAppends.push(tag)
        newTag = ''
      }
      else if (strategy === 'media-script') {
        newTag = setAttr(setAttr(tag, 'media', 'print'), DEFERRED_MEDIA_ATTR, media || 'all')
        deferredMedia = true
        noscriptFallback = true
      }
      else if (strategy === 'media') {
        newTag = setAttr(setAttr(tag, 'media', 'print'), 'onload', `this.media='${media || 'all'}'`)
        noscriptFallback = true
      }
      else if (strategy === 'swap') {
        newTag = toPreload(setAttr(tag, 'onload', 'this.rel=\'stylesheet\''))
        noscriptFallback = true
      }
      else if (strategy === 'swap-high') {
        newTag = setAttr(setAttr(setAttr(setAttr(tag, 'rel', 'alternate stylesheet preload'), 'title', 'styles'), 'as', 'style'), 'onload', 'this.title=\'\';this.rel=\'stylesheet\'')
        noscriptFallback = true
      }
      else if (strategy === 'swap-low') {
        newTag = setAttr(setAttr(setAttr(tag, 'rel', 'alternate stylesheet'), 'title', 'styles'), 'onload', 'this.title=\'\';this.rel=\'stylesheet\'')
        noscriptFallback = true
      }
      else if (strategy === 'js' || strategy === 'js-lazy') {
        const preamble = isFirstSheet ? (strategy === 'js-lazy' ? CSS_LOADER_LAZY_PREAMBLE : CSS_LOADER_PREAMBLE) : ''
        scriptAfter = `<script${nonceAttr} data-href="${escapeAttr(href)}" data-media="${escapeAttr(media || 'all')}">${preamble}${CSS_LOADER_INVOKE}</script>`
        newTag = toPreload(tag)
        noscriptFallback = true
      }
      else {
        // default: preload link in place, stylesheet link moved to end of body
        bodyAppends.push(removeAttr(tag, 'id'))
        newTag = toPreload(tag)
      }

      if (
        options.noscriptFallback !== false
        && noscriptFallback
        // don't emit the URL inside <noscript> if it could terminate the block early
        && !href.includes('</noscript>')
      ) {
        edits.push({ start: end, end, text: `<noscript>${removeAttr(tag, 'id')}</noscript>` })
      }

      if (scriptAfter) {
        edits.push({ start: end, end, text: scriptAfter })
      }

      if (newTag !== tag) {
        edits.push({ start, end, text: newTag })
      }

      isFirstSheet = false
    }

    for (const preloaded of existingFontPreloads) {
      fontPreloads.delete(preloaded)
    }

    const critical = criticalParts.join('')
    if (!critical && fontPreloads.size === 0 && edits.length === 0 && bodyAppends.length === 0) {
      return html
    }

    const headInsertions: string[] = []
    for (const preload of fontPreloads) {
      headInsertions.push(`<link rel="preload" as="font" crossorigin="anonymous" href="${escapeAttr(preload)}">`)
    }
    if (critical) {
      headInsertions.push(`<style${nonceAttr}>${critical}</style>`)
    }

    if (deferredMedia) {
      bodyAppends.push(`<script${nonceAttr}>${DEFERRED_MEDIA_SCRIPT}</script>`)
    }

    if (headInsertions.length > 0) {
      let insertAt = firstLinkIndex
      if (insertAt === -1) {
        const headClose = html.match(/<\/head\s*>/i)
        insertAt = headClose?.index ?? 0
      }
      edits.push({ start: insertAt, end: insertAt, text: headInsertions.join('') })
    }

    if (bodyAppends.length > 0) {
      const bodyClose = lastIndexOfRe(html, /<\/body\s*>/gi)
      const insertAt = bodyClose === -1 ? html.length : bodyClose
      edits.push({ start: insertAt, end: insertAt, text: bodyAppends.join('') })
    }

    return applyEdits(html, edits)
  }

  return { process, extract }
}

function lastIndexOfRe(html: string, re: RegExp): number {
  let last = -1
  for (const match of html.matchAll(re)) {
    last = match.index
  }
  return last
}
