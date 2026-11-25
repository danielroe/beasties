import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: false,
    checks: { legacyCjs: false },
    failOnWarn: true,
    publint: true,
    attw: { profile: 'node16', ignoreRules: ['cjs-resolves-to-esm'], level: 'error' },
    copy: [
      { from: 'src/index.d.mts', to: 'dist' },
      { from: 'src/index.d.cts', to: 'dist' },
    ],
  },
  {
    entry: ['src/compiler.ts', 'src/runtime.ts'],
    format: ['esm'],
    dts: true,
    failOnWarn: true,
  },
]) as ReturnType<typeof defineConfig>
