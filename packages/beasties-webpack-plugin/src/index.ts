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

import type { Options } from 'beasties'
import type HtmlWebpackPlugin from 'html-webpack-plugin'
import type { Compilation, Compiler, OutputFileSystem, sources } from 'webpack'
import { createRequire } from 'node:module'
import path from 'node:path'
import Beasties from 'beasties'
import { minimatch } from 'minimatch'
import { tap } from './util'

const $require
  = typeof require !== 'undefined'
    ? require
    // TODO remove this
    // eslint-disable-next-line no-eval
    : createRequire(eval('import.meta.url'))

// Used to annotate this plugin's hooks in Tappable invocations
const PLUGIN_NAME = 'beasties-webpack-plugin'

/**
 * Create a Beasties plugin instance with the given options.
 * @public
 * @param {Options} options Options to control how Beasties inlines CSS. See https://github.com/danielroe/beasties#usage
 * @example
 * // webpack.config.js
 * module.exports = {
 *   plugins: [
 *     new Beasties({
 *       // Outputs: <link rel="preload" onload="this.rel='stylesheet'">
 *       preload: 'swap',
 *
 *       // Don't inline critical font-face rules, but preload the font URLs:
 *       preloadFonts: true
 *     })
 *   ]
 * }
 */
export default class BeastiesWebpackPlugin extends Beasties {
  declare compilation: Compilation
  declare compiler: Compiler
  declare fs: OutputFileSystem
  declare logger: Required<NonNullable<Options['logger']>>
  declare options: Options & Required<Pick<Options, 'logLevel' | 'path' | 'publicPath' | 'reduceInlineStyles' | 'pruneSource' | 'additionalStylesheets'>> & { allowRules: Array<string | RegExp> }
  constructor(options: Options) {
    super(options)
  }

  /**
   * Invoked by Webpack during plugin initialization
   */
  apply(compiler: Compiler) {
    this.compiler = compiler
    this.logger = Object.assign(compiler.getInfrastructureLogger(PLUGIN_NAME), {
      silent(_: string): void { },
    })
    // hook into the compiler to get a Compilation instance...
    tap(compiler, 'compilation', PLUGIN_NAME, false, (compilation: Compilation) => {
      let htmlPluginHooks: HtmlWebpackPlugin.Hooks | undefined

      this.options.path = compiler.options.output.path!
      this.options.publicPath
        // from html-webpack-plugin
        = compiler.options.output.publicPath || typeof compiler.options.output.publicPath === 'function'
          ? compilation.getAssetPath(compiler.options.output.publicPath!, compilation)
          : compiler.options.output.publicPath!

      const hasHtmlPlugin = compilation.options.plugins.some(
        p => p?.constructor?.name === 'HtmlWebpackPlugin',
      )
      try {
        htmlPluginHooks = $require('html-webpack-plugin').getHooks(compilation)
      }
      catch {}
      /**
       * @param {{html: string; outputName: string; plugin: HtmlWebpackPlugin}} htmlPluginData
       * @param callback
       */
      const handleHtmlPluginData = (
        htmlPluginData: { html: string, outputName: string, plugin: HtmlWebpackPlugin },
        callback: (err?: null | Error, content?: { html: string, outputName: string, plugin: HtmlWebpackPlugin }) => void,
      ) => {
        this.fs = compiler.outputFileSystem!
        this.compilation = compilation
        this.process(htmlPluginData.html)
          .then((html) => {
            callback(null, { ...htmlPluginData, html })
          })
          .catch(callback)
      }

      // get an "after" hook into html-webpack-plugin's HTML generation.
      if (
        compilation.hooks
        // @ts-expect-error - compat html-webpack-plugin 3.x
        && compilation.hooks.htmlWebpackPluginAfterHtmlProcessing
      ) {
        tap(
          compilation,
          'html-webpack-plugin-after-html-processing',
          PLUGIN_NAME,
          true,
          handleHtmlPluginData,
        )
      }
      else if (hasHtmlPlugin && htmlPluginHooks) {
        htmlPluginHooks.beforeEmit.tapAsync(PLUGIN_NAME, handleHtmlPluginData)
      }
      else {
        // If html-webpack-plugin isn't used, process the first HTML asset as an optimize step
        tap(
          compilation,
          'optimize-assets',
          PLUGIN_NAME,
          true,
          (assets: /* CompilationAssets */{ [id: string]: sources.Source }, callback: (err?: null | Error) => void) => {
            this.fs = compiler.outputFileSystem!
            this.compilation = compilation

            let htmlAssetName: string | undefined
            for (const name in assets) {
              if (name.match(/\.html$/)) {
                htmlAssetName = name
                break
              }
            }
            if (!htmlAssetName) {
              return callback(new Error('Could not find HTML asset.'))
            }
            const html = assets[htmlAssetName]!.source()
            if (!html)
              return callback(new Error('Empty HTML asset.'))

            this.process(String(html))
              .then((html) => {
                assets[htmlAssetName] = new compiler.webpack.sources.RawSource(html)
                callback()
              })
              .catch(callback)
          },
        )
      }
    })
  }

