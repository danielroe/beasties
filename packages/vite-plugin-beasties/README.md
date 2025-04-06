# vite-plugin-beasties

A Vite plugin that uses [beasties](https://github.com/danielroe/beasties) to embed critical CSS in your HTML pages.

## Features

- 🚀 Automatically identifies and inlines critical CSS
- 🧹 Supports pruning the CSS files to remove inlined styles from external stylesheets
- 🔄 Works with Vite's build process using the `transformIndexHtml` hook
- ⚙️ Full access to beasties configuration options

## Installation

```bash
# npm
npm install -D vite-plugin-beasties

# yarn
yarn add -D vite-plugin-beasties

# pnpm
pnpm add -D vite-plugin-beasties
```

## Usage

Add the plugin to your `vite.config.js/ts`:

```js
// vite.config.js
import { defineConfig } from 'vite'
import { beasties } from 'vite-plugin-beasties'

export default defineConfig({
  plugins: [
    beasties({
      // Plugin options
      options: {
        // Beasties library options
        preload: 'swap',
        pruneSource: true, // Enable pruning CSS files
        inlineThreshold: 4000, // Inline stylesheets smaller than 4kb
      },
      // Filter to apply beasties only to specific HTML files
      filter: path => path.endsWith('.html'),
    }),
  ],
})
```

## Options

### Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `options` | `Object` | `{}` | Options passed to the beasties constructor |
| `filter` | `Function` | `(path) => path.endsWith('.html')` | Filter function to determine which HTML files to process |

### Beasties Options

See the [beasties documentation](https://github.com/danielroe/beasties) for all available options.

Common options include:

- `preload`: Strategy for loading non-critical CSS (`'js'`, `'js-lazy'`, `'media'`, `'swap'`, `'swap-high'`, `'swap-low'`, `false`)
- `pruneSource`: Whether to update external CSS files to remove inlined styles
- `inlineThreshold`: Size limit in bytes to inline an entire stylesheet
- `minimumExternalSize`: If the non-critical part of a CSS file is smaller than this, the entire file will be inlined
- `additionalStylesheets`: Additional stylesheets to consider for critical CSS

## 💻 Development

- Clone this repository
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

## License

MIT

Published under [MIT License](./LICENCE).

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/vite-plugin-beasties?style=flat-square
[npm-version-href]: https://npmjs.com/package/vite-plugin-beasties
[npm-downloads-src]: https://img.shields.io/npm/dm/vite-plugin-beasties?style=flat-square
[npm-downloads-href]: https://npm.chart.dev/vite-plugin-beasties
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/danielroe/vite-plugin-beasties/ci.yml?branch=main&style=flat-square
[github-actions-href]: https://github.com/danielroe/vite-plugin-beasties/actions?query=workflow%3Aci
[codecov-src]: https://img.shields.io/codecov/c/gh/danielroe/vite-plugin-beasties/main?style=flat-square
[codecov-href]: https://codecov.io/gh/danielroe/vite-plugin-beasties
