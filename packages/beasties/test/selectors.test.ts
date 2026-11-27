import { describe, expect, it } from 'vitest'

import { isAlwaysCriticalSelector, normalizeCssSelector } from '../src/selectors'

describe('normalizeCssSelector', () => {
  it('strips each functional pseudo-class up to its own closing parenthesis', () => {
    expect(normalizeCssSelector(':is(.list, .other) > li:not(:last-child)')).toBe('* > li')
    expect(normalizeCssSelector('.group:not(.a) > .item:nth-child(2n + 1) .b')).toBe('.group > .item .b')
    expect(normalizeCssSelector(String.raw`div:not(.a) .w-\[calc\(100\%\+1rem\)\]`)).toBe(String.raw`div .w-\[calc\(100\%\+1rem\)\]`)
    expect(normalizeCssSelector(':where(.space-y > :not(\n:last-child\n))')).toBe('.space-y > *')
    expect(normalizeCssSelector(':is(\n  .list,\n  .other\n) > li')).toBe('* > li')
  })

  it('adds a universal selector for each compound left empty beside a combinator', () => {
    expect(normalizeCssSelector(':hover > :focus + :active > .a')).toBe('* > * + * > .a')
    expect(normalizeCssSelector('.a ~ :focus > :hover')).toBe('.a ~ * > *')
    expect(normalizeCssSelector(String.raw`.c\+\+`)).toBe(String.raw`.c\+\+`)
    expect(normalizeCssSelector('[class~="a"]:hover')).toBe('[class~="a"]')
  })

  it('matches nothing for an empty leading :is() or :where()', () => {
    for (const sel of [':where() > li', ':where( ) > li', ':is().foo', ':where(:is()).foo', ':where()body']) {
      expect(normalizeCssSelector(sel)).toBe('')
      expect(isAlwaysCriticalSelector(sel)).toBe(false)
    }
  })

  it('only trims css whitespace from an unwrapped :is() or :where() argument', () => {
    expect(normalizeCssSelector(':where( #target\uFEFF ).present')).toBe('#target\uFEFF.present')
    expect(normalizeCssSelector(':is(\n\t.a > p\f\r):hover')).toBe('.a > p')
  })

  it('keeps whitespace that belongs to an escape', () => {
    expect(normalizeCssSelector(String.raw`:where(.a\ ).b`)).toBe(String.raw`.a\ .b`)
    expect(normalizeCssSelector(String.raw`:where(.\31 ) a`)).toBe(String.raw`.\31  a`)
    expect(normalizeCssSelector(String.raw`:where(.\31 ).b`)).toBe(String.raw`.\31 .b`)
    expect(normalizeCssSelector(String.raw`:where(.a\\ ).b`)).toBe(String.raw`.a\\.b`)
    expect(normalizeCssSelector(String.raw`.a\ :hover`)).toBe(String.raw`.a\ `)
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

  it('ignores pseudo-classes and delimiters inside comments', () => {
    expect(normalizeCssSelector(':where(.a/*)*/).present')).toBe('.a/*)*/.present')
    expect(normalizeCssSelector(':is(.a/*,*/ > p)/*"*/:hover')).toBe('.a > p')
    expect(normalizeCssSelector('[title="/*x*/"]/*:hover*/.present')).toBe('[title="/*x*/"].present')
  })
})
