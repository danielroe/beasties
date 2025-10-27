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

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { JSDOM } from 'jsdom'
import webpack from 'webpack'

import BeastiesWebpackPlugin from '../src/index'

const cwd = fileURLToPath(new URL('.', import.meta.url))

const { window } = new JSDOM()

// parse a string into a JSDOM Document
function parseDom(html: string) {
  return new window.DOMParser().parseFromString(html, 'text/html')
}

// returns a promise resolving to the contents of a file
export function readFile(file: string) {
  return promisify(fs.readFile)(path.resolve(cwd, file), 'utf-8')
}

// invoke webpack on a given entry module, optionally mutating the default configuration
export function compile(entry: string, configDecorator: (config: webpack.Configuration) => webpack.Configuration | void) {
  return new Promise<webpack.StatsCompilation>((resolve, reject) => {
    const context = path.dirname(path.resolve(cwd, entry))
    entry = path.basename(entry)
    let config: webpack.Configuration = {
      context,
      entry: path.resolve(context, entry),
      output: {
        path: path.resolve(cwd, path.resolve(context, 'dist')),
        filename: 'bundle.js',
        chunkFilename: '[name].chunk.js',
      },
      resolveLoader: {
        modules: [path.resolve(cwd, '../node_modules')],
      },
      module: {
        rules: [],
      },
      plugins: [],
    }
    if (configDecorator) {
      config = configDecorator(config) || config
    }

    webpack(config, (err, stats) => {
      if (err)
        return reject(err)
      const info = stats!.toJson()
      if (stats?.hasErrors()) {
        return reject(info.errors?.[0]?.details)
      }
      resolve(info)
    })
  })
}

// invoke webpack via compile(), applying Beasties to inline CSS and injecting `html` and `document` properties into the webpack build info.
export async function compileToHtml(
  fixture: string,
  configDecorator: (config: webpack.Configuration) => webpack.Configuration | void,
  beastiesOptions: Options = {},
) {
  const info = await compile(`fixtures/${fixture}/index.js`, (config) => {
    config = configDecorator(config) || config
    config.plugins!.push(
      new BeastiesWebpackPlugin({
        pruneSource: true,
        compress: false,
        logLevel: 'silent',
        ...beastiesOptions,
      }),
    )
  })
  const html = await readFile(`fixtures/${fixture}/dist/index.html`)
  return Object.assign(info, {
    html,
    document: parseDom(html),
  })
}
