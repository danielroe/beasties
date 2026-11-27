const quotedPattern = /(?<!\\)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g
const quotedPlaceholderPattern = /"(\d+)"/g
const removePseudoClassesAndElementsPattern = /(?<!\\)::?[a-z-]+(?:\(.+\))?/gi
const implicitUniversalPattern = /([>+~])\s*(?!\1)([>+~])/g
const emptyCombinatorPattern = /([>+~])\s*(?=\1|$)/g
const leadingCombinatorPattern = /^\s*(?=[>+~])/
const removeTrailingCommasPattern = /\(\s*,|,\s*\)/g
const BEFORE_AFTER_PSEUDO_RE = /^::?(?:before|after)$/
const LEADING_MATCHES_ANY_RE = /^:(?:is|where)\(/i
const CSS_WHITESPACE_EDGES_RE = /^[ \t\n\f\r]+|[ \t\n\f\r]+$/g
const UNEVALUABLE_SELECTOR_ERROR_RE = /^(?:unknown pseudo-class|pseudo-elements are not supported)/i

/**
 * Whether a selector matching error means the selector is valid CSS that cannot
 * be evaluated statically (rather than a selector we failed to parse).
 */
export function isUnevaluableSelectorError(message: string): boolean {
  return UNEVALUABLE_SELECTOR_ERROR_RE.test(message)
}

/**
 * Selectors that are considered critical regardless of whether they match an element in the document.
 */
export function isAlwaysCriticalSelector(sel: string): boolean {
  sel = unwrapLeadingMatchesAny(sel)
  return (
    sel === ':root'
    || sel === 'html'
    || sel === 'body'
    || (sel[0] === ':' && BEFORE_AFTER_PSEUDO_RE.test(sel))
  )
}

function singleSelectorArgumentEnd(sel: string, start: number): number {
  let depth = 1
  let quote = ''
  for (let i = start; i < sel.length; i++) {
    const char = sel[i]!
    if (char === '\\') {
      i++
    }
    else if (quote) {
      if (char === quote) {
        quote = ''
      }
    }
    else if (char === '"' || char === '\'') {
      quote = char
    }
    else if (char === '(') {
      depth++
    }
    else if (char === ')' && --depth === 0) {
      return i
    }
    else if (char === ',' && depth === 1) {
      return -1
    }
  }
  return -1
}

/**
 * Replace a leading `:is()` or `:where()` holding a single selector with that
 * selector, which matches the same elements.
 */
function unwrapLeadingMatchesAny(sel: string): string {
  for (let match = LEADING_MATCHES_ANY_RE.exec(sel); match; match = LEADING_MATCHES_ANY_RE.exec(sel)) {
    const start = match[0].length
    const end = singleSelectorArgumentEnd(sel, start)
    if (end === -1) {
      break
    }
    sel = sel.slice(start, end).replace(CSS_WHITESPACE_EDGES_RE, '') + sel.slice(end + 1)
  }
  return sel
}

/**
 * Strip pseudo-classes and pseudo-elements from a selector so it can be
 * matched against the document, since we only care that the associated
 * elements exist. Quoted strings are kept as written.
 */
export function normalizeCssSelector(sel: string): string {
  const quoted: string[] = []
  return unwrapLeadingMatchesAny(sel.replace(quotedPattern, match => `"${quoted.push(match) - 1}"`))
    .replace(removePseudoClassesAndElementsPattern, '')
    .replace(removeTrailingCommasPattern, match => (match.includes('(') ? '(' : ')'))
    .replace(implicitUniversalPattern, '$1 * $2')
    .replace(emptyCombinatorPattern, '$1 *')
    .replace(leadingCombinatorPattern, '* ')
    .trim()
    .replace(quotedPlaceholderPattern, (match, index) => quoted[index] ?? match)
}
