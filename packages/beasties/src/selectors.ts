const LEADING_MATCHES_ANY_RE = /^:(?:is|where)\(/i
// `:not` is deliberately absent: a missing argument selector makes it match more, not less.
const NESTED_SELECTOR_PSEUDO_RE = /^::?(?:is|where|has|matches|-webkit-any|-moz-any)$/i
const PSEUDO_RE = /::?[a-z-]+/iy
const PSEUDO_OR_COMBINATOR_RE = /[:>+~]/
const ESCAPE_AT_END_RE = /(?<!\\)(?:\\\\)*\\[0-9a-f]{0,6}$/i
const HEX_ESCAPE_AT_END_RE = /(?<!\\)(?:\\\\)*\\[0-9a-f]{1,6}$/i
const HEX_DIGIT_RE = /[0-9a-f]/i
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
    || isPseudoOnlySelector(sel)
  )
}

/**
 * Whether a selector is built only from pseudo-classes and pseudo-elements.
 * Those describe a browser state or generated box that a document scan cannot
 * observe, so finding no matching element says nothing about their use.
 */
function isPseudoOnlySelector(sel: string): boolean {
  let i = 0
  let tokens = 0
  while (i < sel.length) {
    if (isCssWhitespace(sel[i]!)) {
      i++
    }
    else if (sel[i] === '/' && sel[i + 1] === '*') {
      i = quotedOrCommentEnd(sel, i)
    }
    else if (sel[i] === ':') {
      PSEUDO_RE.lastIndex = i
      const match = PSEUDO_RE.exec(sel)
      if (!match) {
        return false
      }
      const end = pseudoEnd(sel, i)
      const argsStart = i + match[0].length
      if (sel[argsStart] === '(' && NESTED_SELECTOR_PSEUDO_RE.test(match[0])) {
        if (!isPseudoOnlyList(sel.slice(argsStart + 1, end - 1))) {
          return false
        }
      }
      tokens++
      i = end
    }
    else {
      return false
    }
  }
  return tokens > 0
}

/** Whether every selector in a comma-separated argument list is pseudo-only. */
function isPseudoOnlyList(sel: string): boolean {
  let start = 0
  while (start <= sel.length) {
    const comma = closingParenIndex(sel, start, true)
    const arg = comma === -1 ? sel.slice(start) : sel.slice(start, comma)
    if (!isPseudoOnlySelector(trimCssWhitespace(arg))) {
      return false
    }
    if (comma === -1) {
      return true
    }
    start = comma + 1
  }
  return true
}

function isCssWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\f' || char === '\r'
}

/**
 * Trim CSS whitespace, keeping a trailing whitespace character that is escaped
 * or that ends a hex escape.
 */
function trimCssWhitespace(sel: string): string {
  let start = 0
  let end = sel.length
  while (start < end && isCssWhitespace(sel[start]!)) {
    start++
  }
  while (end > start && isCssWhitespace(sel[end - 1]!)) {
    end--
  }
  const trimmed = sel.slice(start, end)
  return end < sel.length && trimmed.includes('\\') && ESCAPE_AT_END_RE.test(trimmed)
    ? sel.slice(start, end + 1)
    : trimmed
}

/**
 * End a trailing hex escape with a space, so that it does not run on into
 * whatever is appended next.
 */
function endHexEscape(sel: string): string {
  return HEX_ESCAPE_AT_END_RE.test(sel) ? `${sel} ` : sel
}

/**
 * Index after the escape starting at `start`, including the whitespace
 * character that ends a hex escape.
 */
function escapeEnd(sel: string, start: number): number {
  let end = start + 1
  while (end < sel.length && end < start + 7 && HEX_DIGIT_RE.test(sel[end]!)) {
    end++
  }
  if (end === start + 1) {
    return start + 2
  }
  if (sel[end] === '\r' && sel[end + 1] === '\n') {
    return end + 2
  }
  return end < sel.length && isCssWhitespace(sel[end]!) ? end + 1 : end
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

function whitespaceOrCommentEnd(sel: string, start: number): number {
  let i = start
  while (i < sel.length) {
    if (isCssWhitespace(sel[i]!)) {
      i++
    }
    else if (sel[i] === '/' && sel[i + 1] === '*') {
      i = quotedOrCommentEnd(sel, i)
    }
    else {
      break
    }
  }
  return i
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
    const inner = trimCssWhitespace(sel.slice(start, end))
    if (!inner) {
      return ''
    }
    sel = (inner.includes('\\') ? endHexEscape(inner) : inner) + sel.slice(end + 1)
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
  sel = trimCssWhitespace(sel)
  return sel ? `${sel} *` : '*'
}

/**
 * Strip pseudo-classes and pseudo-elements from a selector so it can be
 * matched against the document, since we only care that the associated
 * elements exist. A compound left empty becomes `*` when it is next to a `>`,
 * `+` or `~` combinator, and is dropped otherwise.
 */
export function normalizeCssSelector(sel: string): string {
  sel = unwrapLeadingMatchesAny(sel)
  if (!PSEUDO_OR_COMBINATOR_RE.test(sel)) {
    return sel
  }

  let out = ''
  let copied = 0
  let empty = true
  let stripped = false
  let afterCombinator = false
  let peeked = 0
  let inAttribute = false
  let hasEscape = false
  for (let i = 0; i < sel.length; i++) {
    const char = sel[i]!
    if (char === '\\') {
      empty = false
      hasEscape = true
      i = escapeEnd(sel, i) - 1
    }
    else if (startsQuotedOrComment(sel, i)) {
      const end = quotedOrCommentEnd(sel, i)
      if (char === '/') {
        out += sel.slice(copied, i)
        if (hasEscape) {
          out = endHexEscape(out)
        }
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
        if (hasEscape) {
          out = endHexEscape(out)
        }
        copied = end
        i = end - 1
        stripped = true
      }
    }
    else if (char === '>' || char === '+' || char === '~') {
      if (empty) {
        out = `${withUniversal(out + sel.slice(copied, i))} `
        copied = i
      }
      empty = true
      stripped = false
      afterCombinator = true
    }
    else if (!isCssWhitespace(char)) {
      empty = false
    }
    else if ((!empty || stripped) && i >= peeked) {
      peeked = whitespaceOrCommentEnd(sel, i)
      const next = sel[peeked]
      if (next !== undefined && next !== '>' && next !== '+' && next !== '~') {
        if (empty && afterCombinator) {
          out = withUniversal(out + sel.slice(copied, i))
          copied = i
        }
        empty = true
        stripped = false
        afterCombinator = false
      }
    }
  }
  out += sel.slice(copied)

  if (empty && afterCombinator) {
    out = withUniversal(out)
  }
  return trimCssWhitespace(out)
}
