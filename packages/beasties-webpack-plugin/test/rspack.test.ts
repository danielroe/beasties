import type { Configuration } from '@rspack/core'
import { rspack } from '@rspack/core'
import HtmlRspackPlugin from 'html-rspack-plugin'
import { beforeAll, describe, expect, it } from 'vitest'

import { createHelpers, readFile } from './helpers'

const { compileToHtml, outDir } = createHelpers<Configuration>(rspack as never, 'dist-rspack')

function withCssExtract(config: Configuration) {
  config.module ||= {}
  config.module.rules ||= []
  config.module.rules.push({
    test: /\.css$/,
    use: [rspack.CssExtractRspackPlugin.loader, 'css-loader'],
  })

  config.plugins ||= []
  config.plugins.push(
    new rspack.CssExtractRspackPlugin({
      filename: '[name].css',
      chunkFilename: '[name].chunk.css',
    }),
  )
}

function htmlPluginOptions() {
  return {
    filename: 'index.html',
    template: 'index.html',
    inject: true,
  }
}

describe('html-rspack-plugin', () => {
  let output: Awaited<ReturnType<typeof compileToHtml>>
  beforeAll(async () => {
    output = await compileToHtml('external', (config) => {
      withCssExtract(config)
      config.plugins!.push(new HtmlRspackPlugin(htmlPluginOptions()))
    })
  })

  it('should inline critical styles', () => {
    expect(output.html).toMatch(/ul\.navbar\s*\{/)
  })

  it('should omit non-critical styles', () => {
    expect(output.html).not.toMatch(/\.extra-style/)
  })

  it('should replace rel="stylesheet" with a preload', () => {
    const link = output.document.querySelector('link[rel="stylesheet"]')
    expect(link).not.toBeNull()
    expect(link).toHaveProperty('href', 'main.css')
  })

  it('should prune external sheet', async () => {
    const externalCss = await readFile(`fixtures/external/${outDir}/main.css`)
    expect(externalCss).toMatch(/\.extra-style\s*\{/)
    expect(externalCss).not.toMatch(/ul\.navbar\s*\{/)
  })
})

describe('builtin htmlRspackPlugin', () => {
  it('should inline critical styles', async () => {
    const { html } = await compileToHtml('basic', (config) => {
      withCssExtract(config)
      config.plugins!.push(new rspack.HtmlRspackPlugin(htmlPluginOptions()))
    })
    expect(html).toMatch(/ul\.navbar\s*\{/)
    expect(html).not.toMatch(/\.extra-style/)
  })
})

describe('usage without an html plugin', () => {
  it('should process the first html asset', async () => {
    const { document } = await compileToHtml('raw', (config) => {
      config.module!.rules!.push(
        {
          test: /\.css$/,
          use: ['css-loader'],
        },
        {
          test: /\.html$/,
          type: 'asset/resource',
          generator: { filename: '[name][ext]' },
        },
      )
    })
    expect(document.querySelectorAll('style')).toHaveLength(1)
    expect(document.getElementById('unused')).toBeNull()
    expect(document.getElementById('used')).not.toBeNull()
  })
})

describe('publicPath', () => {
  let output: Awaited<ReturnType<typeof compileToHtml>>
  beforeAll(async () => {
    output = await compileToHtml('external', (config) => {
      withCssExtract(config)
      config.output!.publicPath = '/_public/'
      config.plugins!.push(new HtmlRspackPlugin(htmlPluginOptions()))
    })
  })

  it('should inline critical styles', () => {
    expect(output.html).toMatch(/ul\.navbar\s*\{/)
  })

  it('should preload from publicPath', () => {
    const link = output.document.querySelector('link[rel="preload"]')
    expect(link).not.toBeNull()
    expect(link).toHaveProperty('href', '/_public/main.css')
  })
})
