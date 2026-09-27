import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { cli: 'src/cli/main.ts', index: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: { entry: { index: 'src/index.ts' }, compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: true,
  // workspace-private package, bundled into the published output
  noExternal: ['@stagegrid/shared'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
})
