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
export function readFile(file: string): Promise<string> {
  return promisify(fs.readFile)(path.resolve(cwd, file), 'utf-8')
}

type Bundle = (config: any, callback: (err: Error | null | undefined, stats: any) => void) => unknown

type ConfigDecorator<Config> = (config: Config) => Config | void

export interface Helpers<Config> {
  outDir: string
  compile: (entry: string, configDecorator: ConfigDecorator<Config>) => Promise<webpack.StatsCompilation>
  compileToHtml: (fixture: string, configDecorator: ConfigDecorator<Config>, beastiesOptions?: Options) => Promise<webpack.StatsCompilation & { html: string, document: Document }>
}

// each bundler writes to its own output directory so fixtures can be shared without racing
export function createHelpers<Config = webpack.Configuration>(bundle: Bundle, outDir: string): Helpers<Config> {
  // invoke the bundler on a given entry module, optionally mutating the default configuration
  function compile(entry: string, configDecorator: (config: Config) => Config | void) {
    return new Promise<webpack.StatsCompilation>((resolve, reject) => {
      const context = path.dirname(path.resolve(cwd, entry))
      entry = path.basename(entry)
      let config = {
        context,
        entry: path.resolve(context, entry),
        output: {
          path: path.resolve(cwd, path.resolve(context, outDir)),
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
      } as Config
      if (configDecorator) {
        config = configDecorator(config) || config
      }

      bundle(config, (err, stats) => {
        if (err)
          return reject(err)
        const info = stats!.toJson()
        if (stats?.hasErrors()) {
          return reject(new Error(info.errors?.[0]?.details || info.errors?.[0]?.message))
        }
        resolve(info)
      })
    })
  }

  // invoke compile(), applying Beasties to inline CSS and injecting `html` and `document` properties into the build info.
  async function compileToHtml(
    fixture: string,
    configDecorator: (config: Config) => Config | void,
    beastiesOptions: Options = {},
  ) {
    const info = await compile(`fixtures/${fixture}/index.js`, (config) => {
      config = configDecorator(config) || config;
      (config as webpack.Configuration).plugins!.push(
        new BeastiesWebpackPlugin({
          pruneSource: true,
          compress: false,
          logLevel: 'silent',
          ...beastiesOptions,
        }),
      )
    })
    const html = await readFile(`fixtures/${fixture}/${outDir}/index.html`)
    return Object.assign(info, {
      html,
      document: parseDom(html),
    })
  }

  return { outDir, compile, compileToHtml }
}

const webpackHelpers: Helpers<webpack.Configuration> = createHelpers<webpack.Configuration>(webpack as Bundle, 'dist')

export const compile: Helpers<webpack.Configuration>['compile'] = webpackHelpers.compile
export const compileToHtml: Helpers<webpack.Configuration>['compileToHtml'] = webpackHelpers.compileToHtml
