import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))
const emptyStub = fileURLToPath(new URL('./tests/stubs/empty.ts', import.meta.url))
const appsyncStub = fileURLToPath(new URL('./tests/stubs/appsync-utils.ts', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': srcDir,
      // `server-only` throws by design when imported outside an RSC graph.
      'server-only': emptyStub,
      // The real `util` is injected by the APPSYNC_JS runtime, not the package,
      // so resolvers cannot be imported outside AppSync without this.
      '@aws-appsync/utils': appsyncStub,
    },
  },
  test: {
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    // Vitest 4: `projects` replaces the deprecated vitest.workspace.ts
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/lib/**/*.test.ts', 'amplify/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/components/**/*.test.tsx'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['./tests/integration/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          // aws-amplify keeps one module-scoped singleton per process, so these
          // must never run in parallel — concurrent sign-ins would clobber it.
          fileParallelism: false,
          retry: 1,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // `src/features/**` was listed here but has never existed; a non-matching
      // glob silently contributes nothing, which flatters the percentage.
      include: ['src/lib/**', 'src/components/**', 'amplify/functions/shared/**'],
      exclude: ['**/*.test.*', '**/*.d.ts'],
    },
  },
})