  /**
   * Given href, find the corresponding CSS asset
   */
  override async getCssAsset(href: string, style: BeastiesStyleElement): Promise<string | undefined> {
    const outputPath = this.options.path
    const publicPath = this.options.publicPath

    // CHECK - the output path
    // path on disk (with output.publicPath removed)
    let normalizedPath = href.replace(/^\//, '')
    const pathPrefix = `${(publicPath || '').replace(/(^\/|\/$)/g, '')}/`
    if (normalizedPath.indexOf(pathPrefix) === 0) {
      normalizedPath = normalizedPath
        .substring(pathPrefix.length)
        .replace(/^\//, '')
    }
    const filename = path.resolve(outputPath, normalizedPath)

    // try to find a matching asset by filename in webpack's output (not yet written to disk)
    const relativePath = path
      .relative(outputPath, filename)
      .replace(/^\.\//, '')
    const asset = this.compilation.assets[relativePath] // compilation.assets[relativePath];

    // Attempt to read from assets, falling back to a disk read
    let sheet = asset && asset.source()

    if (!sheet) {
      try {
        sheet = await this.readFile(filename)
        this.logger.warn(
          `Stylesheet "${relativePath}" not found in assets, but a file was located on disk.${
            this.options.pruneSource
              ? ' This means pruneSource will not be applied.'
              : ''
          }`,
        )
      }
      catch {
        this.logger.warn(`Unable to locate stylesheet: ${relativePath}`)
        return
      }
    }

    style.$$asset = asset
    style.$$assetName = relativePath
    // style.$$assets = this.compilation.assets;

    return sheet.toString()
  }

  /**
   * Check if the stylesheet should be inlined
   */
  override checkInlineThreshold(link: Node, style: BeastiesStyleElement, sheet: string): boolean {
    const inlined = super.checkInlineThreshold(link, style, sheet)

    if (inlined) {
      const asset = style.$$asset
      if (asset) {
        this.compilation.deleteAsset(style.$$assetName)
      }
      else {
        this.logger.warn(
          `  > ${style.$$name} was not found in assets. the resource may still be emitted but will be unreferenced.`,
        )
      }
    }

    return inlined
  }

  /**
   * Inline the stylesheets from options.additionalStylesheets (assuming it passes `options.filter`)
   */
  async embedAdditionalStylesheet(document: Document) {
    const styleSheetsIncluded: string[] = [];
    (this.options.additionalStylesheets || []).forEach((cssFile: string) => {
      if (styleSheetsIncluded.includes(cssFile)) {
        return undefined
      }
      styleSheetsIncluded.push(cssFile)
      const webpackCssAssets = Object.keys(this.compilation.assets).filter(
        file => minimatch(file, cssFile),
      )
      for (const asset of webpackCssAssets) {
        const style = document.createElement('style') as BeastiesStyleElement
        style.$$external = true
        style.textContent = this.compilation.assets[asset]!.source().toString()
        document.head.appendChild(style)
      }
    })
  }

  /**
   * Prune the source CSS files
   */
  override pruneSource(style: BeastiesStyleElement, before: string, sheetInverse: string): boolean {
    const isStyleInlined = super.pruneSource(style, before, sheetInverse)
    const asset = style.$$asset
    const name = style.$$name

    if (asset) {
      // if external stylesheet would be below minimum size, just inline everything
      const minSize = this.options.minimumExternalSize
      if (minSize && sheetInverse.length < minSize) {
        // delete the webpack asset:
        this.compilation.deleteAsset(style.$$assetName)
        return true
      }
      this.compilation.assets[style.$$assetName] = new this.compiler.webpack.sources.SourceMapSource(sheetInverse, style.$$assetName, before)
    }
    else {
      this.logger.warn(
        `pruneSource is enabled, but a style (${name}) has no corresponding Webpack asset.`,
      )
    }

    return isStyleInlined
  }
}

interface BeastiesStyleElement extends HTMLStyleElement {
  $$name: string
  $$asset: sources.Source | undefined
  $$assetName: string
  $$external: boolean
}
