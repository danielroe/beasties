import { describe, expect, it } from 'vitest'

import { compileSheet } from '../src/compiler'
import { parseFontFamilies } from '../src/fonts'
import { collectPrograms, renderCriticalCss, scanHtml } from '../src/runtime'

const NUXT_FONTS_CSS = `
@font-face{font-family:Barlow;src:local(Barlow Regular Italic),local(Barlow Italic),url(/_fonts/Nkd.woff2)format("woff2");font-display:swap;unicode-range:U+0102-0103,U+1EA0-1EF9;font-weight:400;font-style:italic}
@font-face{font-family:Barlow Fallback\\: BlinkMacSystemFont;src:local(BlinkMacSystemFont);size-adjust:103.48%;ascent-override:96.6366%;descent-override:19.3273%;line-gap-override:0%}
@font-face{font-family:Barlow Fallback\\: Segoe UI;src:local(Segoe UI);size-adjust:105.1%}
@font-face{font-family:Unused;src:url(/_fonts/unused.woff2)format("woff2")}
@font-face{font-family:Unused Fallback\\: Segoe UI;src:local(Segoe UI);size-adjust:100%}
.font-sans{font-family:Barlow,"Barlow Fallback: BlinkMacSystemFont","Barlow Fallback: Segoe UI",sans-serif}
`

const HTML = '<html><head><link rel="stylesheet" href="/style.css"></head><body><p class="font-sans">hi</p></body></html>'

function critical(css: string, html: string, options = {}) {
  const sheet = compileSheet(css, {})
  return renderCriticalCss(sheet, scanHtml(html, collectPrograms([sheet])), options).css
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

describe('@font-face inlining', () => {
  it('should parse family and src for @nuxt/fonts-shaped faces', () => {
    const faces = compileSheet(NUXT_FONTS_CSS, {}).rules.filter(rule => rule.fontFace).map(rule => rule.fontFace)
    expect(faces.slice(0, 3)).toEqual([
      { family: 'Barlow', src: '/_fonts/Nkd.woff2' },
      { family: 'Barlow Fallback\\: BlinkMacSystemFont', src: undefined },
      { family: 'Barlow Fallback\\: Segoe UI', src: undefined },
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
    const css = critical(NUXT_FONTS_CSS, HTML, { inlineFonts: true })
    expect(css).toContain('font-family:Barlow;')
    expect(css).toContain('Barlow Fallback\\: BlinkMacSystemFont')
    expect(css).toContain('Barlow Fallback\\: Segoe UI')
    expect(css).not.toContain('font-family:Unused')
    expect(css).not.toContain('Unused Fallback')
  })

  it('should not match a family as a substring of a used family', () => {
    const css = critical('@font-face{font-family:Sans;src:url(/sans.woff2)}.a{font-family:"Open Sans"}', '<html><body><p class="a">hi</p></body></html>', { inlineFonts: true })
    expect(css).not.toContain('@font-face')
  })
})
