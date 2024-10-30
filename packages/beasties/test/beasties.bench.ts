import type { Options } from '../src/types'
import fs from 'node:fs'

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bench, describe } from 'vitest'
import Beasties from '../src/index'

const fixtureDir = fileURLToPath(new URL('./src', import.meta.url))

const DEFAULT_BEASTIES_CONFIG: Partial<Options> = {
  reduceInlineStyles: false,
  logLevel: 'error',
} as const

function trim(s: TemplateStringsArray) {
  return s[0]!
    .trim()
    .replace(new RegExp(`^${s[0]!.match(/^( {2}|\t)+/m)![0]}`, 'gm'), '')
}

describe('beasties', () => {
  bench('basic Usage', async () => {
    const beasties = new Beasties({
      ...DEFAULT_BEASTIES_CONFIG,
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
    beasties.readFile = filename => assets[filename]!
    await beasties.process(trim`
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
  })

  const basicHTML = fs.readFileSync(join(fixtureDir, 'index.html'), 'utf-8')

  bench('run on HTML file', async () => {
    const beasties = new Beasties({
      ...DEFAULT_BEASTIES_CONFIG,
      path: fixtureDir,
    })

    await beasties.process(basicHTML)
  })

  bench('does not encode HTML', async () => {
    const beasties = new Beasties({
      ...DEFAULT_BEASTIES_CONFIG,
      path: '/',
    })
    const assets: Record<string, string> = {
      '/style.css': trim`
        h1 { color: blue; }
      `,
    }
    beasties.readFile = filename => assets[filename]!
    await beasties.process(trim`
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
  })

  bench('should keep existing link tag attributes in the noscript link', async () => {
    const beasties = new Beasties({
      ...DEFAULT_BEASTIES_CONFIG,
      path: '/',
      preload: 'media',
    })
    const assets: Record<string, string> = {
      '/style.css': trim`
        h1 { color: blue; }
      `,
    }
    beasties.readFile = filename => assets[filename]!
    await beasties.process(trim`
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
  })

  bench('should keep existing link tag attributes', async () => {
    const beasties = new Beasties({
      ...DEFAULT_BEASTIES_CONFIG,
      path: '/',
    })
    const assets: Record<string, string> = {
      '/style.css': trim`
        h1 { color: blue; }
      `,
    }
    beasties.readFile = filename => assets[filename]!
    await beasties.process(trim`
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
  })

  bench('does not decode entities in HTML document', async () => {
    const beasties = new Beasties({
      ...DEFAULT_BEASTIES_CONFIG,
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
    beasties.readFile = filename => assets[filename]!
    await beasties.process(trim`
      <html>
        <body>
          &lt;h1&gt;Hello World!&lt;/h1&gt;
        </body>
      </html>
    `)
  })

  const mediaValidationHtml = fs.readFileSync(join(fixtureDir, 'media-validation.html'), 'utf-8')
  bench('prevent injection via media attr', async () => {
    const beasties = new Beasties({
      ...DEFAULT_BEASTIES_CONFIG,
      path: fixtureDir,
      preload: 'media',
    })

    await beasties.process(mediaValidationHtml)
  })

  const invalidPathHtml = fs.readFileSync(join(fixtureDir, 'subpath-validation.html'), 'utf-8')
  bench('skip invalid path', async () => {
    const beasties = new Beasties({
      ...DEFAULT_BEASTIES_CONFIG,
      path: fixtureDir,
    })

    await beasties.process(invalidPathHtml)
  })
})
