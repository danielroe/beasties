import { describe, expect, it } from 'vitest'

import { normalizeCssSelector } from '../src/selectors'

describe('normalizeCssSelector', () => {
  it('only trims css whitespace from an unwrapped :is() or :where() argument', () => {
    expect(normalizeCssSelector(':where( #target\uFEFF ).present')).toBe('#target\uFEFF.present')
    expect(normalizeCssSelector(':is(\n\t.a > p\f\r):hover')).toBe('.a > p')
  })

  it('keeps quoted attribute values intact', () => {
    expect(normalizeCssSelector('a[title="x:y"]:hover')).toBe('a[title="x:y"]')
    expect(normalizeCssSelector('a[title=\'x::y(z)\']::before')).toBe('a[title=\'x::y(z)\']')
    expect(normalizeCssSelector(String.raw`a[title="x\":y"]:hover`)).toBe(String.raw`a[title="x\":y"]`)
    expect(normalizeCssSelector(String.raw`.a\"b:hover [title="x"]`)).toBe(String.raw`.a\"b [title="x"]`)
    expect(normalizeCssSelector(':where([title="a>+b"]).present')).toBe('[title="a>+b"].present')
    expect(normalizeCssSelector('[title=">>"] > :hover')).toBe('[title=">>"] > *')
    expect(normalizeCssSelector('[title="f(,)"][lang="0"]')).toBe('[title="f(,)"][lang="0"]')
  })

  it('removes comments', () => {
    expect(normalizeCssSelector(':where(.a/*)*/).present')).toBe('.a.present')
    expect(normalizeCssSelector(':is(.a/*,*/ > p)/*"*/:hover')).toBe('.a > p')
    expect(normalizeCssSelector('[title="/*x*/"]/*:hover*/.present')).toBe('[title="/*x*/"].present')
  })
})
