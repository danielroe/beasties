import type { RollupOutput } from 'rollup'
import type { UserConfig } from 'vite'
import type { ViteBeastiesOptions } from '../src'

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Beasties from 'beasties'
import { build } from 'vite'
import { describe, expect, it, vi } from 'vitest'

import { beasties } from '../src'

const root = fileURLToPath(new URL('fixtures/basic', import.meta.url))

describe('vite-plugin-beasties', () => {
  async function runViteBuild(options: ViteBeastiesOptions = {}, viteConfig: Partial<UserConfig> = {}) {
    const { output } = await build({
      root,
      logLevel: 'silent',
      ...viteConfig,
      build: {
        ...viteConfig.build,
        write: false,
      },
      plugins: [
        beasties({
          options: {
            inlineThreshold: 5000,
            ...options.options,
          },
          ...options,
        }),
      ],
    }) as RollupOutput

    return {
      readOutput(filename: string) {
        const file = output.find(f => f.fileName === filename)
        if (file?.type === 'asset') {
          return file.source.toString()
        }
        return file?.code
      },
      output,
    }
  }

  it('processes HTML files during the build', async () => {
    const { readOutput, output } = await runViteBuild()
    const html = readOutput('index.html')

    expect(html).toContain('<style>')
    expect(html).toContain('.test-content')

    const hasCssColor = html?.includes('color: blue') || html?.includes('color:#00f')
    expect(hasCssColor).toBe(true)

    const css = output.find(file => file.fileName.endsWith('.css')) as any

    expect(css.source.trim()).toMatchInlineSnapshot(`".test-content{color:#00f;font-weight:700}"`)
  })

  it('prunes CSS files during the build', async () => {
    const { output } = await runViteBuild({ options: { pruneSource: true } })
    const css = output.find(file => file.fileName.endsWith('.css')) as any

    expect(css.source.trim()).toMatchInlineSnapshot(`""`)
  })

  it('respects the filter option', async () => {
    const { readOutput } = await runViteBuild(
      { filter: path => path.split('/').pop() === 'index.html' },
      {
        build: {
          rollupOptions: {
            input: {
              index: join(root, 'index.html'),
              other: join(root, 'other.html'),
            },
          },
        },
      },
    )

    const indexHtml = readOutput('index.html')
    const otherHtml = readOutput('other.html')

    // Index.html should have inlined CSS
    expect(indexHtml).toContain('<style>')
    expect(indexHtml).toContain('.test-content')

    // other.html should still have the external CSS link
    expect(otherHtml).toContain('<link rel="stylesheet"')
    expect(otherHtml).not.toContain('<style>.test-content')
  })

  it('handles errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errorSpy = vi.spyOn(Beasties.prototype, 'process').mockImplementation(() => {
      throw new Error('Test error')
    })

    await runViteBuild()

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('vite-plugin-beasties error'))

    errorSpy.mockRestore()
    consoleSpy.mockRestore()
  })
})
