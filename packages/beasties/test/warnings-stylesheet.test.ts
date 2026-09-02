import { beforeEach, describe, expect, it, vi } from 'vitest'

import Beasties from '../src/index'
import { resetMessageDeduplication } from '../src/util'

function makeBeasties(options: Record<string, unknown> = {}, css = 'p { color: red }') {
  const warn = vi.fn()
  const debug = vi.fn()
  const beasties = new Beasties({
    reduceInlineStyles: false,
    path: '/',
    logger: { warn, debug },
    ...options,
  })
  beasties.readFile = () => css
  return { beasties, warn, debug }
}

describe('stylesheet resolution warning', () => {
  beforeEach(() => {
    resetMessageDeduplication()
  })

  it('reports the resolved path along with path and publicPath', async () => {
    const { beasties, warn } = makeBeasties({ path: '/dist', publicPath: '/assets' })
    beasties.readFile = () => Promise.reject(new Error('ENOENT'))

    await beasties.process(`<html><head><link rel="stylesheet" href="/assets/style.css"></head><body></body></html>`)

    const message = warn.mock.calls[0]![0] as string
    expect(message).toContain('Unable to locate stylesheet /assets/style.css')
    expect(message).toContain('path: "/dist"')
    expect(message).toContain('publicPath: "/assets"')
    expect(message).toContain('data-beasties-skip')
  })

  it('does not warn for links carrying data-beasties-skip', async () => {
    const { beasties, warn } = makeBeasties()
    beasties.readFile = () => Promise.reject(new Error('ENOENT'))

    await beasties.process(`<html><head><link rel="stylesheet" href="/missing.css" data-beasties-skip></head><body></body></html>`)

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Unable to locate stylesheet'))
  })
})
