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
    const logger: Logger = {
      warn: () => {},
      info: () => {},
      error: () => {},
      debug: () => {},
    }
    const loggerWarnSpy = vi.spyOn(logger, 'warn')

    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: fixtureDir,
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

    const html = fs.readFileSync(path.join(fixtureDir, 'prune-source.html'), 'utf-8')
    const result = await beasties.process(html)
    expect(result).toContain('<style>h1{color:blue}p{color:purple}.contents{padding:50px;text-align:center}.input-field{padding:10px}div:is(:hover,.active){color:#000}div:is(.selected,:hover){color:#fff}</style>')

    const css = fs.readFileSync(path.join(fixtureDir, 'prune-source.css'), 'utf-8')
    expect(css).toEqual('h2.unused{color:red}p.unused{color:orange}header{padding:0 50px}.banner{font-family:sans-serif}footer{margin-top:10px}.container{border:1px solid}.custom-element::part(tab){color:#0c0dcc;border-bottom:transparent solid 2px}.other-element::part(tab){color:#0c0dcc;border-bottom:transparent solid 2px}.custom-element::part(tab):hover{background-color:#0c0d19;color:#ffffff;border-color:#0c0d33}.custom-element::part(tab):hover:active{background-color:#0c0d33;color:#ffffff}.custom-element::part(tab):focus{box-shadow:0 0 0 1px #0a84ff inset, 0 0 0 1px #0a84ff, 0 0 0 4px rgba(10, 132, 255, 0.3)}.custom-element::part(active){color:#0060df;border-color:#0a84ff !important}')

    expect(loggerWarnSpy).not.toHaveBeenCalled()
    expect(result).toMatchSnapshot()
  })
})
