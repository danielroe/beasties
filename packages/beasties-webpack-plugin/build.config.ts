import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  declaration: 'compatible',
  externals: ['webpack'],
  rollup: {
    dts: {
      respectExternal: false,
    },
  },
})
