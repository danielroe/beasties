import { describe, expect, it, vi } from 'vitest'
import { createDocument } from '../src/dom'

describe('dom', () => {
  describe('duplicate copies sharing one domhandler', () => {
    const HTML = '<html><body><div class="hero">text</div></body></html>'

    /** load a second copy of src/dom that resolves the already-loaded domhandler */
    async function loadSecondCopy(version?: string) {
      const domhandler = await import('domhandler')
      createDocument(HTML)

      vi.resetModules()
      vi.doMock('domhandler', () => domhandler)
      if (version) {
        const pkg = await import('../package.json')
        vi.doMock('../package.json', () => ({ ...pkg, version }))
      }
      const { createDocument: createDocumentAgain } = await import('../src/dom')
      vi.doUnmock('domhandler')
      vi.doUnmock('../package.json')
      return createDocumentAgain
    }

    it('reuses the existing patch instead of throwing', async () => {
      const createDocumentAgain = await loadSecondCopy()
      const logger = { warn: vi.fn() }

      const doc = createDocumentAgain(HTML, logger)

      expect(doc.beastiesContainers[0]!.exists('.hero')).toBe(true)
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('warns when the copies are different versions', async () => {
      const createDocumentAgain = await loadSecondCopy('99.0.0')
      const logger = { warn: vi.fn() }

      createDocumentAgain(HTML, logger)

      expect(logger.warn).toHaveBeenCalledOnce()
      expect(logger.warn.mock.calls[0]![0]).toContain('Multiple versions of beasties')
      expect(logger.warn.mock.calls[0]![0]).toContain('99.0.0')
    })
  })

  describe('exists() selector cache', () => {
    it('falls through to DOM query when selector has a complex group', () => {
      const doc = createDocument(`
        <html>
          <body>
            <div class="parent"><span class="child">text</span></div>
          </body>
        </html>
      `)
      const container = doc.beastiesContainers[0]!

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
      const container = doc.beastiesContainers[0]!

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
      const container = doc.beastiesContainers[0]!
      expect(container.exists('.hero')).toBe(true)
    })

    it('returns false for simple class selector that does not exist', () => {
      const doc = createDocument(`
        <html><body><div class="hero">text</div></body></html>
      `)
      const container = doc.beastiesContainers[0]!
      expect(container.exists('.missing')).toBe(false)
    })

    it('returns true for simple id selector that exists', () => {
      const doc = createDocument(`
        <html><body><div id="main">text</div></body></html>
      `)
      const container = doc.beastiesContainers[0]!
      expect(container.exists('#main')).toBe(true)
    })

    it('returns false for simple id selector that does not exist', () => {
      const doc = createDocument(`
        <html><body><div id="main">text</div></body></html>
      `)
      const container = doc.beastiesContainers[0]!
      expect(container.exists('#nope')).toBe(false)
    })
  })
})
