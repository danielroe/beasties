/**
 * Font family parsing shared by the compiler, the runtime and the DOM-based
 * pipeline, so that families collected from `font-family` / `font`
 * declarations can be compared with `@font-face` families regardless of
 * quoting, escaping or case.
 */

const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer'])
const HEX_ESCAPE_RE = /\\([0-9a-f]{1,6})[\t\n\f\r ]?/gi
const CHAR_ESCAPE_RE = /\\(.)/g
const WHITESPACE_RE = /\s+/g
// a `font` shorthand's family list starts after the font-size, which may carry
// a `/line-height`. A size is a length or percentage, an absolute/relative size
// keyword, or a function; unitless numbers before it are weights, not sizes.
const FONT_SIZE_RE = /^(?:[+-]?(?:\d+|\d*\.\d+)(?:[a-z]+|%)|calc\(|var\()/i
const FONT_SIZE_KEYWORDS = new Set(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', 'smaller', 'larger'])

/** Case-fold, unquote and unescape a single family name for comparison */
export function normalizeFontFamily(family: string): string {
  let value = family.trim()
  const quote = value[0]
  if ((quote === '"' || quote === '\'') && value.endsWith(quote) && value.length > 1) {
    value = value.slice(1, -1)
  }
  value = value
    .replace(HEX_ESCAPE_RE, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(CHAR_ESCAPE_RE, '$1')
    .replace(WHITESPACE_RE, ' ')
    .trim()
  return value.toLowerCase()
}

/**
 * Extract normalized family names from the value of a `font-family` or `font`
 * declaration. CSS-wide keywords and system font shorthands yield no families.
 */
export function parseFontFamilies(prop: string, value: string): string[] {
  const isShorthand = prop.toLowerCase() === 'font'
  const segments = splitTopLevel(value)
  if (isShorthand) {
    const first = segments[0]
    if (first === undefined) {
      return []
    }
    const tail = shorthandFamily(first)
    if (tail === undefined) {
      return []
    }
    segments[0] = tail
  }

  const families: string[] = []
  for (const segment of segments) {
    const family = normalizeFontFamily(segment)
    if (family && !CSS_WIDE_KEYWORDS.has(family)) {
      families.push(family)
    }
  }
  return families
}

/**
 * The family portion of a `font` shorthand's first comma-separated segment, or
 * `undefined` when the segment has no font-size and so declares no family
 * (`font: inherit`, `font: menu`).
 */
function shorthandFamily(segment: string): string | undefined {
  const tokens = segment.trim().replace(/\s*\/\s*/g, '/').split(/\s+/)
  for (let i = 0; i < tokens.length; i++) {
    const size = tokens[i]!.split('/')[0]!
    if (FONT_SIZE_RE.test(size) || FONT_SIZE_KEYWORDS.has(size.toLowerCase())) {
      return tokens.slice(i + 1).join(' ')
    }
  }
  return undefined
}

/** Split a family list on top-level commas, ignoring those inside quotes or parens */
function splitTopLevel(value: string): string[] {
  const segments: string[] = []
  let start = 0
  let depth = 0
  let quote: string | undefined
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    if (quote) {
      if (char === '\\') {
        i++
      }
      else if (char === quote) {
        quote = undefined
      }
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
    }
    else if (char === '(') {
      depth++
    }
    else if (char === ')') {
      depth = Math.max(0, depth - 1)
    }
    else if (char === ',' && depth === 0) {
      segments.push(value.slice(start, i))
      start = i + 1
    }
  }
  segments.push(value.slice(start))
  return segments
}
