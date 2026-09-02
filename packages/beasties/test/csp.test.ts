import type { HTMLDocument } from '../src/dom'
import { DomUtils, parseDocument } from 'htmlparser2'

import { describe, expect, it, vi } from 'vitest'
import { compileSheet } from '../src/compiler'
import Beasties from '../src/index'
import { createProcessor } from '../src/runtime'

const CSS = 'h1 { color: blue; }'

const DEFERRED_SCRIPT = `document.querySelectorAll('link[data-beasties-media]').forEach(function(l){l.media=l.getAttribute('data-beasties-media');l.removeAttribute('data-beasties-media')})`

function scriptContents(html: string): string[] {
  const document = parseDocument(html)
  return DomUtils.findAll(node => node.tagName === 'script', document.children).map(node => DomUtils.textContent(node))
}

function classic(options: ConstructorParameters<typeof Beasties>[0] = {}) {
  const beasties = new Beasties({
    reduceInlineStyles: false,
    path: '/',
    logLevel: 'silent',
    ...options,
  })
  beasties.readFile = () => CSS
  return beasties
}

function html(links = '<link rel="stylesheet" href="/style.css">') {
  return `<html><head>${links}</head><body><h1>Hello World!</h1></body></html>`
}

function compiled(options: Parameters<typeof createProcessor>[1], hrefs = ['style.css']) {
  return createProcessor(hrefs.map(href => compileSheet(CSS, { href })), options)
}

describe('nonce (classic)', () => {
  it('should set the nonce on the inlined style', async () => {
    const result = await classic({ nonce: 'abc123', preload: false }).process(html())
    expect(result).toContain('<style nonce="abc123">h1{color:blue}</style>')
  })

  it('should set the nonce on additional stylesheets', async () => {
    const beasties = classic({ nonce: 'abc123', preload: false, additionalStylesheets: ['/extra.css'] })
    const result = await beasties.process(html(''))
    expect(result).toContain('<style nonce="abc123">h1{color:blue}</style>')
  })

  it('should set the nonce on the "js" loader script', async () => {
    const result = await classic({ nonce: 'abc123', preload: 'js' }).process(html())
    expect(result).toContain('<script nonce="abc123" data-href="/style.css" data-media="all">')
  })

  it('should escape a quote-bearing nonce', async () => {
    const result = await classic({ nonce: 'a"><b>', preload: false }).process(html())
    expect(result).toContain('<style nonce="a&quot;><b>">')
  })

  it('should set the nonce returned by a function on the inlined style', async () => {
    const nonce = vi.fn(() => 'abc123')
    const result = await classic({ nonce, preload: false }).process(html())
    expect(result).toContain('<style nonce="abc123">h1{color:blue}</style>')
    expect(nonce).toHaveBeenCalledOnce()
  })

  it('should pass the document to the nonce function', async () => {
    let receivedDoc: HTMLDocument | undefined
    const result = await classic({
      nonce: (doc) => {
        receivedDoc = doc
        return doc.querySelector('meta[name="csp-nonce"]')?.getAttribute('content')
      },
      preload: false,
    }).process(
      '<html><head><meta name="csp-nonce" content="meta-nonce"><link rel="stylesheet" href="/style.css"></head><body><h1>Hello World!</h1></body></html>',
    )
    expect(receivedDoc).toBeDefined()
    expect(result).toContain('<style nonce="meta-nonce">h1{color:blue}</style>')
  })

  it('should not set a nonce when the nonce function returns undefined', async () => {
    const result = await classic({ nonce: () => undefined, preload: false }).process(html())
    expect(result).toContain('<style>h1{color:blue}</style>')
  })

  it('should set the function-provided nonce on additional stylesheets', async () => {
    const beasties = classic({ nonce: () => 'abc123', preload: false, additionalStylesheets: ['/extra.css'] })
    const result = await beasties.process(html(''))
    expect(result).toContain('<style nonce="abc123">h1{color:blue}</style>')
  })

  it('should set the function-provided nonce on the "js" loader script', async () => {
    const result = await classic({ nonce: () => 'abc123', preload: 'js' }).process(html())
    expect(result).toContain('<script nonce="abc123" data-href="/style.css" data-media="all">')
  })

  it('should evaluate the nonce function only once per document', async () => {
    const nonce = vi.fn(() => 'abc123')
    const beasties = classic({ nonce, preload: 'js' })
    const result = await beasties.process(html())
    expect(result).toContain('<style nonce="abc123">')
    expect(result).toContain('<script nonce="abc123"')
    expect(nonce).toHaveBeenCalledTimes(1)
  })
})

describe('nonce (compiled)', () => {
  it('should set the nonce on the inlined style', () => {
    const result = compiled({ nonce: 'abc123', preload: false }).process(html())
    expect(result).toContain('<style nonce="abc123">h1{color:blue}</style>')
  })

  it('should set the nonce on the "js" loader script', () => {
    const result = compiled({ nonce: 'abc123', preload: 'js' }).process(html())
    expect(result).toContain('<script nonce="abc123" data-href="/style.css" data-media="all">')
  })

  it('should escape a quote-bearing nonce', () => {
    const result = compiled({ nonce: 'a"><b>', preload: false }).process(html())
    expect(result).toContain('<style nonce="a&quot;><b>">')
  })
})

