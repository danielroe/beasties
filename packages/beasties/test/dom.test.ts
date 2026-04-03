import { describe, expect, it } from 'vitest'
import { createDocument } from '../src/dom'

describe('dom', () => {
  describe('exists() selector cache', () => {
    it('falls through to DOM query when selector has a complex group', () => {
      const doc = createDocument(`
        <html>
          <body>
            <div class="parent"><span class="child">text</span></div>
          </body>
        </html>
      `)
      const container = doc.beastiesContainer

      /*
       ".parent .child" (descendant combinator) can't be resolved by the
       selector cache, so exists() must fall through to a full DOM query.
       The comma means OR, so the result is true because ".parent .child" matches.
      */
      expect(container.exists('.nonexistent, .parent .child')).toBe(true)
    })

    it('gives consistent results regardless of selector order', () => {
      const doc = createDocument(`
        <html>
          <body>
            <div class="present">text</div>
          </body>
        </html>
      `)
      const container = doc.beastiesContainer

      /*
        CSS comma means OR — both selectors are logically equivalent,
        so exists() must return the same result regardless of order.
      */
      expect(container.exists('.present, .absent'))
        .toBe(container.exists('.absent, .present'))
    })

    it('returns true for simple class selector that exists', () => {
      const doc = createDocument(`
        <html><body><div class="hero">text</div></body></html>
      `)
      expect(doc.beastiesContainer.exists('.hero')).toBe(true)
    })

    it('returns false for simple class selector that does not exist', () => {
      const doc = createDocument(`
        <html><body><div class="hero">text</div></body></html>
      `)
      expect(doc.beastiesContainer.exists('.missing')).toBe(false)
    })

    it('returns true for simple id selector that exists', () => {
      const doc = createDocument(`
        <html><body><div id="main">text</div></body></html>
      `)
      expect(doc.beastiesContainer.exists('#main')).toBe(true)
    })

    it('returns false for simple id selector that does not exist', () => {
      const doc = createDocument(`
        <html><body><div id="main">text</div></body></html>
      `)
      expect(doc.beastiesContainer.exists('#nope')).toBe(false)
    })
  })
})
