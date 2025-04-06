import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  declaration: 'node16',
  externals: ['vite'],
  rollup: {
    dts: {
      respectExternal: false,
    },
  },
})
