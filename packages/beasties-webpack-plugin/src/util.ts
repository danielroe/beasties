import type HtmlWebpackPlugin from 'html-webpack-plugin'
import type { Compilation, Compiler } from 'webpack'

const KEBAB_CASE_RE = /-([a-z])/g

export function tap(inst: Compiler | Compilation, hook: string, pluginName: string, async: boolean, callback: (...rest: any[]) => void): void {
  if (inst.hooks) {
    const camel = hook.replace(KEBAB_CASE_RE, (_, i) => i.toUpperCase())
    // @ts-expect-error - hooks call
    inst.hooks[camel][async ? 'tapAsync' : 'tap'](pluginName, callback)
  }
  else {
    // @ts-expect-error - webpack3
    inst.plugin(hook, callback)
  }
}

/**
 * Rspack exposes `compilation.hooks` as a proxy that throws on unsupported webpack
 * hooks, so unknown hooks must be probed with `in` rather than by reading them.
 */
export function hasHook(inst: Compiler | Compilation, hook: string): boolean {
  return !!inst.hooks && hook in inst.hooks
}

interface HtmlPluginConstructor {
  getHooks?: (compilation: Compilation) => HtmlWebpackPlugin.Hooks
  getCompilationHooks?: (compilation: Compilation) => HtmlWebpackPlugin.Hooks
}

const HTML_PLUGIN_NAMES = new Set(['HtmlWebpackPlugin', 'HtmlRspackPlugin'])

/**
 * Resolve the html plugin's compilation hooks from the plugin instance registered in
 * the configuration, covering html-webpack-plugin, html-rspack-plugin and rspack's
 * builtin `HtmlRspackPlugin` (which names the accessor `getCompilationHooks`).
 */
export function getHtmlPluginHooks(compilation: Compilation): HtmlWebpackPlugin.Hooks | undefined {
  for (const plugin of compilation.options.plugins) {
    const ctor = (plugin as { constructor?: HtmlPluginConstructor & { name?: string } })?.constructor
    if (!ctor?.name || !HTML_PLUGIN_NAMES.has(ctor.name)) {
      continue
    }
    try {
      const hooks = ctor.getHooks?.(compilation) ?? ctor.getCompilationHooks?.(compilation)
      if (hooks?.beforeEmit) {
        return hooks
      }
    }
    catch {}
  }
}
