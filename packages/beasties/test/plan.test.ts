import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { compileSheet, encodePlan } from '../src/compiler'
import { collectPrograms, createProcessor, decodePlan, renderCriticalCss, scanHtml } from '../src/runtime'

const fixtureDir = fileURLToPath(new URL('./src', import.meta.url))

function roundTrip(sheet: ReturnType<typeof compileSheet>) {
  return decodePlan(JSON.parse(JSON.stringify(encodePlan(sheet))))
}

function critical(sheet: ReturnType<typeof compileSheet>, html: string, options = {}) {
  return renderCriticalCss(sheet, scanHtml(html, collectPrograms([sheet])), options).css
}

const HTML = `
<html><head><link rel="stylesheet" href="/style.css"></head><body>
  <div id="app" class="card md:flex" data-theme="dark" lang="en-GB">
    <h1 class="title big">hi</h1>
    <p class="lead">text</p>
    <span class="a b">x</span>
  </div>
  <footer><span class="note">n</span></footer>
</body></html>`

const CASES: Record<string, string> = {
  'simple selectors': 'h1 { color: blue } .unused { color: red } #app { display: flex } div { margin: 0 }',
  'compound and attribute selectors': '.a.b { color: red } [data-theme="dark"] { color: blue } [lang|="en"] { color: teal } h1.title.big { color: green } [data-missing] { color: pink }',
  'combinators': '#app .lead { color: red } #app > .title { color: blue } .title + .lead { color: teal } .lead ~ .a { color: olive } .note .a { color: gray }',
  'escaped class names': '.md\\:flex { display: flex } .lg\\:hidden { display: none } .md\\:flex.card { color: red }',
  'media and supports': '@media (min-width: 40em) { .title { font-size: 3rem } .unused { color: red } } @supports (display: grid) { #app { display: grid } }',
  'layers': '@layer a, b; @layer base { .unused { color: red } } @layer components { h1 { color: blue } }',
  'keyframes and fonts': '.lead { animation: fade 1s; font-family: MyFont } @keyframes fade { from { opacity: 0 } } @keyframes spin { to { opacity: 1 } } @font-face { font-family: MyFont; src: url(/f.woff2) } @font-face { font-family: Unused; src: url(/u.woff2) }',
  'comment markers': '/* beasties:exclude */ h1 { color: blue } /* beasties:include */ .never { color: red } /* beasties:include start */ .also-never { color: teal } /* beasties:include end */',
  'nested rules': '.card { color: red; & .lead { color: blue } } .unused { color: red; & .lead { color: teal } }',
  'statement at-rules': '@charset "utf-8"; @import url("other.css"); h1 { color: blue }',
  'pseudo classes': 'h1:hover { color: red } .lead::first-line { font-weight: bold } .missing:focus { outline: 0 } div:is(:hover, .card) { color: teal }',
  'repeated bodies': `${Array.from({ length: 20 }, (_, i) => `.rep-${i} { margin: ${i % 3}px; padding: 2px }`).join('\n')}\n.card { margin: 1px; padding: 2px }`,
}

