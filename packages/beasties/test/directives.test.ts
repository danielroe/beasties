import type { Logger } from '../src/types'

import { describe, expect, it, vi } from 'vitest'
import { compileSheet } from '../src/compiler'
import Beasties from '../src/index'

const HTML = `<html><head><link rel="stylesheet" href="/style.css"></head><body><h1>Hi</h1></body></html>`

function createTestLogger() {
  const logger: Logger = {
    warn: () => {},
    info: () => {},
    error: () => {},
    debug: () => {},
  }
  return { logger, warn: vi.spyOn(logger, 'warn') }
}

async function classic(css: string, logger?: Logger) {
  const beasties = new Beasties({
    reduceInlineStyles: false,
    path: '/',
    logLevel: 'warn',
    preload: false,
    logger,
  })
  beasties.readFile = () => css
  const result = await beasties.process(HTML)
  return [...result.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('')
}

describe('critters: alias', () => {
  it('should honour critters: directives at runtime', async () => {
    const { logger, warn } = createTestLogger()
    const css = await classic(`/* critters:include */\n.not-present { color: red; }\n/* critters:exclude */\nh1 { color: blue; }`, logger)

    expect(css).toBe('.not-present{color:red}')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('Found deprecated "critters:" comment directives. Use the "beasties:" prefix instead, for example "/* beasties:include start */".')
  })

  it('should honour critters: directives at compile time', () => {
    const sheet = compileSheet(`/* critters:include start */\n.not-present { color: red; }\n/* critters:include end */`)

    expect(sheet.rules[0]!.always).toBe(true)
    expect(sheet.warnings).toEqual(['Found deprecated "critters:" comment directives. Use the "beasties:" prefix instead, for example "/* beasties:include start */".'])
  })
})

describe('unrecognised directives', () => {
  it('should warn on a misspelled command at runtime', async () => {
    const { logger, warn } = createTestLogger()
    await classic(`/* beasties:inclde */\n.not-present { color: red; }`, logger)

    expect(warn).toHaveBeenCalledWith('Unknown comment directive "beasties:inclde". Supported directives are: beasties:include, beasties:exclude, beasties:include start, beasties:include end, beasties:exclude start, beasties:exclude end.')
  })

  it('should warn on an unknown namespace at compile time', () => {
    const sheet = compileSheet(`/* critter:include */\n.not-present { color: red; }`)

    expect(sheet.warnings).toEqual(['Ignoring unrecognised comment directive "critter:include". Did you mean "beasties:include"?'])
    expect(sheet.rules[0]!.always).toBeUndefined()
  })

  it.each([
    '/*! beasties:include */',
    '/*! Copyright 2018 Google LLC. Licensed under Apache-2.0 */',
    '/* Copyright 2018 Google LLC: include the license in redistributions */',
    '/*# sourceMappingURL=style.css.map */',
    '/* TODO: exclude this once the redesign lands */',
    '/* note: include start */',
    '/* https://example.com/docs#include */',
  ])('should stay quiet for %s', async (comment) => {
    const { logger, warn } = createTestLogger()
    const css = `${comment}\nh1 { color: blue; }`
    await classic(css, logger)

    expect(warn).not.toHaveBeenCalled()
    expect(compileSheet(css).warnings).toEqual([])
  })
})
