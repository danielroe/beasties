import { beforeEach, describe, expect, it, vi } from 'vitest'

import Beasties from '../src/index'
import { resetMessageDeduplication } from '../src/util'

const html = `<html><head><link rel="stylesheet" href="/style.css"></head><body><p>Hello</p></body></html>`

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

describe('warning deduplication', () => {
  beforeEach(() => {
    resetMessageDeduplication()
  })

  it('emits a repeated warning only once per instance', async () => {
    const { beasties, warn } = makeBeasties({ dedupeWarnings: 'instance' })
    beasties.readFile = () => Promise.reject(new Error('ENOENT'))

    await beasties.process(html)
    await beasties.process(html)

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('emits a repeated warning only once per process by default', async () => {
    const first = makeBeasties()
    const second = makeBeasties()
    first.beasties.readFile = () => Promise.reject(new Error('ENOENT'))
    second.beasties.readFile = () => Promise.reject(new Error('ENOENT'))

    await first.beasties.process(html)
    await second.beasties.process(html)

    expect(first.warn).toHaveBeenCalledTimes(1)
    expect(second.warn).not.toHaveBeenCalled()
  })

  it('emits every warning when deduplication is disabled', async () => {
    const { beasties, warn } = makeBeasties({ dedupeWarnings: false })
    beasties.readFile = () => Promise.reject(new Error('ENOENT'))

    await beasties.process(html)
    await beasties.process(html)

    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('does not suppress distinct warnings', async () => {
    const { beasties, warn } = makeBeasties()
    beasties.readFile = filename => Promise.reject(new Error(`ENOENT ${filename}`))

    await beasties.process(`<html><head><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css"></head><body></body></html>`)

    expect(warn).toHaveBeenCalledTimes(2)
  })
})
