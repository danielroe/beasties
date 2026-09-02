import { describe, expect, it } from 'vitest'

import { compileSheet } from '../src/compiler'
import { parseFontFamilies, parseUnicodeRanges } from '../src/fonts'
import Beasties from '../src/index'
import { collectPrograms, renderCriticalCss, scanHtml } from '../src/runtime'

const NUXT_FONTS_CSS = `
@font-face{font-family:Barlow;src:local(Barlow Regular Italic),local(Barlow Italic),url(/_fonts/latin.woff2)format("woff2");font-display:swap;unicode-range:U+0000-00FF,U+0131,U+2000-206F;font-weight:400;font-style:italic}
@font-face{font-family:Barlow;src:local(Barlow Regular Italic),url(/_fonts/vietnamese.woff2)format("woff2");font-display:swap;unicode-range:U+0102-0103,U+1EA0-1EF9;font-weight:400;font-style:italic}
@font-face{font-family:Barlow Fallback\\: BlinkMacSystemFont;src:local(BlinkMacSystemFont);size-adjust:103.48%;ascent-override:96.6366%;descent-override:19.3273%;line-gap-override:0%}
@font-face{font-family:Barlow Fallback\\: Segoe UI;src:local(Segoe UI);size-adjust:105.1%}
@font-face{font-family:Unused;src:url(/_fonts/unused.woff2)format("woff2")}
@font-face{font-family:Unused Fallback\\: Segoe UI;src:local(Segoe UI);size-adjust:100%}
.font-sans{font-family:Barlow,"Barlow Fallback: BlinkMacSystemFont","Barlow Fallback: Segoe UI",sans-serif}
`

function page(text: string) {
  return `<html><head><link rel="stylesheet" href="/style.css"></head><body><p class="font-sans">${text}</p></body></html>`
}

function render(css: string, html: string, options = {}) {
  const sheet = compileSheet(css, {})
  return renderCriticalCss(sheet, scanHtml(html, collectPrograms([sheet])), options)
}

describe('parseFontFamilies', () => {
  it('should split family stacks into individual normalised families', () => {
    expect(parseFontFamilies('font-family', 'Barlow, "Barlow Fallback: BlinkMacSystemFont", sans-serif'))
      .toEqual(['barlow', 'barlow fallback: blinkmacsystemfont', 'sans-serif'])
  })

  it('should collect only the family list from a `font` shorthand', () => {
    expect(parseFontFamilies('font', 'italic small-caps bold 400 16px/1.5 Barlow, system-ui'))
      .toEqual(['barlow', 'system-ui'])
    expect(parseFontFamilies('font', 'normal normal 16px / 1.5 ui-sans-serif, "Apple Color Emoji"'))
      .toEqual(['ui-sans-serif', 'apple color emoji'])
    expect(parseFontFamilies('font', 'x-large Barlow')).toEqual(['barlow'])
  })

  it('should yield no families for css-wide keywords and system font shorthands', () => {
    expect(parseFontFamilies('font', 'inherit')).toEqual([])
    expect(parseFontFamilies('font', 'caption')).toEqual([])
    expect(parseFontFamilies('font-family', 'inherit')).toEqual([])
  })
})

describe('parseUnicodeRanges', () => {
  it('should parse single codepoints, ranges and wildcards', () => {
    expect(parseUnicodeRanges('U+26')).toEqual([0x26, 0x26])
    expect(parseUnicodeRanges('U+0102-0103, U+1EA0-1EF9')).toEqual([0x102, 0x103, 0x1EA0, 0x1EF9])
    expect(parseUnicodeRanges('U+4??')).toEqual([0x400, 0x4FF])
  })

  it('should bail out on values it cannot parse', () => {
    expect(parseUnicodeRanges('U+FF-00')).toBeUndefined()
    expect(parseUnicodeRanges('var(--range)')).toBeUndefined()
    expect(parseUnicodeRanges('')).toBeUndefined()
  })
})

describe('@font-face inlining', () => {
  it('should parse family, src and unicode-range for @nuxt/fonts-shaped faces', () => {
    const faces = compileSheet(NUXT_FONTS_CSS, {}).rules.filter(rule => rule.fontFace).map(rule => rule.fontFace)
    expect(faces.slice(0, 3)).toEqual([
      { family: 'Barlow', src: '/_fonts/latin.woff2', ranges: [0x0, 0xFF, 0x131, 0x131, 0x2000, 0x206F] },
      { family: 'Barlow', src: '/_fonts/vietnamese.woff2', ranges: [0x102, 0x103, 0x1EA0, 0x1EF9] },
      { family: 'Barlow Fallback\\: BlinkMacSystemFont', src: undefined, ranges: undefined },
    ])
  })

  it('should record only families in `fontsUsed`', () => {
    const sheet = compileSheet('html{font:normal normal 16px/1.5 ui-sans-serif,system-ui}h1{font:inherit}b{font-weight:bolder}.font-sans{font-family:Barlow,"Barlow Fallback: Segoe UI"}', {})
    expect(sheet.rules.map(rule => rule.fontsUsed)).toEqual([
      ['ui-sans-serif', 'system-ui'],
      undefined,
      undefined,
      ['barlow', 'barlow fallback: segoe ui'],
    ])
  })

  it('should inline used faces including escaped metric-override fallbacks', () => {
    const { css } = render(NUXT_FONTS_CSS, page('hi'), { inlineFonts: true })
    expect(css).toContain('/_fonts/latin.woff2')
    expect(css).toContain('Barlow Fallback\\: BlinkMacSystemFont')
    expect(css).toContain('Barlow Fallback\\: Segoe UI')
    expect(css).not.toContain('font-family:Unused')
    expect(css).not.toContain('Unused Fallback')
  })

  it('should not match a family as a substring of a used family', () => {
    const { css } = render('@font-face{font-family:Sans;src:url(/sans.woff2)}.a{font-family:"Open Sans"}', '<html><body><p class="a">hi</p></body></html>', { inlineFonts: true })
    expect(css).not.toContain('@font-face')
  })
})