describe('compact plan format', () => {
  describe('round-trips without changing output', () => {
    for (const [label, css] of Object.entries(CASES)) {
      it(label, () => {
        const sheet = compileSheet(css, { href: 'style.css' })
        const options = { fonts: true, keyframes: 'critical' as const }
        expect(critical(roundTrip(sheet), HTML, options)).toBe(critical(sheet, HTML, options))
      })
    }

    it('every fixture stylesheet', () => {
      const html = fs.readFileSync(path.join(fixtureDir, 'index.html'), 'utf-8')
      for (const file of ['styles.css', 'styles2.css', 'colors.css', 'prune-source.css', 'large.css']) {
        const sheet = compileSheet(fs.readFileSync(path.join(fixtureDir, file), 'utf-8'), { href: file })
        expect(critical(roundTrip(sheet), html), file).toBe(critical(sheet, html))
      }
    })

    it('preserves allowRules and non-exact compilation', () => {
      const css = '.always { color: red } .a .b { color: blue }'
      for (const compileOptions of [{ allowRules: ['.always', /^\.a/] }, { exact: false }]) {
        const sheet = compileSheet(css, { href: 'style.css', ...compileOptions })
        expect(critical(roundTrip(sheet), HTML)).toBe(critical(sheet, HTML))
      }
    })
  })

  describe('encoding', () => {
    function encodedRules(css: string) {
      return encodePlan(compileSheet(css, { href: 'style.css' }))[5]
    }

    it('stores selector-derivable conditions as markers', () => {
      const [byClass, byId, byTag] = encodedRules('.foo { color: red } #bar { color: red } DIV { color: red }')
      // [flags, selector, body, match]
      expect(byClass![3]).toEqual([1])
      expect(byId![3]).toEqual([2])
      expect(byTag![3]).toEqual([3])
    })

    it('does not use markers when the selector text differs from the parsed value', () => {
      const [escaped] = encodedRules('.md\\:flex { display: flex }')
      expect(escaped![3]).not.toEqual([1])

      const sheet = compileSheet('.md\\:flex { display: flex }', { href: 'style.css' })
      const decoded = roundTrip(sheet)
      expect(decoded.rules[0]!.match).toEqual([{ classes: ['md:flex'] }])
      expect(critical(decoded, '<html><body><div class="md:flex"></div></body></html>')).toBe('.md\\:flex{display:flex}')
    })

    it('drops token fields when a structural program decides the match', () => {
      const sheet = compileSheet('.a > .b { color: red }', { href: 'style.css' })
      const original = sheet.rules[0]!.match![0]
      expect(original).toMatchObject({ classes: ['a', 'b'], program: expect.any(Object) })

      const decoded = roundTrip(sheet).rules[0]!.match![0]
      expect(decoded).toEqual({ program: { combinators: ['>'], compounds: [{ classes: ['a'] }, { classes: ['b'] }] } })
    })

    it('pools strings used more than once and inlines unique ones', () => {
      const plan = encodePlan(compileSheet(CASES['repeated bodies']!, { href: 'style.css' }))
      const pool = plan[3]
      expect(pool).toContain('{margin:1px;padding:2px}')
      expect(pool.some(entry => entry.includes('rep-0'))).toBe(false)

      const bodies = plan[5].map(rule => rule[2])
      expect(bodies.filter(body => typeof body === 'number').length).toBeGreaterThan(15)
    })

    it('shares repeated at-rule wrappers', () => {
      const css = '@media (min-width: 40em) { h1 { color: red } .lead { color: blue } } @media (min-width: 40em) { .title { color: teal } }'
      const plan = encodePlan(compileSheet(css, { href: 'style.css' }))
      expect(plan[4]).toHaveLength(1)
      for (const rule of plan[5]) {
        expect(rule.at(-1)).toBe(0)
      }
    })

    it('drops build-time warnings', () => {
      const sheet = compileSheet('h1 { color: blue }', { href: 'style.css' })
      sheet.warnings.push('some selector -> failed')
      expect(JSON.stringify(encodePlan(sheet))).not.toContain('failed')
      expect(roundTrip(sheet).warnings).toEqual([])
    })

    it('keeps fields whose pooled string lands at pool index 0', () => {
      const css = `
        @font-face { font-family: poppins; src: url(/poppins.woff2) }
        .a poppins { color: red }
        .b poppins { color: blue }
        [data-font="poppins"] { color: teal }
        [data-label="poppins"] { color: olive }
      `
      const sheet = compileSheet(css, { href: 'style.css' })
      const plan = encodePlan(sheet)
      expect(plan[3][0]).toBe('poppins')

      const decoded = roundTrip(sheet)
      expect(decoded.rules[0]!.fontFace).toEqual({ family: 'poppins', src: '/poppins.woff2' })
      expect(decoded.rules[1]!.match).toEqual([{ program: { combinators: [' '], compounds: [{ classes: ['a'] }, { tag: 'poppins' }] } }])
      expect(decoded.rules[3]!.match).toEqual([{ program: { combinators: [], compounds: [{ attrs: [{ name: 'data-font', action: 'equals', value: 'poppins' }] }] } }])
    })

    it('keeps href and source size', () => {
      const sheet = compileSheet('h1 { color: blue }', { href: '_nuxt/entry.abc.css' })
      const decoded = roundTrip(sheet)
      expect(decoded.href).toBe('_nuxt/entry.abc.css')
      expect(decoded.size).toBe(sheet.size)

      const anonymous = roundTrip(compileSheet('h1 { color: blue }'))
      expect(anonymous.href).toBeUndefined()
    })

    it('is smaller than the equivalent CompiledSheet json', () => {
      for (const css of Object.values(CASES)) {
        const sheet = compileSheet(css, { href: 'style.css' })
        const encoded = JSON.stringify(encodePlan(sheet)).length
        expect(encoded).toBeLessThan(JSON.stringify(sheet).length)
      }
    })
  })

  describe('createProcessor', () => {
    it('accepts compact plans directly', () => {
      const css = 'h1 { color: blue } .unused { color: red } .a > .b { color: teal }'
      const sheet = compileSheet(css, { href: 'style.css' })
      const fromSheet = createProcessor([sheet]).process(HTML)
      const fromPlan = createProcessor([JSON.parse(JSON.stringify(encodePlan(sheet)))]).process(HTML)
      expect(fromPlan).toBe(fromSheet)
    })

    it('accepts a mix of compact plans and compiled sheets', () => {
      const a = compileSheet('h1 { color: blue }', { href: 'a.css' })
      const b = compileSheet('.lead { color: red }', { href: 'b.css' })
      const html = HTML.replace('<link rel="stylesheet" href="/style.css">', '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css">')
      expect(createProcessor([encodePlan(a), b]).extract(html).css)
        .toBe(createProcessor([a, b]).extract(html).css)
    })
  })
})
