import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'
import Beasties from '../src/index'

// function hasEvilOnload(html) {
//   const $ = cheerio.load(html, { scriptingEnabled: true })
//   return $('[onload]').attr('onload').includes(`''-alert(1)-''`)
// }

function hasEvilScript(html: string) {
  const $ = cheerio.load(html, { scriptingEnabled: true })
  const scripts = Array.from($('script'))
  return scripts.some(s => (s as unknown as HTMLScriptElement).textContent?.trim() === 'alert(1)')
}

describe('beasties', () => {
  it('should not decode entities', async () => {
    const beasties = new Beasties({})
    const html = await beasties.process(`
            <html>
                <body>
                    &lt;script&gt;alert(1)&lt;/script&gt;
        `)
    expect(hasEvilScript(html)).toBeFalsy()
  })
  it('should not create a new script tag from embedding linked stylesheets', async () => {
    const beasties = new Beasties({})
    beasties.readFile = () => `* { background: url('</style><script>alert(1)</script>') }`
    const html = await beasties.process(`
            <html>
                <head>
                    <link rel=stylesheet href=/file.css>
                </head>
                <body>
                </body>
        `)
    expect(hasEvilScript(html)).toBeFalsy()
  })
  it('should not create a new script tag from embedding additional stylesheets', async () => {
    const beasties = new Beasties({
      additionalStylesheets: ['/style.css'],
    })
    beasties.readFile = () => `* { background: url('</style><script>alert(1)</script>') }`
    const html = await beasties.process(`
            <html>
                <head>

                </head>
                <body>
                </body>
        `)
    expect(hasEvilScript(html)).toBeFalsy()
  })

  it('should not create a new script tag by ending </script> from href', async () => {
    const beasties = new Beasties({ preload: 'js' })
    beasties.readFile = () => `* { background: red }`
    const html = await beasties.process(`
        <html>
            <head>
                <link rel=stylesheet href="/abc/</script><script>alert(1)</script>/style.css">
            </head>
            <body>
            </body>
    `)
    expect(hasEvilScript(html)).toBeFalsy()
  })

  it('should not let a quote-bearing media value break out of the onload handler', async () => {
    const beasties = new Beasties({ preload: 'media', logLevel: 'silent' })
    beasties.readFile = () => `h1 { color: red }`
    const html = await beasties.process(`
        <html>
            <head>
                <link rel=stylesheet href="/style.css" media="all';alert(1);'">
            </head>
            <body>
                <h1>hi</h1>
            </body>
    `)
    expect(html).toContain(`onload="this.media='all'"`)
    expect(html).not.toMatch(/onload="[^"]*alert/)
  })
})
