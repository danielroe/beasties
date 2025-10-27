import type { Compilation, Compiler } from 'webpack'

export function tap(inst: Compiler | Compilation, hook: string, pluginName: string, async: boolean, callback: (...rest: any[]) => void): void {
  if (inst.hooks) {
    const camel = hook.replace(/-([a-z])/g, (s, i) => i.toUpperCase())
    // @ts-expect-error - hooks call
    inst.hooks[camel][async ? 'tapAsync' : 'tap'](pluginName, callback)
  }
  else {
    // @ts-expect-error - webpack3
    inst.plugin(hook, callback)
  }
}
