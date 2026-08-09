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
      // The real `util` is injected by the APPSYNC_JS runtime, not by the
      // package, so the resolvers cannot be imported outside AppSync without
      // this. Testing them matters: they ARE the public read boundary.
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
          include: ['src/components/**/*.test.tsx', 'src/lib/**/*.test.tsx'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'src/components/**', 'amplify/functions/**'],
      exclude: ['**/*.test.*', '**/*.d.ts'],
    },
  },
})
