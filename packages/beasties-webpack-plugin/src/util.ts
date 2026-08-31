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

interface HtmlPluginConstructor {
  getHooks?: (compilation: Compilation) => HtmlWebpackPlugin.Hooks
}

/**
 * Resolve html-webpack-plugin's compilation hooks from the plugin instance registered
 * in the configuration, so the plugin does not have to resolve the module itself.
 */
export function getHtmlPluginHooks(compilation: Compilation): HtmlWebpackPlugin.Hooks | undefined {
  for (const plugin of compilation.options.plugins) {
    const ctor = (plugin as { constructor?: HtmlPluginConstructor & { name?: string } })?.constructor
    if (ctor?.name !== 'HtmlWebpackPlugin') {
      continue
    }
    try {
      const hooks = ctor.getHooks?.(compilation)
      if (hooks?.beforeEmit) {
        return hooks
      }
    }
    catch {}
  }
}
