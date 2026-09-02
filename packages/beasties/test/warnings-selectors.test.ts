import { beforeEach, describe, expect, it, vi } from 'vitest'

import Beasties from '../src/index'
import { isUnevaluableSelectorError } from '../src/selectors'
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

describe('selector error warning', () => {
  beforeEach(() => {
    resetMessageDeduplication()
  })

  it('classifies selectors that cannot be statically evaluated', () => {
    expect(isUnevaluableSelectorError('Unknown pseudo-class :_x')).toBe(true)
    expect(isUnevaluableSelectorError('Pseudo-elements are not supported by css-select')).toBe(true)
    expect(isUnevaluableSelectorError('Expected name, found ::')).toBe(false)
  })

  it('does not warn about selectors it cannot statically evaluate', async () => {
    const { beasties, warn, debug } = makeBeasties({}, 'p:_x { color: red }')

    await beasties.process(html)

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('selector'))
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('Cannot statically evaluate selector'))
  })

  it('states the consequence for selectors it cannot parse', async () => {
    const { beasties, warn } = makeBeasties({}, 'p:: { color: red }')

    await beasties.process(html)

    expect(warn).toHaveBeenCalledWith(
      'Could not parse 1 selector in /style.css; its rule was left out of the critical CSS but still applies once the full stylesheet loads:\n  p:: (Expected name, found ::)',
    )
  })

  it('pluralises the message for multiple unparseable selectors', async () => {
    const { beasties, warn } = makeBeasties({}, 'p:: { color: red }\nspan:: { color: green }')

    await beasties.process(html)

    const message = warn.mock.calls.map(call => call[0] as string).find(msg => msg.startsWith('Could not parse'))!
    expect(message).toContain('Could not parse 2 selectors in /style.css; their rules were left out of the critical CSS but still apply once the full stylesheet loads:')
  })
})
