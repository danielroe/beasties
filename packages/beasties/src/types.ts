import type { Logger, LogLevel } from './util'

/**
 * The mechanism to use for lazy-loading stylesheets.
 *
 * Note: <kbd>JS</kbd> indicates a strategy requiring JavaScript (falls back to `<noscript>` unless disabled).
 *
 * - **default:** Move stylesheet links to the end of the document and insert preload meta tags in their place.
 * - **"body":** Move all external stylesheet links to the end of the document.
 * - **"media":** Load stylesheets asynchronously by adding `media="not x"` and removing once loaded. <kbd>JS</kbd>
 * - **"swap":** Convert stylesheet links to preloads that swap to `rel="stylesheet"` once loaded ([details](https://www.filamentgroup.com/lab/load-css-simpler/#the-code)). <kbd>JS</kbd>
 * - **"swap-high":** Use `<link rel="alternate stylesheet preload">` and swap to `rel="stylesheet"` once loaded ([details](http://filamentgroup.github.io/loadCSS/test/new-high.html)). <kbd>JS</kbd>
 * - **"swap-low":** Use `<link rel="alternate stylesheet">` (no `preload` in `rel` here!) and swap to `rel="stylesheet"` once loaded ([details](http://filamentgroup.github.io/loadCSS/test/new-low.html)). It ensures lowest priority compared to `swap` and `swap-high`. <kbd>JS</kbd>
 * - **"js":** Inject an asynchronous CSS loader similar to [LoadCSS](https://github.com/filamentgroup/loadCSS) and use it to load stylesheets. <kbd>JS</kbd>
 * - **"js-lazy":** Like `"js"`, but the stylesheet is disabled until fully loaded.
 * - **false:** Disables adding preload tags.
 */
type PreloadStrategy = 'body' | 'media' | 'swap' | 'swap-high' | 'swap-low' | 'js' | 'js-lazy'

/**
 * Controls which keyframes rules are inlined.
 *
 * - **"critical":** _(default)_ inline keyframes rules that are used by the critical CSS.
 * - **"all":** Inline all keyframes rules.
 * - **"none":** Remove all keyframes rules.
 */
type KeyframeStrategy = 'critical' | 'all' | 'none'

/** All optional. Pass them to `new Beasties({ ... })`. */
export interface Options {
  /**
   * Base path location of the CSS files _(default: `''`)_
   */
  path?: string
  /**
   * Public path of the CSS resources. This prefix is removed from the href _(default: `''`)_
   */
  publicPath?: string
  /**
   * Inline styles from external stylesheets _(default: `true`)_
   */
  external?: boolean
  /**
   * Inline external stylesheets smaller than a given size _(default: `0`)_
   */
  inlineThreshold?: number
  /**
   * If the non-critical external stylesheet would be below this size, just inline it _(default: `0`)_
   */
  minimumExternalSize?: number
  /**
   * Remove inlined rules from the external stylesheet _(default: `false`)_
   */
  pruneSource?: boolean
  /**
   * Merged inlined stylesheets into a single `<style>` tag _(default: `true`)_
   */
  mergeStylesheets?: boolean
  /**
   * additionalStylesheets Glob for matching other stylesheets to be used while looking for critical CSS.
   */
  additionalStylesheets?: string[]
  /**
   * Which {@link PreloadStrategy preload strategy} to use
   */
  preload?: PreloadStrategy | false
  /**
   * Add `<noscript>` fallback to JS-based strategies
   */
  noscriptFallback?: boolean
  /**
   * Inline critical font-face rules _(default: `false`)_
   */
  inlineFonts?: boolean
  /**
   * Preloads critical fonts _(default: `true`)_
   */
  preloadFonts?: boolean
  /**
   * Shorthand for setting `inlineFonts` + `preloadFonts`
   * - Values:
   * - `true` to inline critical font-face rules and preload the fonts
   * - `false` to don't inline any font-face rules and don't preload fonts
   */
  fonts?: boolean
  /**
   * Controls which keyframes rules are inlined.
   */
  keyframes?: KeyframeStrategy | boolean
  /**
   * Compress resulting critical CSS _(default: `true`)_
   */
  compress?: boolean
  /**
   * Controls {@link LogLevel log level} of the plugin _(default: `"info"`)_
   */
  logLevel?: LogLevel
  reduceInlineStyles?: boolean
  /**
   * Provide a custom logger interface {@link Logger logger}
   */
  logger?: Logger
}

export type { Logger }