describe('"media-script" preload mode (classic)', () => {
  it('should defer links without an inline event handler', async () => {
    const result = await classic({ preload: 'media-script' }).process(html())
    expect(result).not.toContain('onload')
    expect(result).toContain('<link rel="stylesheet" href="/style.css" media="print" data-beasties-media="all">')
    expect(result).toContain(`<script>${DEFERRED_SCRIPT}</script></body>`)
  })

  it('should emit a single script for multiple stylesheets', async () => {
    const result = await classic({ preload: 'media-script' }).process(
      html('<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/other.css">'),
    )
    expect(result.match(/<script/g)).toHaveLength(1)
    expect(result.match(/data-beasties-media="all"/g)).toHaveLength(2)
  })

  it('should set the nonce on the script', async () => {
    const result = await classic({ preload: 'media-script', nonce: 'abc123' }).process(html())
    expect(result).toContain(`<script nonce="abc123">${DEFERRED_SCRIPT}</script>`)
  })

  it('should set the function-provided nonce on the script', async () => {
    const result = await classic({ preload: 'media-script', nonce: () => 'abc123' }).process(html())
    expect(result).toContain(`<script nonce="abc123">${DEFERRED_SCRIPT}</script>`)
  })

  it('should emit a noscript fallback', async () => {
    const result = await classic({ preload: 'media-script' }).process(html())
    expect(result).toContain('<noscript><link rel="stylesheet" href="/style.css"></noscript>')
  })

  it('should omit the noscript fallback when disabled', async () => {
    const result = await classic({ preload: 'media-script', noscriptFallback: false }).process(html())
    expect(result).not.toContain('<noscript>')
  })

  it('should not emit a script when no link was deferred', async () => {
    const result = await classic({ preload: 'media-script' }).process(html(''))
    expect(result).not.toContain('<script')
  })

  it('should preserve a valid media query', async () => {
    const result = await classic({ preload: 'media-script' }).process(
      html('<link rel="stylesheet" href="/style.css" media="screen and (min-width: 480px)">'),
    )
    expect(result).toContain('data-beasties-media="screen and (min-width: 480px)"')
  })

  it('should not let a quote-bearing media value reach executable context', async () => {
    const result = await classic({ preload: 'media-script' }).process(
      html(`<link rel="stylesheet" href="/style.css" media="all';alert(1);'">`),
    )
    expect(result).toContain('data-beasties-media="all"')
    expect(scriptContents(result)).toEqual([DEFERRED_SCRIPT])
  })
})

describe('"media-script" preload mode (compiled)', () => {
  it('should defer links without an inline event handler', () => {
    const result = compiled({ preload: 'media-script' }).process(html())
    expect(result).not.toContain('onload')
    expect(result).toContain('<link rel="stylesheet" href="/style.css" media="print" data-beasties-media="all">')
    expect(result).toContain(`<script>${DEFERRED_SCRIPT}</script>`)
  })

  it('should emit a single script for multiple stylesheets', () => {
    const result = compiled({ preload: 'media-script' }, ['style.css', 'other.css']).process(
      html('<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/other.css">'),
    )
    expect(result.match(/<script/g)).toHaveLength(1)
    expect(result.match(/data-beasties-media="all"/g)).toHaveLength(2)
  })

  it('should set the nonce on the script', () => {
    const result = compiled({ preload: 'media-script', nonce: 'abc123' }).process(html())
    expect(result).toContain(`<script nonce="abc123">${DEFERRED_SCRIPT}</script>`)
  })

  it('should emit a noscript fallback', () => {
    const result = compiled({ preload: 'media-script' }).process(html())
    expect(result).toContain('<noscript><link rel="stylesheet" href="/style.css"></noscript>')
  })

  it('should omit the noscript fallback when disabled', () => {
    const result = compiled({ preload: 'media-script', noscriptFallback: false }).process(html())
    expect(result).not.toContain('<noscript>')
  })

  it('should not emit a script when no link was deferred', () => {
    const result = compiled({ preload: 'media-script' }).process(html(''))
    expect(result).not.toContain('<script')
  })

  it('should preserve a valid media query', () => {
    const result = compiled({ preload: 'media-script' }).process(
      html('<link rel="stylesheet" href="/style.css" media="screen and (min-width: 480px)">'),
    )
    expect(result).toContain('data-beasties-media="screen and (min-width: 480px)"')
  })

  it('should not let a quote-bearing media value reach executable context', () => {
    const result = compiled({ preload: 'media-script' }).process(
      html(`<link rel="stylesheet" href="/style.css" media="all';alert(1);'">`),
    )
    expect(result).toContain('data-beasties-media="all"')
    expect(scriptContents(result)).toEqual([DEFERRED_SCRIPT])
  })
})
