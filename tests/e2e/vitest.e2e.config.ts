import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    pool: 'threads',
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
})
