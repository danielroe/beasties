import { describe, expect, it } from 'vitest'

import { normalizeCssSelector } from '../src/selectors'

describe('normalizeCssSelector', () => {
  it('only trims css whitespace from an unwrapped :is() or :where() argument', () => {
    expect(normalizeCssSelector(':where( #target\uFEFF ).present')).toBe('#target\uFEFF.present')
    expect(normalizeCssSelector(':is(\n\t.a > p\f\r):hover')).toBe('.a > p')
  })
})
