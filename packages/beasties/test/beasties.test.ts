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
})

describe('preload modes', () => {
  it('should use "js" preload mode correctly', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
      preload: 'js',
    })
    const assets: Record<string, string> = {
      '/style.css': 'h1 { color: blue; }',
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)
    expect(result).toContain('<style>h1{color:blue}</style>')
    expect(result).toContain('<link rel="preload" href="/style.css" as="style">')
    expect(result).toContain(`<script data-href="/style.css" data-media="all">function $loadcss(u,m,l){(l=document.createElement('link')).rel='stylesheet';l.href=u;document.head.appendChild(l)}$loadcss(document.currentScript.dataset.href,document.currentScript.dataset.media)</script>`)
    expect(result).toMatchSnapshot()
  })

  it('should use "media" preload mode correctly', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
      preload: 'media',
    })
    const assets: Record<string, string> = {
      '/style.css': 'h1 { color: blue; }',
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)
    expect(result).toContain('<style>h1{color:blue}</style>')
    expect(result).toContain('<link rel="stylesheet" href="/style.css" media="print" onload="this.media=\'all\'">')
    expect(result).toContain('<noscript><link rel="stylesheet" href="/style.css"></noscript>')
    expect(result).toMatchSnapshot()
  })

  it('should use "swap" preload mode correctly', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
      preload: 'swap',
    })
    const assets: Record<string, string> = {
      '/style.css': 'h1 { color: blue; }',
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)
    expect(result).toContain('<style>h1{color:blue}</style>')
    expect(result).toContain('<link rel="preload" href="/style.css" onload="this.rel=\'stylesheet\'" as="style">')
    expect(result).toContain('<noscript><link rel="stylesheet" href="/style.css"></noscript>')
    expect(result).toMatchSnapshot()
  })

  it('should handle "false" preload mode correctly', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
      preload: false,
    })
    const assets: Record<string, string> = {
      '/style.css': 'h1 { color: blue; }',
    }
    beasties.readFile = filename => assets[filename.replace(/^\w:/, '').replace(/\\/g, '/')]!
    const result = await beasties.process(`
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Hello World!</h1>
        </body>
      </html>
    `)
    expect(result).toContain('<style>h1{color:blue}</style>')
    expect(result).toContain('<link rel="stylesheet" href="/style.css">')
    expect(result).not.toContain('onload=')
    expect(result).not.toContain('<noscript>')
    expect(result).toMatchSnapshot()
  })
})
