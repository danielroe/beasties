import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  deps: { neverBundle: ['vite'] },
}) as ReturnType<typeof defineConfig>
