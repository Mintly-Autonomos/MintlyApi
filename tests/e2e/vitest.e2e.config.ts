import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Registra o env `e2e` na allowlist compartilhada antes da suite e o remove
    // depois. Ver o cabecalho de global-setup.ts.
    globalSetup: ['tests/e2e/global-setup.ts'],
    include: ['tests/e2e/**/*.e2e.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    pool: 'threads',
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
})
