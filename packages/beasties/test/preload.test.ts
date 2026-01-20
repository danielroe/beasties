import { describe, expect, it } from 'vitest'
import Beasties from '../src/index'

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

  it('should use "swap-low" preload mode correctly', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
      preload: 'swap-low',
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
    expect(result).toContain(`<link rel="alternate stylesheet" href="/style.css" title="styles" onload="this.title='';this.rel='stylesheet'">`)
    expect(result).toContain('<noscript><link rel="stylesheet" href="/style.css"></noscript>')
    expect(result).toMatchSnapshot()
  })

  it('should use "swap-high" preload mode correctly', async () => {
    const beasties = new Beasties({
      reduceInlineStyles: false,
      path: '/',
      preload: 'swap-high',
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
    expect(result).toContain(`<link rel="alternate stylesheet preload" href="/style.css" title="styles" as="style" onload="this.title='';this.rel='stylesheet'">`)
    expect(result).toContain('<noscript><link rel="stylesheet" href="/style.css"></noscript>')
    expect(result).toMatchSnapshot()
  })
})
