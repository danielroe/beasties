import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  deps: { neverBundle: ['vite'] },
  failOnWarn: true,
  publint: true,
  attw: { profile: 'esm-only', level: 'error' },
}) as ReturnType<typeof defineConfig>
