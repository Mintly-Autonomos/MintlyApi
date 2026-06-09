import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'threads',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.int.spec.ts', 'src/**/*.e2e.spec.ts', 'node_modules/**', 'dist/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.int.spec.ts'],
          exclude: ['node_modules/**', 'dist/**'],
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.int.spec.ts',
        'src/**/*.e2e.spec.ts',
        'src/server.ts',
        'src/infrastructure/server/start-server.ts',
        'src/infrastructure/db/mongodb/index.ts',
        'src/**/index.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        branches: 90,
        functions: 90,
      },
    },
  },
})
