import type { Plugin, ResolvedConfig } from 'vite'

import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

import Beasties from 'beasties'

const BACKSLASH_RE = /\\/g
const LEADING_SLASH_RE = /^\//

export interface ViteBeastiesOptions {
  /**
   * Options passed directly through to beasties
   */
  options?: ConstructorParameters<typeof Beasties>[0]
  /**
   * Filter for HTML files to process
   * @default (path) => path.endsWith('.html')
   */
  filter?: (path: string) => boolean
}

export function beasties(options: ViteBeastiesOptions = {}): Plugin {
  let config: ResolvedConfig
  let beastiesInstance: Beasties

  const filter = options.filter || (path => path.endsWith('.html'))

  return {
    name: 'beasties',
    configResolved(resolvedConfig) {
      config = resolvedConfig
      beastiesInstance = new Beasties({
        pruneSource: true,
        ...options.options,
        path: config.build.outDir,
        publicPath: config.base,
      })
    },
    async transformIndexHtml(html, ctx) {
      const bundle = ctx.bundle

      if (!bundle || !filter(ctx.filename)) {
        return
      }

      beastiesInstance.readFile = (filename: string) => {
        const path = relative(config.build.outDir, filename).replace(BACKSLASH_RE, '/')
        const chunk = bundle[path] ?? { type: 'asset', source: readFileSync(filename, 'utf-8') }
        if (!chunk) {
          throw new Error(`Failed to read file: ${filename}`)
        }

        return chunk.type === 'asset' ? chunk.source.toString() : chunk.code
      }

      const originalPrune = beastiesInstance.pruneSource.bind(beastiesInstance)

      beastiesInstance.pruneSource = function pruneSource(style, before, sheetInverse) {
        const isStyleInlined = originalPrune(style, before, sheetInverse)
        // @ts-expect-error internal property
        const name = style.$$name.replace(LEADING_SLASH_RE, '') as string

        if (name in bundle && bundle[name]!.type === 'asset') {
          const minSize = options.options?.minimumExternalSize
          if (minSize && sheetInverse.length < minSize) {
            delete bundle[name]
            return true
          }
          else if (!sheetInverse.length) {
            delete bundle[name]
            return true
          }
          else {
            bundle[name]!.source = sheetInverse
          }
        }
        else {
          console.warn(`pruneSource is enabled, but a style (${name}) has no corresponding asset.`)
        }

        return isStyleInlined
      }

      const originalCheckInline = beastiesInstance.checkInlineThreshold.bind(beastiesInstance)
      beastiesInstance.checkInlineThreshold = function checkInlineThreshold(link, style, sheet) {
        const isStyleInlined = originalCheckInline(link, style, sheet)

        if (isStyleInlined || !sheet.length) {
          // @ts-expect-error internal property
          const name = style.$$name.replace(LEADING_SLASH_RE, '') as string
          if (name in bundle && bundle[name]!.type === 'asset') {
            delete bundle[name]
          }
          else {
            console.warn(
              `${name} was not found in assets. the resource may still be emitted but will be unreferenced.`,
            )
          }
        }

        return isStyleInlined
      }

      try {
        return await beastiesInstance.process(html)
      }
      catch (error) {
        console.error(`vite-plugin-beasties error: ${error}`)
      }
    },
  }
}