describe('unicode-range filtering', () => {
  it('should skip faces whose subset covers no character in the document', () => {
    const { css } = render(NUXT_FONTS_CSS, page('hi'), { inlineFonts: true })
    expect(css).toContain('/_fonts/latin.woff2')
    expect(css).not.toContain('/_fonts/vietnamese.woff2')
  })

  it('should keep a subset once the document uses it', () => {
    const { css } = render(NUXT_FONTS_CSS, page('xin ch&#7845;o'), { inlineFonts: true })
    expect(css).toContain('/_fonts/vietnamese.woff2')
  })

  it('should keep every subset when the document text cannot be decoded', () => {
    const { css } = render(NUXT_FONTS_CSS, page('xin ch&agrave;o'), { inlineFonts: true })
    expect(css).toContain('/_fonts/vietnamese.woff2')
  })

  it('should count text in rendered attributes', () => {
    const html = '<html><body><p class="font-sans"><input value="\u1EA1"></p></body></html>'
    const { css } = render(NUXT_FONTS_CSS, html, { inlineFonts: true })
    expect(css).toContain('/_fonts/vietnamese.woff2')
  })
})

describe('font preloading', () => {
  it('should only preload faces used by the critical css', () => {
    const { fontPreloads } = render(NUXT_FONTS_CSS, page('hi'), { preloadFonts: true })
    expect(fontPreloads).toEqual(['/_fonts/latin.woff2'])
  })

  it('should preload a subset once the document uses it', () => {
    const { fontPreloads } = render(NUXT_FONTS_CSS, page('xin ch\u1EA5o'), { preloadFonts: true })
    expect(fontPreloads).toEqual(['/_fonts/latin.woff2', '/_fonts/vietnamese.woff2'])
  })
})

describe('font preloading via process()', () => {
  const CSS = [
    'h1 { font-family: Barlow, sans-serif; }',
    '.unused { font-family: Other; }',
    '@font-face { font-family: Barlow; src: url(/fonts/latin.woff2); unicode-range: U+0000-00FF; }',
    '@font-face { font-family: Barlow; src: url(/fonts/vietnamese.woff2); unicode-range: U+1EA0-1EF9; }',
    '@font-face { font-family: Other; src: url(/fonts/other.woff2); }',
  ].join('\n')

  async function process(body: string) {
    const beasties = new Beasties({ reduceInlineStyles: false, path: '/', logLevel: 'silent', preload: false, preloadFonts: true, inlineFonts: true })
    beasties.readFile = () => CSS
    return beasties.process(`<html><head><link rel="stylesheet" href="/style.css"></head><body>${body}</body></html>`)
  }

  it('should preload only the faces used by the critical css', async () => {
    const result = await process('<h1>Hello</h1>')
    expect(result).toContain('href="/fonts/latin.woff2"')
    expect(result).not.toContain('href="/fonts/vietnamese.woff2"')
    expect(result).not.toContain('href="/fonts/other.woff2"')
  })

  it('should preload and inline a subset once the document uses it', async () => {
    const result = await process('<h1>xin ch\u1EA5o</h1>')
    expect(result).toContain('href="/fonts/vietnamese.woff2"')
    expect(result).toContain('url(/fonts/vietnamese.woff2)')
  })
})

describe('unicode-range filtering via process()', () => {
  const CSS = [
    'h1 { font-family: Barlow; }',
    '@font-face { font-family: Barlow; src: url(/fonts/latin.woff2); unicode-range: U+0000-00FF; }',
    '@font-face { font-family: Barlow; src: url(/fonts/greek.woff2); unicode-range: U+0370-03FF; }',
  ].join('\n')

  async function process(html: string) {
    const beasties = new Beasties({ reduceInlineStyles: false, path: '/', logLevel: 'silent', preload: false, inlineFonts: true, preloadFonts: false })
    beasties.readFile = () => CSS
    return beasties.process(html)
  }

  it('should ignore text in script and style elements', async () => {
    const result = await process(`<html><head><link rel="stylesheet" href="/style.css"><style>.x{content:"\u03B1"}</style><script>const a = '\u03B1'</script></head><body><h1>Hello</h1></body></html>`)
    expect(result).toContain('url(/fonts/latin.woff2)')
    expect(result).not.toContain('url(/fonts/greek.woff2)')
  })

  it('should count text in the document body', async () => {
    const result = await process('<html><head><link rel="stylesheet" href="/style.css"></head><body><h1>\u03BA\u03B1\u03BB\u03AE\u03BC\u03AD\u03C1\u03B1</h1></body></html>')
    expect(result).toContain('url(/fonts/greek.woff2)')
  })
})
