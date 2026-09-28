import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/helpers/global-setup.ts'],
    setupFiles: ['./test/helpers/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
