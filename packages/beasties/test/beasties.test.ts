/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

import type { Logger } from '../src/util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'
import Beasties from '../src/index'

const fixtureDir = fileURLToPath(new URL('./src', import.meta.url))

function trim(s: TemplateStringsArray) {
  return s[0]!
    .trim()
    .replace(new RegExp(`^${s[0]!.match(/^( {2}|\t)+/m)![0]}`, 'gm'), '')
}

describe('beasties', () => {
  it('basic Usage', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
    })
    const assets: Record<string, string> = {
      '/style.css': trim`
        h1 { color: blue; }
        h2.unused { color: red; }
        p { color: purple; }
        p.unused { color: orange; }
      `,
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
          <p>This is a paragraph</p>
        </body>
      </html>
    `)
    expect(result).toContain('<style>h1{color:blue}p{color:purple}</style>')
    expect(result).toContain('<link rel="stylesheet" href="/style.css">')
    expect(result).toMatchSnapshot()
  })

  it('works with an html snippet', async () => {
    const beasties = new Beasties()
    const result = await beasties.process(trim`
      <style>
        .red { color: red }
        .blue { color: blue }
      </style>
      <div class="blue">I'm Blue</div>
    `)
    expect(result).toMatchInlineSnapshot(`
      "<style>.blue{color:blue}</style>
      <div class="blue">I'm Blue</div>"
    `)
  })

  it('run on HTML file', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: fixtureDir,
    })

    const html = fs.readFileSync(path.join(fixtureDir, 'index.html'), 'utf-8')

    const result = await beasties.process(html)
    expect(result).toMatchSnapshot()
  })

  it('should preserve order of external stylesheets', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: fixtureDir,
    })

    const html = fs.readFileSync(path.join(fixtureDir, 'multiple-stylesheets.html'), 'utf-8')

    const result = await beasties.process(html)
    expect(result).toMatchSnapshot()
  })

  it('should preserve order of external stylesheets with variable load times', async () => {
    vi.useFakeTimers()

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
      mergeStylesheets: false, // Keep separate to verify order
    })

    // Simulate variable latency - second file loads fastest
    const assets: Record<string, { content: string, delay: number }> = {
      '/first.css': { content: 'h1 { color: red; }', delay: 50 },
      '/second.css': { content: 'h2 { color: blue; }', delay: 10 },
      '/third.css': { content: 'h3 { color: green; }', delay: 30 },
    }

    beasties.readFile = (filename) => {
      const key = filename.replace(/^\w:/, '').replace(/\\/g, '/')
      const asset = assets[key]
      if (!asset)
        return Promise.resolve('')
      return new Promise((resolve) => {
        setTimeout(() => resolve(asset.content), asset.delay)
      })
    }

    const processPromise = beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/first.css">
          <link rel="stylesheet" href="/second.css">
          <link rel="stylesheet" href="/third.css">
        </head>
        <body>
          <h1>First</h1>
          <h2>Second</h2>
          <h3>Third</h3>
        </body>
      </html>
    `)

    // Advance all timers
    await vi.runAllTimersAsync()
    const result = await processPromise

    vi.useRealTimers()

    // Verify style tags are in correct order (first, second, third)
    const styleOrder = [...result.matchAll(/<style>([^<]+)<\/style>/g)].map(m => m[1])
    expect(styleOrder).toEqual([
      'h1{color:red}',
      'h2{color:blue}',
      'h3{color:green}',
    ])

    // Verify body links are in correct order
    const bodyLinkMatches = result.match(/<body>[\s\S]*<\/body>/)?.[0] || ''
    const linkOrder = [...bodyLinkMatches.matchAll(/href="\/([^"]+)\.css"/g)].map(m => m[1])
    expect(linkOrder).toEqual(['first', 'second', 'third'])
  })

  it('should use custom embedLinkedStylesheet when overridden', async () => {
    const embeddedLinks: string[] = []

    class CustomBeasties extends Beasties {
      override async embedLinkedStylesheet(link: Parameters<Beasties['embedLinkedStylesheet']>[0], document: Parameters<Beasties['embedLinkedStylesheet']>[1]) {
        const href = link.getAttribute('href')
        if (href) {
          embeddedLinks.push(href)
        }
        return super.embedLinkedStylesheet(link, document)
      }
    }

    const beasties = new CustomBeasties({
      reduceInlineStyles: false,
      path: '/',
    })

    const assets: Record<string, string> = {
      '/a.css': 'h1 { color: red; }',
      '/b.css': 'h2 { color: blue; }',
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!

    await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/a.css">
          <link rel="stylesheet" href="/b.css">
        </head>
        <body>
          <h1>Hello</h1>
          <h2>World</h2>
        </body>
      </html>
    `)

    // Verify that our custom embedLinkedStylesheet was called for each stylesheet
    expect(embeddedLinks).toEqual(['/a.css', '/b.css'])
  })

  it('does not encode HTML', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
    })
    const assets: Record<string, string> = {
      '/style.css': trim`
        h1 { color: blue; }
      `,
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(trim`
      <html>
        <head>
          <title>$title</title>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)
    expect(result).toContain('<style>h1{color:blue}</style>')
    expect(result).toContain('<link rel="stylesheet" href="/style.css">')
    expect(result).toContain('<title>$title</title>')
  })

  it('should keep existing link tag attributes in the noscript link', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
      preload: 'media',
    })
    const assets: Record<string, string> = {
      '/style.css': trim`
        h1 { color: blue; }
      `,
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(trim`
      <html>
        <head>
          <title>$title</title>
          <link rel="stylesheet" href="/style.css" crossorigin="anonymous" integrity="sha384-j1GsrLo96tLqzfCY+">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    expect(result).toContain('<style>h1{color:blue}</style>')
    expect(result).toContain(
      `<link rel="stylesheet" href="/style.css" crossorigin="anonymous" integrity="sha384-j1GsrLo96tLqzfCY+" media="print" onload="this.media='all'">`,
    )
    expect(result).toMatchSnapshot()
  })

  it('should keep existing link tag attributes', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
    })
    const assets: Record<string, string> = {
      '/style.css': trim`
        h1 { color: blue; }
      `,
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(trim`
      <html>
        <head>
          <title>$title</title>
          <link rel="stylesheet" href="/style.css" crossorigin="anonymous" integrity="sha384-j1GsrLo96tLqzfCY+">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    expect(result).toContain('<style>h1{color:blue}</style>')
    expect(result).toContain(
      `<link rel="stylesheet" href="/style.css" crossorigin="anonymous" integrity="sha384-j1GsrLo96tLqzfCY+">`,
    )
    expect(result).toMatchSnapshot()
  })

  it('does not decode entities in HTML document', async () => {
    const beasties = new Beasties({
      path: '/',
    })
    const assets: Record<string, string> = {
      '/style.css': trim`
        h1 { color: blue; }
        h2.unused { color: red; }
        p { color: purple; }
        p.unused { color: orange; }
      `,
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(trim`
      <html>
        <body>
          &lt;h1&gt;Hello World!&lt;/h1&gt;
        </body>
      </html>
    `)
    expect(result).toContain('&lt;h1&gt;Hello World!&lt;/h1&gt;')
  })

  it('prevent injection via media attr', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: fixtureDir,
      preload: 'media',
    })

    const html = fs.readFileSync(path.join(fixtureDir, 'media-validation.html'), 'utf-8')

    const result = await beasties.process(html)
    expect(result).toContain(
      '<noscript><link rel="stylesheet" href="styles2.css" media="screen and (min-width: 480px)"></noscript>',
    )
    expect(result).toMatchSnapshot()
  })

  it('skip invalid path', async () => {
    const consoleSpy = vi.spyOn(console, 'warn')

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: fixtureDir,
    })

    const html = fs.readFileSync(path.join(fixtureDir, 'subpath-validation.html'), 'utf-8')

    const result = await beasties.process(html)
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Unable to locate stylesheet'),
    )
    expect(result).toMatchSnapshot()
  })

  it('should not load stylesheets outside of the base path', async () => {
    const beasties = new Beasties({ path: '/var/www' })
    vi.spyOn(beasties, 'readFile')
    await beasties.process(`
        <html>
            <head>
                <link rel=stylesheet href=/file.css>
                <link rel=stylesheet href=/../../../company-secrets/secret.css>
            </head>
            <body></body>
        </html>
    `)
    expect(beasties.readFile).toHaveBeenCalledWith(path.resolve('/var/www/file.css'))
    expect(beasties.readFile).not.toHaveBeenCalledWith(
      '/company-secrets/secret.css',
    )
  })

  it('works with pseudo classes and elements', async () => {
    const logger: Logger = {
      warn: () => {},
      info: () => {},
      error: () => {},
      debug: () => {},
    }

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
      logLevel: 'warn',
      logger,
    })
    const assets: Record<string, string> = {
      '/style.css': trim`
        h1 { color: blue; }
        h1:has(+ p) { margin-bottom: 0; }
        h2.unused { color: red; }
        p { color: purple; }
        p:only-child { color: fuchsia; }
        p.unused { color: orange; }
        input:where(:not([readonly])):where(:active, :focus, :focus-visible, [data-focused]) {
          color: blue;
        }
      `,
    }

    const loggerWarnSpy = vi.spyOn(logger, 'warn')
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
          <p>This is a paragraph</p>
          <input type="text">
        </body>
      </html>
    `)
    expect(loggerWarnSpy).not.toHaveBeenCalled()
    expect(result).toContain('<style>h1{color:blue}h1:has(+ p){margin-bottom:0}p{color:purple}p:only-child{color:fuchsia}input:where(:not([readonly])):where(:active, :focus, :focus-visible, [data-focused]){color:blue}</style>')
    expect(result).toContain('<link rel="stylesheet" href="/style.css">')
    expect(result).toMatchSnapshot()
  })

  it('works with at-rules (@layer)', async () => {
    const logger: Logger = {
      warn: () => {},
      info: () => {},
      error: () => {},
      debug: () => {},
    }

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
      logLevel: 'warn',
      logger,
    })
    const assets: Record<string, string> = {
      '/style.css': trim`
        @layer foo, bar;

        @layer foo {
          h1 { color: red }
          h4 { background: blue; }
        }

        @layer bar {
          h4 { background: lime; }
        }
      `,
    }

    const loggerWarnSpy = vi.spyOn(logger, 'warn')
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)
    expect(loggerWarnSpy).not.toHaveBeenCalled()
    expect(result).toContain('<style>@layer foo, bar;@layer foo {h1{color:red}}@layer bar {}</style>')
    expect(result).toContain('<link rel="stylesheet" href="/style.css">')
    expect(result).toMatchSnapshot()
  })

  it('css file is updated when pruneSource is enabled', async () => {
    // Create a temporary directory with copies of the fixture files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beasties-test-'))
    fs.copyFileSync(
      path.join(fixtureDir, 'prune-source.html'),
      path.join(tmpDir, 'prune-source.html'),
    )
    fs.copyFileSync(
      path.join(fixtureDir, 'prune-source.css'),
      path.join(tmpDir, 'prune-source.css'),
    )

    const logger: Logger = {
      warn: () => {},
      info: () => {},
      error: () => {},
      debug: () => {},
    }
    const loggerWarnSpy = vi.spyOn(logger, 'warn')

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: tmpDir,
      logLevel: 'warn',
      logger,
      pruneSource: true,
    })

    beasties.writeFile = (filename, data) => new Promise((resolve, reject) => {
      try {
        fs.writeFileSync(filename, data)
        resolve()
      }
      catch (err) {
        reject(err)
      }
    })

    const html = fs.readFileSync(path.join(tmpDir, 'prune-source.html'), 'utf-8')
    const result = await beasties.process(html)
    expect(result).toContain('<style>h1{color:blue}p{color:purple}.contents{padding:50px;text-align:center}.input-field{padding:10px}div:is(:hover,.active){color:#000}div:is(.selected,:hover){color:#fff}</style>')

    const css = fs.readFileSync(path.join(tmpDir, 'prune-source.css'), 'utf-8')
    expect(css).toEqual('h2.unused{color:red}p.unused{color:orange}header{padding:0 50px}.banner{font-family:sans-serif}footer{margin-top:10px}.container{border:1px solid}.custom-element::part(tab){color:#0c0dcc;border-bottom:transparent solid 2px}.other-element::part(tab){color:#0c0dcc;border-bottom:transparent solid 2px}.custom-element::part(tab):hover{background-color:#0c0d19;color:#ffffff;border-color:#0c0d33}.custom-element::part(tab):hover:active{background-color:#0c0d33;color:#ffffff}.custom-element::part(tab):focus{box-shadow:0 0 0 1px #0a84ff inset, 0 0 0 1px #0a84ff, 0 0 0 4px rgba(10, 132, 255, 0.3)}.custom-element::part(active){color:#0060df;border-color:#0a84ff !important}')

    expect(loggerWarnSpy).not.toHaveBeenCalled()
    expect(result).toMatchSnapshot()

    // Clean up temporary directory
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('handles stylesheets with query strings', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
    })
    const assets: Record<string, string> = {
      '/style.css': 'h1 { color: blue; } h2.unused { color: red; }',
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!

    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css?v=123">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    expect(result).toContain('<style>h1{color:blue}</style>')
    expect(result).toContain('/style.css?v=123')
  })

  it('handles stylesheets with hash fragments', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
    })
    const assets: Record<string, string> = {
      '/style.css': 'h1 { color: green; } h2.unused { color: red; }',
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!

    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css#section">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    expect(result).toContain('<style>h1{color:green}</style>')
    expect(result).toContain('/style.css#section')
  })

  it('handles stylesheets with both query strings and hash fragments', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
    })
    const assets: Record<string, string> = {
      '/style.css': 'h1 { color: purple; } h2.unused { color: red; }',
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!

    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css?v=456#section">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    expect(result).toContain('<style>h1{color:purple}</style>')
    expect(result).toContain('/style.css?v=456#section')
  })

  it('ignores remote stylesheets by default', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
    })

    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="https://example.com/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    // Should not contain inlined critical CSS since remote is disabled
    expect(result).not.toContain('<style>')
    expect(result).toContain('https://example.com/style.css')
  })

  it('fetches remote stylesheets when remote: true', async () => {
    const originalFetch = globalThis.fetch
    try {
      const beasties = new Beasties({
        reduceInlineStyles: false,
        remote: true,
      })

      // Mock fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'h1 { color: blue; } h2.unused { color: red; }',
      })
      globalThis.fetch = mockFetch as any

      const result = await beasties.process(trim`
        <html>
          <head>
            <link rel="stylesheet" href="https://example.com/style.css">
          </head>
          <body>
            <h1>Hello World!</h1>
          </body>
        </html>
      `)

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/style.css')
      expect(result).toContain('<style>h1{color:blue}</style>')
      expect(result).toContain('https://example.com/style.css')
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })

  it('handles protocol-relative URLs when remote: true', async () => {
    const originalFetch = globalThis.fetch
    try {
      const beasties = new Beasties({
        reduceInlineStyles: false,
        remote: true,
      })

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'h1 { color: green; }',
      })
      globalThis.fetch = mockFetch as any

      const result = await beasties.process(trim`
        <html>
          <head>
            <link rel="stylesheet" href="//example.com/style.css">
          </head>
          <body>
            <h1>Hello World!</h1>
          </body>
        </html>
      `)

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/style.css')
      expect(result).toContain('<style>h1{color:green}</style>')
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })

  it('handles fetch 404 responses gracefully', async () => {
    const originalFetch = globalThis.fetch
    try {
      const beasties = new Beasties({
        reduceInlineStyles: false,
        remote: true,
      })

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
      globalThis.fetch = mockFetch as any

      const result = await beasties.process(trim`
        <html>
          <head>
            <link rel="stylesheet" href="https://example.com/missing.css">
          </head>
          <body>
            <h1>Hello World!</h1>
          </body>
        </html>
      `)

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/missing.css')
      // Should still produce valid HTML, just without inlined styles
      expect(result).toContain('<h1>Hello World!</h1>')
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })

  it('handles fetch network errors gracefully', async () => {
    const originalFetch = globalThis.fetch
    try {
      const beasties = new Beasties({
        reduceInlineStyles: false,
        remote: true,
      })

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      globalThis.fetch = mockFetch as any

      const result = await beasties.process(trim`
        <html>
          <head>
            <link rel="stylesheet" href="https://example.com/style.css">
          </head>
          <body>
            <h1>Hello World!</h1>
          </body>
        </html>
      `)

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/style.css')
      // Should still produce valid HTML, just without inlined styles
      expect(result).toContain('<h1>Hello World!</h1>')
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })

  it('works with pruneSource and additionalStylesheets together', async () => {
    // Regression test for https://github.com/danielroe/beasties/issues/177
    // Ensure $$name is set on style elements for additionalStylesheets
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beasties-test-'))
    fs.writeFileSync(path.join(tmpDir, 'reset.css'), 'h1 { margin: 0; } h2.unused { padding: 0; }')

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: tmpDir,
      pruneSource: true,
      additionalStylesheets: ['/reset.css'],
    })

    beasties.writeFile = (filename, data) => new Promise((resolve, reject) => {
      try {
        fs.writeFileSync(filename, data)
        resolve()
      }
      catch (err) {
        reject(err)
      }
    })

    const result = await beasties.process(trim`
      <html>
        <head>
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    // Should contain the critical CSS from reset.css
    expect(result).toContain('<style>h1{margin:0}</style>')

    // The pruned CSS file should only contain non-critical styles
    const css = fs.readFileSync(path.join(tmpDir, 'reset.css'), 'utf-8')
    expect(css).toEqual('h2.unused{padding:0}')

    // Clean up temporary directory
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('removes empty @media blocks when pruneSource is enabled', async () => {
    // Regression test for https://github.com/danielroe/beasties/issues/172
    // Empty @media blocks should be removed after pruning, not left behind
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beasties-test-'))
    fs.writeFileSync(path.join(tmpDir, 'style.css'), trim`
      h1 { color: blue; }
      @media (min-width: 768px) {
        h1 { padding: 48px; }
      }
      h2.unused { color: red; }
    `)

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: tmpDir,
      pruneSource: true,
    })

    let writtenCss = ''
    beasties.writeFile = (filename, data) => new Promise((resolve, reject) => {
      try {
        writtenCss = data
        fs.writeFileSync(filename, data)
        resolve()
      }
      catch (err) {
        reject(err)
      }
    })

    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    // Critical CSS should include both the base h1 rule and the @media rule
    expect(result).toContain('h1{color:blue}')
    expect(result).toContain('@media (min-width: 768px)')
    expect(result).toContain('h1{padding:48px}')

    // The pruned CSS file should NOT contain empty @media blocks
    expect(writtenCss).not.toContain('@media (min-width: 768px){}')
    expect(writtenCss).not.toContain('@media (min-width: 768px) {}')
    // It should only contain the unused h2 rule
    expect(writtenCss).toEqual('h2.unused{color:red}')

    // Clean up temporary directory
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('removes empty @media blocks from critical CSS when rules go to pruned source', async () => {
    // Regression test for https://github.com/danielroe/beasties/issues/172
    // Test the inverse case: empty @media in critical CSS
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beasties-test-'))
    fs.writeFileSync(path.join(tmpDir, 'style.css'), trim`
      h1 { color: blue; }
      @media (min-width: 768px) {
        h2.unused { padding: 48px; }
      }
    `)

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: tmpDir,
      pruneSource: true,
    })

    let writtenCss = ''
    beasties.writeFile = (filename, data) => new Promise((resolve, reject) => {
      try {
        writtenCss = data
        fs.writeFileSync(filename, data)
        resolve()
      }
      catch (err) {
        reject(err)
      }
    })

    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    // Critical CSS should NOT contain empty @media blocks
    expect(result).not.toContain('@media (min-width: 768px){}')
    expect(result).not.toContain('@media (min-width: 768px) {}')
    expect(result).toContain('h1{color:blue}')

    // The pruned CSS should contain the @media block with the unused rule
    expect(writtenCss).toContain('@media (min-width: 768px)')
    expect(writtenCss).toContain('h2.unused{padding:48px}')

    // Clean up temporary directory
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('removes empty @supports blocks when pruneSource is enabled', async () => {
    // Similar to @media, @supports blocks should be removed when empty
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beasties-test-'))
    fs.writeFileSync(path.join(tmpDir, 'style.css'), trim`
      h1 { color: blue; }
      @supports (display: grid) {
        h1 { display: grid; }
      }
      h2.unused { color: red; }
    `)

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: tmpDir,
      pruneSource: true,
    })

    let writtenCss = ''
    beasties.writeFile = (filename, data) => new Promise((resolve, reject) => {
      try {
        writtenCss = data
        fs.writeFileSync(filename, data)
        resolve()
      }
      catch (err) {
        reject(err)
      }
    })

    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    // Critical CSS should include the @supports block with h1 rule
    expect(result).toContain('h1{color:blue}')
    expect(result).toContain('@supports (display: grid)')
    expect(result).toContain('h1{display:grid}')

    // The pruned CSS file should NOT contain empty @supports blocks
    expect(writtenCss).not.toContain('@supports')
    // It should only contain the unused h2 rule
    expect(writtenCss).toEqual('h2.unused{color:red}')

    // Clean up temporary directory
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('preserves @keyframes when pruneSource is enabled', async () => {
    // @keyframes should be handled as a whole, not recursively walked
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beasties-test-'))
    fs.writeFileSync(path.join(tmpDir, 'style.css'), trim`
      h1 {
        color: blue;
        animation: fadeIn 1s;
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes unused {
        0% { transform: scale(0); }
        100% { transform: scale(1); }
      }
    `)

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: tmpDir,
      pruneSource: true,
      keyframes: 'critical',
    })

    let writtenCss = ''
    beasties.writeFile = (filename, data) => new Promise((resolve, reject) => {
      try {
        writtenCss = data
        fs.writeFileSync(filename, data)
        resolve()
      }
      catch (err) {
        reject(err)
      }
    })

    const result = await beasties.process(trim`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)

    // Critical CSS should include the used @keyframes
    expect(result).toContain('@keyframes fadeIn')
    expect(result).toContain('from{opacity:0}')
    expect(result).toContain('to{opacity:1}')

    // Unused @keyframes should be in the pruned source
    expect(writtenCss).toContain('@keyframes unused')

    // Clean up temporary directory
    fs.rmSync(tmpDir, { recursive: true })
  })
})
