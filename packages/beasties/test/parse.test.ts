import { describe, expect, it, vi } from 'vitest'
import Beasties from '../src/index'

describe('selector normalisation', () => {
  it('should handle complex selectors', async () => {
    vi.spyOn(console, 'warn')
    const beasties = new Beasties()
    const result = await beasties.process(`
      <html>
        <body>
          <style> div > :not(.foo) > * { color:red; } </style>
          <style> div > :not(.foo) { color:red; } </style>
          <div>
            <div><div></div></div>
          </div>
        </body>
      </html>
    `)

    expect(result.replace(/^ {4}/gm, '')).toMatchInlineSnapshot(`
      "
        <html data-beasties-container>
          <body>
            <style>div > :not(.foo) > *{color:red}div > :not(.foo){color:red}</style>
            
            <div>
              <div><div></div></div>
            </div>
          </body>
        </html>
      "
    `)
    expect(console.warn).not.toBeCalled()
  })

  it('should preserve valid combinator chains', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    const beasties = new Beasties()
    const html = `
      <html><head>
        <style>
          /* Child + general sibling */
          .form-floating>~label { color:red }
          /* Child + adjacent sibling */
          .btn-group>+.btn { color:blue }
          /* Lobotomized owl */
          .lobot>*+* { margin:0 }
          /* Mixed sibling chains */
          .foo~+span { color:aqua }
          .bar+~div { color:salmon }
          /* Sibling then child */
          .baz~>h1 { font-weight:bold }
          .qux+>p { text-align:center }
        </style>
      </head><body>
        <div class="form-floating"><input/><label>F</label></div>
        <div class="btn-group"><button></button><button class="btn">B</button></div>
        <div class="lobot"><span></span><b></b></div>
        <div class="foo"></div><em></em><span></span>
        <div class="bar"></div><i></i><div></div>
        <div class="baz"></div><div><h1>Header</h1></div>
        <div class="qux"></div><div><p>Para</p></div>
      </body></html>
    `
    const out = await beasties.process(html)

    expect(out).toContain('.form-floating>~label{color:red}')
    expect(out).toContain('.btn-group>+.btn{color:blue}')
    expect(out).toContain('.lobot>*+*{margin:0}')
    expect(out).toContain('.foo~+span{color:aqua}')
    expect(out).toContain('.bar+~div{color:salmon}')
    expect(out).toContain('.baz~>h1{font-weight:bold}')
    expect(out).toContain('.qux+>p{text-align:center}')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
