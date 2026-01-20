import type { Options } from 'beasties'
import type { Compiler } from 'webpack'
import Beasties from 'beasties'

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
declare class BeastiesWebpackPlugin extends Beasties {
  constructor(options: Options)
  /**
   * Invoked by Webpack during plugin initialization
   */
  apply(compiler: Compiler): void
  /**
   * Given href, find the corresponding CSS asset
   */
  getCssAsset(href: string, style: Node): Promise<string | undefined>
  /**
   * Check if the stylesheet should be inlined
   */
  override checkInlineThreshold(link: Node, style: Node, sheet: string): boolean
  /**
   * Inline the stylesheets from options.additionalStylesheets (assuming it passes `options.filter`)
   */
  embedAdditionalStylesheet(document: Document): Promise<void>
  /**
   * Prune the source CSS files
   */
  override pruneSource(style: Node, before: string, sheetInverse: string): boolean
}

export = BeastiesWebpackPlugin
