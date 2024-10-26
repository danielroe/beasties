import { fileURLToPath } from 'node:url'
import codspeed from '@codspeed/vitest-plugin'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [codspeed()],
  resolve: {
    alias: {
      beasties: fileURLToPath(new URL('./packages/beasties/src/index', import.meta.url)),
    },
  },
  test: {
    coverage: {
      include: [
        'packages/*/src/**/*.[tj]s',
      ],
    },
  },
})
