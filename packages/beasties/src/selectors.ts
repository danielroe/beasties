const BEFORE_AFTER_PSEUDO_RE = /^::?(?:before|after)$/
const LEADING_MATCHES_ANY_RE = /^:(?:is|where)\(/i
const PSEUDO_RE = /::?[a-z-]+/iy
const PSEUDO_OR_COMBINATOR_RE = /[:>+~]/
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

function isCssWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\f' || char === '\r'
}

function startsQuotedOrComment(sel: string, index: number): boolean {
  const char = sel[index]
  return char === '"' || char === '\'' || (char === '/' && sel[index + 1] === '*')
}

function quotedOrCommentEnd(sel: string, start: number): number {
  if (sel[start] === '/') {
    const close = sel.indexOf('*/', start + 2)
    return close === -1 ? sel.length : close + 2
  }
  for (let i = start + 1; i < sel.length; i++) {
    if (sel[i] === '\\') {
      i++
    }
    else if (sel[i] === sel[start]) {
      return i + 1
    }
  }
  return sel.length
}

function closingParenIndex(sel: string, start: number, singleSelector: boolean): number {
  let depth = 1
  for (let i = start; i < sel.length; i++) {
    const char = sel[i]!
    if (char === '\\') {
      i++
    }
    else if (startsQuotedOrComment(sel, i)) {
      i = quotedOrCommentEnd(sel, i) - 1
    }
    else if (char === '(') {
      depth++
    }
    else if (char === ')') {
      if (--depth === 0) {
        return i
      }
    }
    else if (char === ',' && depth === 1 && singleSelector) {
      return -1
    }
  }
  return -1
}

/**
 * Replace a leading `:is()` or `:where()` holding a single selector with that
 * selector, which matches the same elements. An empty argument matches
 * nothing, so the result is an empty selector.
 */
function unwrapLeadingMatchesAny(sel: string): string {
  while (sel[0] === ':') {
    const match = LEADING_MATCHES_ANY_RE.exec(sel)
    if (!match) {
      break
    }
    const start = match[0].length
    const end = closingParenIndex(sel, start, true)
    if (end === -1) {
      break
    }
    const inner = sel.slice(start, end).replace(CSS_WHITESPACE_EDGES_RE, '')
    if (!inner) {
      return ''
    }
    sel = inner + sel.slice(end + 1)
  }
  return sel
}

function pseudoEnd(sel: string, start: number): number {
  PSEUDO_RE.lastIndex = start
  const match = PSEUDO_RE.exec(sel)
  if (!match) {
    return start
  }
  const end = start + match[0].length
  if (sel[end] === '(') {
    const close = closingParenIndex(sel, end + 1, false)
    if (close !== -1) {
      return close + 1
    }
  }
  return end
}

function withUniversal(sel: string): string {
  sel = sel.trimEnd()
  return sel ? `${sel} *` : '*'
}

/**
 * Strip pseudo-classes and pseudo-elements from a selector so it can be
 * matched against the document, since we only care that the associated
 * elements exist. A compound left empty next to a `>`, `+` or `~` combinator
 * becomes `*`.
 */
export function normalizeCssSelector(sel: string): string {
  sel = unwrapLeadingMatchesAny(sel)
  if (!PSEUDO_OR_COMBINATOR_RE.test(sel)) {
    return sel
  }

  let out = ''
  let copied = 0
  let empty = true
  let hasCombinator = false
  let inAttribute = false
  for (let i = 0; i < sel.length; i++) {
    const char = sel[i]!
    if (char === '\\') {
      empty = false
      i++
    }
    else if (startsQuotedOrComment(sel, i)) {
      const end = quotedOrCommentEnd(sel, i)
      if (char === '/') {
        out += sel.slice(copied, i)
        copied = end
      }
      i = end - 1
    }
    else if (inAttribute) {
      inAttribute = char !== ']'
    }
    else if (char === '[') {
      inAttribute = true
      empty = false
    }
    else if (char === ':') {
      const end = pseudoEnd(sel, i)
      if (end === i) {
        empty = false
      }
      else {
        out += sel.slice(copied, i)
        copied = end
        i = end - 1
      }
    }
    else if (char === '>' || char === '+' || char === '~') {
      if (empty) {
        out = `${withUniversal(out + sel.slice(copied, i))} `
        copied = i
      }
      empty = true
      hasCombinator = true
    }
    else if (!isCssWhitespace(char)) {
      empty = false
    }
  }
  out += sel.slice(copied)

  if (empty && hasCombinator) {
    out = withUniversal(out)
  }
  return out.replace(CSS_WHITESPACE_EDGES_RE, '')
}
