import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: false,
    copy: [{ from: 'src/index.d.ts', to: 'dist' }],
  },
  {
    entry: ['src/compiler.ts', 'src/runtime.ts'],
    format: ['esm'],
    dts: true,
  },
]) as ReturnType<typeof defineConfig>
