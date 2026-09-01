import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { compileSheet } from '../src/compiler'
import Beasties from '../src/index'
import { collectPrograms, createProcessor, renderCriticalCss, scanHtml } from '../src/runtime'

const fixtureDir = fileURLToPath(new URL('./src', import.meta.url))

function trim(s: TemplateStringsArray) {
  return s[0]!
    .trim()
    .replace(new RegExp(`^${s[0]!.match(/^( {2}|\t)+/m)![0]}`, 'gm'), '')
}

/** run classic beasties over html with in-memory css assets, returning the inlined critical css */
async function classicCritical(html: string, css: string, options: ConstructorParameters<typeof Beasties>[0] = {}): Promise<string> {
  const beasties = new Beasties({
    reduceInlineStyles: false,
    path: '/',
    logLevel: 'silent',
    preload: false,
    ...options,
  })
  beasties.readFile = () => css
  const result = await beasties.process(html)
  const styles = [...result.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1])
  return styles.join('')
}

function compiledCritical(html: string, css: string, options: Parameters<typeof renderCriticalCss>[2] = {}, compileOptions: Parameters<typeof compileSheet>[1] = {}): string {
  const sheet = compileSheet(css, compileOptions)
  return renderCriticalCss(sheet, scanHtml(html, collectPrograms([sheet])), options).css
}

const BASIC_HTML = trim`
  <html>
    <head>
      <link rel="stylesheet" href="/style.css">
    </head>
    <body>
      <h1>Hello World!</h1>
      <p class="para">This is a paragraph</p>
      <div id="app" data-x="1"><span class="a b">nested</span></div>
    </body>
  </html>
`

