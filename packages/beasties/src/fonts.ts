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

const UNICODE_RANGE_RE = /^u\+([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?$/i
const UNICODE_WILDCARD_RE = /^u\+([0-9a-f]{0,5})(\?{1,6})$/i

/**
 * Parse a `unicode-range` descriptor into flattened `[start, end, ...]`
 * codepoint pairs, or `undefined` if any part of it isn't understood, in which
 * case callers must treat the face as covering everything.
 */
export function parseUnicodeRanges(value: string): number[] | undefined {
  const ranges: number[] = []
  for (const token of splitTopLevel(value)) {
    const part = token.trim()
    if (!part) {
      continue
    }
    const wildcard = UNICODE_WILDCARD_RE.exec(part)
    if (wildcard) {
      const prefix = wildcard[1]!
      const digits = wildcard[2]!.length
      if (prefix.length + digits > 6) {
        return undefined
      }
      ranges.push(
        Number.parseInt(prefix + '0'.repeat(digits), 16),
        Number.parseInt(prefix + 'f'.repeat(digits), 16),
      )
      continue
    }
    const range = UNICODE_RANGE_RE.exec(part)
    if (!range) {
      return undefined
    }
    const start = Number.parseInt(range[1]!, 16)
    const end = range[2] === undefined ? start : Number.parseInt(range[2], 16)
    if (end < start) {
      return undefined
    }
    ranges.push(start, end)
  }
  return ranges.length > 0 ? ranges : undefined
}

/**
 * Whether any of a document's codepoints falls inside a face's `unicode-range`.
 * Unknown ranges or unknown document text count as a match, so a face is only
 * excluded when its subset is provably unused.
 */
export function unicodeRangeUsed(ranges: number[] | undefined, chars: Set<number> | undefined): boolean {
  if (!ranges || !chars) {
    return true
  }
  for (const codepoint of chars) {
    for (let i = 0; i < ranges.length; i += 2) {
      if (codepoint >= ranges[i]! && codepoint <= ranges[i + 1]!) {
        return true
      }
    }
  }
  return false
}

const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/iy
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: '\'',
  gt: '>',
  lt: '<',
  nbsp: '\u00A0',
  quot: '"',
}

/**
 * Codepoints seen in a document's text. BMP codepoints are marked in a flat
 * byte table because collecting them character by character is hot enough for
 * `Set` operations to show up in scan timings.
 */
export interface TextCodepoints {
  bmp: Uint8Array
  astral: Set<number>
  /** Whether all of the text could be decoded */
  complete: boolean
}

export function createTextCodepoints(): TextCodepoints {
  return { bmp: new Uint8Array(0x10000), astral: new Set(), complete: true }
}

/** Materialize collected codepoints, or `undefined` if some text was undecodable */
export function toCodepointSet(text: TextCodepoints): Set<number> | undefined {
  if (!text.complete) {
    return undefined
  }
  const chars = new Set<number>(text.astral)
  for (let codepoint = 0; codepoint < text.bmp.length; codepoint++) {
    if (text.bmp[codepoint]) {
      chars.add(codepoint)
    }
  }
  return chars
}

/**
 * Add the codepoints of a run of (possibly entity-encoded) HTML text. An
 * entity that can't be decoded clears `complete`, since the document then
 * contains characters we can't account for.
 */
export function addTextCodepoints(text: string, into: TextCodepoints): void {
  const { bmp } = into
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 0x26 /* & */) {
      ENTITY_RE.lastIndex = index
      const entity = ENTITY_RE.exec(text)
      if (entity) {
        const body = entity[1]!
        if (body[0] === '#') {
          const codepoint = body[1] === 'x' || body[1] === 'X'
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10)
          if (codepoint >= 0 && codepoint <= 0xFFFF) {
            bmp[codepoint] = 1
          }
          else if (codepoint > 0xFFFF && codepoint <= 0x10FFFF) {
            into.astral.add(codepoint)
          }
        }
        else {
          const decoded = NAMED_ENTITIES[body.toLowerCase()]
          if (decoded) {
            bmp[decoded.charCodeAt(0)] = 1
          }
          else {
            into.complete = false
          }
        }
        index = ENTITY_RE.lastIndex - 1
        continue
      }
    }
    if (code >= 0xD800 && code <= 0xDBFF && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1)
      if (low >= 0xDC00 && low <= 0xDFFF) {
        into.astral.add((code - 0xD800) * 0x400 + low - 0xDC00 + 0x10000)
        index++
        continue
      }
    }
    bmp[code] = 1
  }
}

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
