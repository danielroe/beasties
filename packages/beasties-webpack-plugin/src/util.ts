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