describe('compiled beasties (compiler + runtime)', () => {
  describe('parity with classic process()', () => {
    it('matches on basic selectors', async () => {
      const css = trim`
        h1 { color: blue; }
        h2.unused { color: red; }
        p { color: purple; }
        p.unused { color: orange; }
        .para { margin: 0; }
        #app { display: flex; }
        #missing { display: none; }
        [data-x] { color: teal; }
        [data-missing] { color: tomato; }
        span.a.b { color: green; }
        span.a.c { color: yellow; }
      `
      const classic = await classicCritical(BASIC_HTML, css)
      const compiled = compiledCritical(BASIC_HTML, css)
      expect(compiled).toBe(classic)
      expect(compiled).toMatchInlineSnapshot(`"h1{color:blue}p{color:purple}.para{margin:0}#app{display:flex}[data-x]{color:teal}span.a.b{color:green}"`)
    })

    it('matches on the styles.css fixture (with data-beasties-container)', async () => {
      const html = fs.readFileSync(path.join(fixtureDir, 'index.html'), 'utf-8')
      const css = fs.readFileSync(path.join(fixtureDir, 'styles.css'), 'utf-8')
      const classic = await classicCritical(html, css)
      const compiled = compiledCritical(html, css)
      expect(compiled).toBe(classic)
    })

    it('matches for media queries and empty at-rule removal', async () => {
      const css = trim`
        @media (min-width: 40em) {
          h1 { font-size: 3em; }
          .unused { color: red; }
        }
        @media print {
          .unused { display: none; }
        }
        @supports (display: grid) {
          #app { display: grid; }
        }
        h1 { color: blue; }
      `
      const classic = await classicCritical(BASIC_HTML, css)
      const compiled = compiledCritical(BASIC_HTML, css)
      expect(compiled).toBe(classic)
      expect(compiled).toContain('@media (min-width: 40em) {h1{font-size:3em}}')
      expect(compiled).not.toContain('print')
    })

    it('preserves empty @layer blocks and layer statements', async () => {
      const css = trim`
        @layer a, b;
        @layer base {
          .unused { color: red; }
        }
        @layer components {
          h1 { color: blue; }
        }
      `
      const classic = await classicCritical(BASIC_HTML, css)
      const compiled = compiledCritical(BASIC_HTML, css)
      expect(compiled).toBe(classic)
      expect(compiled).toContain('@layer a, b;')
      expect(compiled).toContain('@layer base {}')
    })

    it('matches for beasties comment markers', async () => {
      const css = trim`
        /* beasties:exclude */
        h1 { color: blue; }
        /* beasties:include */
        .not-present { color: red; }
        /* beasties:exclude start */
        p { color: purple; }
        .para { margin: 0; }
        /* beasties:exclude end */
        #app { display: flex; }
      `
      const classic = await classicCritical(BASIC_HTML, css)
      const compiled = compiledCritical(BASIC_HTML, css)
      expect(compiled).toBe(classic)
      expect(compiled).toBe('.not-present{color:red}#app{display:flex}')
    })

    it('matches for allowRules', async () => {
      const css = trim`
        .always-inline { color: red; }
        .regex-match-1 { color: green; }
        .unused { color: blue; }
      `
      const allowRules = ['.always-inline', /^\.regex-match/]
      const classic = await classicCritical(BASIC_HTML, css, { allowRules })
      const sheet = compileSheet(css, { allowRules })
      const compiled = renderCriticalCss(sheet, scanHtml(BASIC_HTML), {}).css
      expect(compiled).toBe(classic)
      expect(compiled).toBe('.always-inline{color:red}.regex-match-1{color:green}')
    })

    it('matches for critical keyframes', async () => {
      const css = trim`
        h1 { animation: fade 1s ease infinite; }
        .unused { animation: spin 1s linear; }
        @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes spin { to { transform: rotate(360deg) } }
      `
      const classic = await classicCritical(BASIC_HTML, css)
      const compiled = compiledCritical(BASIC_HTML, css)
      expect(compiled).toBe(classic)
      expect(compiled).toContain('@keyframes fade')
      expect(compiled).not.toContain('@keyframes spin')

      const none = compiledCritical(BASIC_HTML, css, { keyframes: 'none' })
      expect(none).not.toContain('@keyframes')
      const allKeyframes = compiledCritical(BASIC_HTML, css, { keyframes: 'all' })
      expect(allKeyframes).toContain('@keyframes spin')
    })

    it('matches for critical font inlining', async () => {
      const css = trim`
        h1 { font-family: CriticalFont, sans-serif; }
        .unused { font-family: UnusedFont; }
        @font-face { font-family: CriticalFont; src: url(/fonts/critical.woff2); }
        @font-face { font-family: UnusedFont; src: url(/fonts/unused.woff2); }
      `
      const options = { inlineFonts: true, preloadFonts: false }
      const classic = await classicCritical(BASIC_HTML, css, options)
      const compiled = compiledCritical(BASIC_HTML, css, options)
      expect(compiled).toBe(classic)
      expect(compiled).toContain('CriticalFont')
      expect(compiled).not.toContain('UnusedFont')
    })

    it('matches for pseudo-class and pseudo-element selectors', async () => {
      const css = trim`
        h1:hover { color: red; }
        .para::first-line { font-weight: bold; }
        ::selection { background: gold; }
        .missing:focus { outline: none; }
        div:is(:hover, .unused) { color: teal; }
      `
      const classic = await classicCritical(BASIC_HTML, css)
      const compiled = compiledCritical(BASIC_HTML, css)
      expect(compiled).toBe(classic)
    })
  })

  describe('structural matching', () => {
    it('matches classic for combinator rules whose parts exist but do not match structurally', async () => {
      const html = trim`
        <html><head><link rel="stylesheet" href="/style.css"></head><body>
          <div class="a"><span>x</span></div>
          <div class="b">y</div>
        </body></html>
      `
      const css = trim`
        .a .b { color: red; }
        .a > .b { color: green; }
        .a .missing { color: blue; }
      `
      const classic = await classicCritical(html, css)
      const compiled = compiledCritical(html, css)
      expect(classic).toBe('')
      expect(compiled).toBe(classic)

      // token-only mode keeps the two where every part exists somewhere
      const tokenMode = compiledCritical(html, css, {}, { exact: false })
      expect(tokenMode).toBe('.a .b{color:red}.a > .b{color:green}')
    })

    it('matches descendant and child combinators exactly', async () => {
      const html = trim`
        <html><head><link rel="stylesheet" href="/style.css"></head><body>
          <div class="a"><p><span class="b">deep</span></p></div>
          <em class="c">outside</em>
        </body></html>
      `
      const css = trim`
        .a .b { color: red; }
        .a > .b { color: green; }
        .a > p > .b { color: blue; }
        .a .c { color: cyan; }
        body .a { color: black; }
      `
      const classic = await classicCritical(html, css)
      const compiled = compiledCritical(html, css)
      expect(compiled).toBe(classic)
      expect(compiled).toBe('.a .b{color:red}.a > p > .b{color:blue}body .a{color:black}')
    })

    it('matches sibling combinators exactly', async () => {
      const html = trim`
        <html><head><link rel="stylesheet" href="/style.css"></head><body>
          <p class="x">1</p>
          <span class="y">2</span>
          <i class="z">3</i>
        </body></html>
      `
      const css = trim`
        .x + .y { color: red; }
        .y + .x { color: green; }
        .x ~ .z { color: blue; }
        .z ~ .x { color: cyan; }
        .x + .z { color: magenta; }
      `
      const classic = await classicCritical(html, css)
      const compiled = compiledCritical(html, css)
      expect(compiled).toBe(classic)
      expect(compiled).toBe('.x + .y{color:red}.x ~ .z{color:blue}')
    })

    it('matches compound co-occurrence exactly', async () => {
      const html = trim`
        <html><head><link rel="stylesheet" href="/style.css"></head><body>
          <div class="a">1</div>
          <div class="b">2</div>
          <span class="c d">3</span>
        </body></html>
      `
      const css = trim`
        .a.b { color: red; }
        .c.d { color: green; }
        span.c { color: blue; }
        div.c { color: cyan; }
      `
      const classic = await classicCritical(html, css)
      const compiled = compiledCritical(html, css)
      expect(compiled).toBe(classic)
      expect(compiled).toBe('.c.d{color:green}span.c{color:blue}')
    })

    it('matches attribute value selectors exactly', async () => {
      const html = trim`
        <html><head><link rel="stylesheet" href="/style.css"></head><body>
          <div data-theme="dark" data-size="large-screen" lang="en-GB">x</div>
        </body></html>
      `
      const css = trim`
        [data-theme="dark"] { color: red; }
        [data-theme="light"] { color: green; }
        [data-size^="large"] { color: blue; }
        [data-size$="screen"] { color: cyan; }
        [data-size*="e-s"] { color: magenta; }
        [lang|="en"] { color: yellow; }
        [lang|="fr"] { color: black; }
      `
      const classic = await classicCritical(html, css)
      const compiled = compiledCritical(html, css)
      expect(compiled).toBe(classic)
      expect(compiled).toBe('[data-theme="dark"]{color:red}[data-size^="large"]{color:blue}[data-size$="screen"]{color:cyan}[data-size*="e-s"]{color:magenta}[lang|="en"]{color:yellow}')
    })

    it('bounds structural matching to the container subtree', async () => {
      const html = trim`
        <html><head><link rel="stylesheet" href="/style.css"></head><body>
          <div class="wrapper">
            <main class="scope" data-beasties-container>
              <div class="row"><span class="cell">x</span></div>
            </main>
          </div>
        </body></html>
      `
      const css = trim`
        .row .cell { color: red; }
        .wrapper .cell { color: green; }
        main .cell { color: blue; }
        .scope .cell { color: cyan; }
      `
      const classic = await classicCritical(html, css)
      const compiled = compiledCritical(html, css)
      expect(compiled).toBe(classic)
      // only chains lying strictly inside the container match; ancestors
      // outside it (and the container element itself) don't count
      expect(compiled).toBe('.row .cell{color:red}')
    })

    it('survives JSON round-tripping of programs', () => {
      const html = '<html><body><div class="a"><span class="b">x</span></div></body></html>'
      const sheet: ReturnType<typeof compileSheet> = JSON.parse(JSON.stringify(compileSheet('.a .b { color: red } .b .a { color: green }')))
      const tokens = scanHtml(html, collectPrograms([sheet]))
      expect(renderCriticalCss(sheet, tokens, {}).css).toBe('.a .b{color:red}')
    })

    it('never drops a rule that classic would keep', async () => {
      const html = fs.readFileSync(path.join(fixtureDir, 'index.html'), 'utf-8')
      const css = fs.readFileSync(path.join(fixtureDir, 'styles.css'), 'utf-8')
      const classic = await classicCritical(html, css)
      const compiled = compiledCritical(html, css)
      for (const rule of classic.split('}').filter(Boolean)) {
        expect(compiled).toContain(rule)
      }
    })
  })

  describe('pathological input', () => {
    const sheet = () => compileSheet('h1 { color: blue; }', { href: 'style.css' })

    it('handles long whitespace runs inside a link tag in linear time', () => {
      const { process } = createProcessor([sheet()], { preload: 'swap' })
      const html = `<html><head><link href="/style.css" rel="stylesheet"${' '.repeat(64_000)}data-x="1"></head><body><h1>hi</h1></body></html>`

      const start = performance.now()
      const result = process(html)
      expect(performance.now() - start).toBeLessThan(500)

      expect(result).toContain('<style>h1{color:blue}</style>')
      expect(result).toContain('rel="preload"')
    })

    it('handles hrefs with many query and hash characters in linear time', () => {
      const { process } = createProcessor([sheet()])
      const html = `<html><head><link href="/style.css?${'#'.repeat(64_000)}\n" rel="stylesheet"></head><body><h1>hi</h1></body></html>`

      const start = performance.now()
      const result = process(html)
      expect(performance.now() - start).toBeLessThan(500)

      expect(result).toContain('<style>h1{color:blue}</style>')
    })

    it('appends an attribute to tags with unusual endings', () => {
      const { process } = createProcessor([sheet()], { preload: 'media' })
      for (const [tag, expected] of [
        ['<link rel="stylesheet" href="/style.css">', '<link rel="stylesheet" href="/style.css" media="print" onload'],
        ['<link rel="stylesheet" href="/style.css"/>', '<link rel="stylesheet" href="/style.css" media="print" onload'],
        ['<link rel="stylesheet" href="/style.css"  />', '<link rel="stylesheet" href="/style.css" media="print" onload'],
      ]) {
        const result = process(`<html><head>${tag}</head><body><h1>hi</h1></body></html>`)
        expect(result, tag).toContain(expected)
      }
    })
  })

  describe('scanHtml', () => {
    it('collects tags, classes, ids and attributes', () => {
      const tokens = scanHtml(BASIC_HTML)
      expect(tokens.tags).toContain('h1')
      expect(tokens.classes).toContain('para')
      expect(tokens.classes).toContain('a')
      expect(tokens.classes).toContain('b')
      expect(tokens.ids).toContain('app')
      expect(tokens.attrs).toContain('data-x')
    })

    it('ignores raw text content and comments', () => {
      const tokens = scanHtml(trim`
        <html><body>
        <!-- <div class="commented"></div> -->
        <script>const html = '<div class="scripted"></div>'</script>
        <style>.styled { color: red }</style>
        <textarea><div class="textarea-content"></div></textarea>
        <div class="real"></div>
        </body></html>
      `)
      expect(tokens.classes).toContain('real')
      expect(tokens.classes).not.toContain('commented')
      expect(tokens.classes).not.toContain('scripted')
      expect(tokens.classes).not.toContain('textarea-content')
    })

    it('scopes tokens to data-beasties-container', () => {
      const tokens = scanHtml(trim`
        <html><body>
        <div class="outside"></div>
        <main data-beasties-container class="on-container">
          <div class="inside"><span id="inner-id"></span></div>
        </main>
        <footer class="also-outside"></footer>
        </body></html>
      `)
      expect(tokens.classes).toContain('inside')
      expect(tokens.classes).toContain('on-container')
      expect(tokens.ids).toContain('inner-id')
      expect(tokens.classes).not.toContain('outside')
      expect(tokens.classes).not.toContain('also-outside')
    })
  })

  describe('data-beasties-skip', () => {
    const assets: Record<string, string> = {
      '/styles.css': 'h1 { color: blue; }',
      '/theme.css': 'body { background: red; }',
    }

    const HTML = trim`
      <html>
        <head>
          <link rel="stylesheet" href="/styles.css">
          <link rel="stylesheet" href="/theme.css" data-beasties-skip>
        </head>
        <body><h1>Hello</h1></body>
      </html>
    `

    function classic(options: ConstructorParameters<typeof Beasties>[0] = {}) {
      const beasties = new Beasties({ reduceInlineStyles: false, path: '/', logLevel: 'silent', ...options })
      beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
      return beasties.process(HTML)
    }

    function compiled(options: Parameters<typeof createProcessor>[1] = {}) {
      const sheets = Object.entries(assets).map(([href, css]) => compileSheet(css, { href }))
      return createProcessor(sheets, options).process(HTML)
    }

    for (const preload of [false, 'media', 'swap', 'js', 'body'] as const) {
      it(`leaves the skipped link untouched on both paths with preload: ${preload}`, async () => {
        for (const result of [await classic({ preload }), compiled({ preload })]) {
          expect(result).toContain('<link rel="stylesheet" href="/theme.css" data-beasties-skip>')
          expect(result).not.toMatch(/theme\.css[^>]*onload/)
          expect(result).not.toMatch(/theme\.css[^>]*rel="preload"/)
          expect(result).not.toMatch(/noscript[^>]*theme/)
          expect(result).not.toContain('background:red')
          expect(result).toContain('color:blue')
        }
      })
    }

    it('excludes the skipped stylesheet from extract()', () => {
      const sheets = Object.entries(assets).map(([href, css]) => compileSheet(css, { href }))
      const { extract } = createProcessor(sheets)
      expect(extract(HTML).css).toBe('h1{color:blue}')
    })
  })

  describe('whole-sheet inlining', () => {
    const CSS = trim`
      h1 { color: blue; }
      .unused { color: red; }
      @keyframes unused-spin { to { opacity: 1 } }
    `

    function classic(options: ConstructorParameters<typeof Beasties>[0]) {
      const beasties = new Beasties({ reduceInlineStyles: false, path: '/', logLevel: 'silent', ...options })
      beasties.readFile = () => CSS
      return beasties.process(BASIC_HTML)
    }

    function compiled(options: Parameters<typeof createProcessor>[1]) {
      return createProcessor([compileSheet(CSS, { href: 'style.css' })], options).process(BASIC_HTML)
    }

    it('inlines a stylesheet below inlineThreshold in full and drops its link', async () => {
      const result = compiled({ inlineThreshold: 1000 })
      // everything, including rules and keyframes that aren't critical
      expect(result).toContain('<style>h1{color:blue}.unused{color:red}@keyframes unused-spin {to{opacity:1}}</style>')
      expect(result).not.toContain('<link')
      expect(result).not.toContain('<noscript>')

      const classicResult = await classic({ inlineThreshold: 1000 })
      expect(classicResult).not.toContain('<link')
      expect(classicResult).toContain('.unused')
      expect(classicResult).toContain('unused-spin')
    })

    it('prunes as usual when the stylesheet is above inlineThreshold', async () => {
      const result = compiled({ inlineThreshold: 10, preload: false })
      expect(result).toContain('<style>h1{color:blue}</style>')
      expect(result).toContain('<link rel="stylesheet" href="/style.css">')

      const classicResult = await classic({ inlineThreshold: 10, preload: false })
      expect(classicResult).toContain('<link rel="stylesheet" href="/style.css">')
      expect(classicResult).not.toContain('.unused')
    })

    it('inlines in full when what is left for the stylesheet is below minimumExternalSize', () => {
      const result = compiled({ minimumExternalSize: 1000 })
      expect(result).toContain('.unused{color:red}')
      expect(result).toContain('unused-spin')
      expect(result).not.toContain('<link')
    })

    it('keeps the stylesheet when the remainder is above minimumExternalSize', () => {
      const result = compiled({ minimumExternalSize: 10, preload: false })
      expect(result).toContain('<style>h1{color:blue}</style>')
      expect(result).toContain('<link rel="stylesheet" href="/style.css">')
    })

    it('measures the remainder, not the whole stylesheet', () => {
      const sheet = compileSheet(CSS, { href: 'style.css' })
      const tokens = scanHtml(BASIC_HTML, collectPrograms([sheet]))
      const { css, inverseCss } = renderCriticalCss(sheet, tokens, { inverse: true })
      expect(css).toBe('h1{color:blue}')
      expect(inverseCss).toBe('.unused{color:red}@keyframes unused-spin {to{opacity:1}}')

      // a threshold between the remainder and the full sheet inlines in full
      const between = inverseCss!.length + 1
      expect(compiled({ minimumExternalSize: between })).not.toContain('<link')
      expect(compiled({ minimumExternalSize: inverseCss!.length })).toContain('<link')
    })

    it('overrides any preload strategy for the inlined sheet', () => {
      for (const preload of ['js', 'media', 'swap', 'body', undefined] as const) {
        const result = compiled({ inlineThreshold: 1000, preload })
        expect(result, String(preload)).not.toContain('<link')
        expect(result, String(preload)).not.toContain('<script')
        expect(result, String(preload)).not.toContain('<noscript>')
      }
    })

    it('applies per stylesheet', () => {
      const small = compileSheet('h1 { color: blue; } .unused-small { color: red; }', { href: 'small.css' })
      const big = compileSheet(`.lead { color: teal; }${' '.repeat(500)}.unused-big { color: red; }`, { href: 'big.css' })
      const html = BASIC_HTML.replace(
        '<link rel="stylesheet" href="/style.css">',
        '<link rel="stylesheet" href="/small.css"><link rel="stylesheet" href="/big.css">',
      )
      const result = createProcessor([small, big], { inlineThreshold: 100, preload: false }).process(html)
      expect(result).toContain('.unused-small{color:red}')
      expect(result).not.toContain('.unused-big')
      expect(result).not.toContain('small.css')
      expect(result).toContain('<link rel="stylesheet" href="/big.css">')
    })

    it('is reflected by extract()', () => {
      const { extract } = createProcessor([compileSheet(CSS, { href: 'style.css' })], { inlineThreshold: 1000 })
      expect(extract(BASIC_HTML).css).toContain('.unused{color:red}')
    })

    it('still preloads fonts for a fully inlined sheet', () => {
      const css = trim`
        h1 { font-family: MyFont; }
        @font-face { font-family: MyFont; src: url(/fonts/my.woff2); }
      `
      const { process } = createProcessor([compileSheet(css, { href: 'style.css' })], { inlineThreshold: 1000, fonts: true })
      const result = process(BASIC_HTML)
      expect(result).toContain('<link rel="preload" as="font" crossorigin="anonymous" href="/fonts/my.woff2">')
      expect(result).not.toContain('rel="stylesheet"')
    })
  })

  describe('url() rebasing', () => {
    const CSS = trim`
      h1 { background: url(bg.png); }
      .lead { background: url("../img/a.png"); }
      p { background: url(/absolute.png); }
      div { background: url(https://cdn.example.com/remote.png); }
      @font-face { font-family: MyFont; src: url(fonts/my.woff2); }
      .lead { font-family: MyFont; }
    `
    const HTML = trim`
      <html>
        <head><link rel="stylesheet" href="/assets/css/style.css"></head>
        <body><h1>hi</h1><p>p</p><div class="lead">l</div></body>
      </html>
    `

    it('rebases relative urls against the stylesheet location', async () => {
      const beasties = new Beasties({ reduceInlineStyles: false, path: '/', logLevel: 'silent', preload: false, inlineFonts: true, preloadFonts: false })
      beasties.readFile = () => CSS
      const classicCss = (await beasties.process(HTML)).match(/<style>([\s\S]*?)<\/style>/)![1]

      const sheet = compileSheet(CSS, { href: '/assets/css/style.css' })
      const compiledCss = renderCriticalCss(sheet, scanHtml(HTML, collectPrograms([sheet])), { inlineFonts: true, preloadFonts: false }).css

      expect(compiledCss).toBe(classicCss)
      expect(compiledCss).toContain('url(/assets/css/bg.png)')
      expect(compiledCss).toContain('url("/assets/img/a.png")')
      expect(compiledCss).toContain('url(/absolute.png)')
      expect(compiledCss).toContain('url(https://cdn.example.com/remote.png)')
      expect(compiledCss).toContain('url(/assets/css/fonts/my.woff2)')
    })

    it('rebases font preload hrefs', () => {
      const sheet = compileSheet(CSS, { href: '/assets/css/style.css' })
      const { fontPreloads } = renderCriticalCss(sheet, scanHtml(HTML, collectPrograms([sheet])), { fonts: true })
      expect(fontPreloads).toEqual(['/assets/css/fonts/my.woff2'])
    })

    it('leaves urls alone when the sheet sits alongside the document', () => {
      const sheet = compileSheet('h1 { background: url(bg.png) }', { href: 'style.css' })
      expect(renderCriticalCss(sheet, scanHtml(HTML, collectPrograms([sheet])), {}).css).toBe('h1{background:url(bg.png)}')
    })
  })

  describe('createProcessor', () => {
    const makeProcessor = (options: Parameters<typeof createProcessor>[1] = {}, css = 'h1 { color: blue; }\n.unused { color: red; }') =>
      createProcessor([compileSheet(css, { href: 'style.css' })], options)

    it('inlines critical css for matching stylesheet links', () => {
      const { process } = makeProcessor({ preload: false })
      const result = process(BASIC_HTML)
      expect(result).toContain('<style>h1{color:blue}</style><link rel="stylesheet" href="/style.css">')
      expect(result).not.toContain('onload=')
      expect(result).not.toContain('<noscript>')
    })

    it('uses the default preload strategy correctly', () => {
      const { process } = makeProcessor()
      const result = process(BASIC_HTML)
      expect(result).toContain('<style>h1{color:blue}</style><link rel="preload" href="/style.css" as="style">')
      expect(result).toContain('<link rel="stylesheet" href="/style.css"></body>')
      expect(result).not.toContain('<noscript>')
    })

    it('uses the "body" preload strategy correctly', () => {
      const { process } = makeProcessor({ preload: 'body' })
      const result = process(BASIC_HTML)
      expect(result).toContain('<style>h1{color:blue}</style>')
      expect(result).toContain('<link rel="stylesheet" href="/style.css"></body>')
      expect(result.match(/<link/g)).toHaveLength(1)
    })

    it('uses the "media" preload strategy correctly', () => {
      const { process } = makeProcessor({ preload: 'media' })
      const result = process(BASIC_HTML)
      expect(result).toContain(`<link rel="stylesheet" href="/style.css" media="print" onload="this.media='all'">`)
      expect(result).toContain('<noscript><link rel="stylesheet" href="/style.css"></noscript>')
      expect(result).toContain('<style>h1{color:blue}</style>')
    })

    it('uses the "swap" preload strategy correctly', () => {
      const { process } = makeProcessor({ preload: 'swap' })
      const result = process(BASIC_HTML)
      expect(result).toContain(`<link rel="preload" href="/style.css" onload="this.rel='stylesheet'" as="style">`)
      expect(result).toContain('<noscript><link rel="stylesheet" href="/style.css"></noscript>')
    })

    it('uses the "swap-high" preload strategy correctly', () => {
      const { process } = makeProcessor({ preload: 'swap-high' })
      const result = process(BASIC_HTML)
      expect(result).toContain(`<link rel="alternate stylesheet preload" href="/style.css" title="styles" as="style" onload="this.title='';this.rel='stylesheet'">`)
      expect(result).toContain('<noscript><link rel="stylesheet" href="/style.css"></noscript>')
    })

    it('uses the "swap-low" preload strategy correctly', () => {
      const { process } = makeProcessor({ preload: 'swap-low' })
      const result = process(BASIC_HTML)
      expect(result).toContain(`<link rel="alternate stylesheet" href="/style.css" title="styles" onload="this.title='';this.rel='stylesheet'">`)
      expect(result).toContain('<noscript><link rel="stylesheet" href="/style.css"></noscript>')
    })

    it('uses the "js" preload strategy correctly', () => {
      const { process } = makeProcessor({ preload: 'js' })
      const result = process(BASIC_HTML)
      expect(result).toContain('<link rel="preload" href="/style.css" as="style">')
      expect(result).toContain(`<script data-href="/style.css" data-media="all">function $loadcss(u,m,l){(l=document.createElement('link')).rel='stylesheet';l.href=u;document.head.appendChild(l)}$loadcss(document.currentScript.dataset.href,document.currentScript.dataset.media)</script>`)
      // classic ordering: link, noscript, script
      expect(result).toMatch(/<link rel="preload"[^>]*><noscript>[\s\S]*?<\/noscript><script/)
    })

    it('uses the "js-lazy" preload strategy correctly', () => {
      const { process } = makeProcessor({ preload: 'js-lazy' })
      const result = process(BASIC_HTML)
      expect(result).toContain(`l.media='print';l.onload=function(){l.media=m};l.href=u`)
      expect(result).toContain('data-media="all"')
    })

    it('respects noscriptFallback: false', () => {
      const { process } = makeProcessor({ preload: 'swap', noscriptFallback: false })
      const result = process(BASIC_HTML)
      expect(result).toContain('onload=')
      expect(result).not.toContain('<noscript>')
    })

    it('preserves a valid media attribute and sanitizes an unsafe one', () => {
      const html = BASIC_HTML.replace('<link rel="stylesheet" href="/style.css">', '<link rel="stylesheet" href="/style.css" media="(min-width: 40em)">')
      const { process } = makeProcessor({ preload: 'media' })
      expect(process(html)).toContain(`onload="this.media='(min-width: 40em)'"`)

      const unsafe = BASIC_HTML.replace('<link rel="stylesheet" href="/style.css">', `<link rel="stylesheet" href="/style.css" media="'&quot;><script>alert(1)</script>">`)
      expect(process(unsafe)).toContain(`onload="this.media='all'"`)
    })

    it('removes id attributes from cloned links', () => {
      const html = BASIC_HTML.replace('<link rel="stylesheet" href="/style.css">', '<link id="main-css" rel="stylesheet" href="/style.css">')
      const { process } = makeProcessor()
      const result = process(html)
      expect(result).toContain('<link id="main-css" rel="preload" href="/style.css" as="style">')
      expect(result).toContain('<link rel="stylesheet" href="/style.css"></body>')
      expect(result.match(/id="main-css"/g)).toHaveLength(1)
    })

    it('emits font preload links', () => {
      const css = trim`
        h1 { font-family: MyFont; }
        @font-face { font-family: MyFont; src: url(/fonts/my.woff2); }
      `
      const { process } = createProcessor([compileSheet(css, { href: 'style.css' })], { fonts: true })
      const result = process(BASIC_HTML)
      expect(result).toContain('<link rel="preload" as="font" crossorigin="anonymous" href="/fonts/my.woff2">')
    })

    it('leaves html untouched when no sheets match', () => {
      const { process } = createProcessor([compileSheet('h1{color:blue}', { href: 'other.css' })])
      expect(process(BASIC_HTML)).toBe(BASIC_HTML)
    })

    it('caches rendered critical css by document token fingerprint', () => {
      let rulesAccesses = 0
      const compiled = compileSheet('h1 { color: blue; } .unused { color: red; }', { href: 'style.css' })
      const sheet = Object.create(compiled, {
        rules: {
          get() {
            rulesAccesses++
            return compiled.rules
          },
        },
      }) as typeof compiled

      const { process } = createProcessor([sheet])
      const baseline = rulesAccesses

      const first = process(BASIC_HTML)
      expect(rulesAccesses).toBeGreaterThan(baseline)
      const afterFirst = rulesAccesses

      expect(process(BASIC_HTML)).toBe(first)
      expect(rulesAccesses).toBe(afterFirst)

      const otherHtml = BASIC_HTML.replace('<h1>', '<h1 class="extra">')
      process(otherHtml)
      expect(rulesAccesses).toBeGreaterThan(afterFirst)
    })

    it('supports disabling the cache and bounding its size', () => {
      let rulesAccesses = 0
      const compiled = compileSheet('h1 { color: blue; }', { href: 'style.css' })
      const sheet = Object.create(compiled, {
        rules: {
          get() {
            rulesAccesses++
            return compiled.rules
          },
        },
      }) as typeof compiled

      const uncached = createProcessor([sheet], { cache: false })
      const baseline = rulesAccesses
      uncached.process(BASIC_HTML)
      const afterFirst = rulesAccesses
      uncached.process(BASIC_HTML)
      expect(rulesAccesses).toBeGreaterThan(afterFirst)
      expect(afterFirst).toBeGreaterThan(baseline)

      const bounded = createProcessor([sheet], { cache: { maxSize: 1 } })
      const otherHtml = BASIC_HTML.replace('<h1>', '<h1 class="extra">')
      bounded.process(BASIC_HTML)
      bounded.process(otherHtml)
      const beforeEvicted = rulesAccesses
      // BASIC_HTML's entry was evicted by otherHtml, so this re-renders
      bounded.process(BASIC_HTML)
      expect(rulesAccesses).toBeGreaterThan(beforeEvicted)
    })

    it('warns when a stylesheet link has no matching compiled sheet', () => {
      const warnings: string[] = []
      const { process } = makeProcessor({ preload: false, logger: { warn: message => void warnings.push(message) } })
      process(trim`
        <html>
          <head>
            <link rel="stylesheet" href="/style.css">
            <link rel="stylesheet" href="/missing.css">
            <link rel="stylesheet" href="/not-a-sheet">
          </head>
          <body><h1>Hello</h1></body>
        </html>
      `)
      expect(warnings).toEqual(['Unable to locate stylesheet: /missing.css'])
    })

    it('produces a JSON-serializable plan', () => {
      const css = fs.readFileSync(path.join(fixtureDir, 'styles.css'), 'utf-8')
      const sheet = compileSheet(css, { href: 'styles.css' })
      const roundTripped = JSON.parse(JSON.stringify(sheet))
      const html = fs.readFileSync(path.join(fixtureDir, 'index.html'), 'utf-8')
      expect(renderCriticalCss(roundTripped, scanHtml(html), {}).css).toBe(renderCriticalCss(sheet, scanHtml(html), {}).css)
    })
  })
})
