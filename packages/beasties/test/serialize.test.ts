import { describe, expect, it } from 'vitest'
import { parseStylesheet, serializeStylesheet } from '../src/css'

describe('serialize CSS AST', () => {
  it('should correctly minify empty property declarations', () => {
    const css = `
      * {
        --un-backdrop-saturate: ;
        --un-backdrop-sepia: ;
      }
      :not(.test) {
        height:inherit;
        width:inherit;
      }
    `
    const ast = parseStylesheet(css)

    expect(serializeStylesheet(ast, { compress: true })).toMatchInlineSnapshot(
      `"*{--un-backdrop-saturate: ;--un-backdrop-sepia: }:not(.test){height:inherit;width:inherit}"`,
    )
  })

  it('should preserve trailing semicolon on a nested at-rule sub-layer declaration', () => {
    // `@layer parent { @layer a, b; }` is a nested sub-layer declaration; the
    // `;` terminates the inner statement and must survive minification.
    const css = `
      @layer parent { @layer a, b; }
      @layer parent.a { .foo { color: red; } }
    `
    const ast = parseStylesheet(css)

    expect(serializeStylesheet(ast, { compress: true })).toMatchInlineSnapshot(
      `"@layer parent {@layer a, b;}@layer parent.a {.foo{color:red}}"`,
    )
  })

  it('should still drop the redundant trailing semicolon inside an at-rule whose last child is a declaration', () => {
    const css = `
      @font-face {
        font-family: 'X';
        src: url('/x.woff2');
      }
    `
    const ast = parseStylesheet(css)

    expect(serializeStylesheet(ast, { compress: true })).toMatchInlineSnapshot(
      `"@font-face {font-family:'X';src:url('/x.woff2')}"`,
    )
  })
})
