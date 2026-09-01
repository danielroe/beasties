import { describe, expect, it, vi } from 'vitest'

// deliberately no static import of `../src/dom`: patching `Element.prototype`
// is global, so this file must only ever load the mocked copy
describe('dom', () => {
  describe('a domhandler copy the parser does not share', () => {
    const HTML = '<html><body><div class="hero">text</div></body></html>'

    /** load a copy of src/dom whose `Element` is not the one htmlparser2 constructs nodes from */
    async function loadWithForeignDomhandler() {
      const domhandler = await import('domhandler')

      vi.resetModules()
      vi.doMock('domhandler', () => ({ ...domhandler, Element: class Element extends domhandler.Element {} }))
      const { createDocument: createDocumentWithForeignElement } = await import('../src/dom')
      vi.doUnmock('domhandler')
      return createDocumentWithForeignElement
    }

    it('patches the prototype the parser actually produced', async () => {
      const createDocumentWithForeignElement = await loadWithForeignDomhandler()

      const doc = createDocumentWithForeignElement(HTML)

      expect(doc.documentElement!.getAttribute('data-beasties-container')).toBe('')
      expect(doc.beastiesContainers[0]!.exists('.hero')).toBe(true)
    })

    it('still patches its own Element so createElement() is usable', async () => {
      const createDocumentWithForeignElement = await loadWithForeignDomhandler()

      const doc = createDocumentWithForeignElement(HTML)
      const el = doc.createElement('style')
      el.setAttribute('media', 'print')
      doc.body.appendChild(el)

      expect(doc.body.querySelector('style')!.getAttribute('media')).toBe('print')
    })
  })
})
