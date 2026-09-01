import { Element } from 'domhandler'
import { describe, expect, it, vi } from 'vitest'

// deliberately no static import of `../src/dom`: this file needs an
// `Element.prototype` that is fully patched but carries no version marker
describe('dom', () => {
  describe('a pre-marker copy that patched first', () => {
    const HTML = '<html><body><div class="hero">text</div></body></html>'

    it('reuses its descriptors instead of throwing', async () => {
      const domhandler = await import('domhandler')
      const { createDocument } = await import('../src/dom')
      createDocument(HTML)

      // versions before the marker existed left only their descriptors behind
      delete (Element.prototype as unknown as Record<symbol, unknown>)[Symbol.for('beasties.element-extended')]

      vi.resetModules()
      vi.doMock('domhandler', () => domhandler)
      const { createDocument: createDocumentAgain } = await import('../src/dom')
      vi.doUnmock('domhandler')

      const logger = { warn: vi.fn() }
      const doc = createDocumentAgain(HTML, logger)

      expect(doc.beastiesContainers[0]!.exists('.hero')).toBe(true)
      expect(logger.warn).toHaveBeenCalledOnce()
      expect(logger.warn.mock.calls[0]![0]).toContain('an older version')
    })
  })
})
