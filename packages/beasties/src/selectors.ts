const removePseudoClassesAndElementsPattern = /(?<!\\)::?[a-z-]+(?:\(.+\))?/gi
const implicitUniversalPattern = /([>+~])\s*(?!\1)([>+~])/g
const emptyCombinatorPattern = /([>+~])\s*(?=\1|$)/g
const removeTrailingCommasPattern = /\(\s*,|,\s*\)/g
const BEFORE_AFTER_PSEUDO_RE = /^::?(?:before|after)$/
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
  return (
    sel === ':root'
    || sel === 'html'
    || sel === 'body'
    || (sel[0] === ':' && BEFORE_AFTER_PSEUDO_RE.test(sel))
  )
}

/**
 * Strip pseudo-classes and pseudo-elements from a selector so it can be
 * matched against the document, since we only care that the associated
 * elements exist.
 */
export function normalizeCssSelector(sel: string): string {
  return sel
    .replace(removePseudoClassesAndElementsPattern, '')
    .replace(removeTrailingCommasPattern, match => (match.includes('(') ? '(' : ')'))
    .replace(implicitUniversalPattern, '$1 * $2')
    .replace(emptyCombinatorPattern, '$1 *')
    .trim()
}
