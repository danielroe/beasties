import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  copy: [{ from: 'src/index.d.ts', to: 'dist' }],
}) as ReturnType<typeof defineConfig>
