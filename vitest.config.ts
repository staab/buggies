import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve workspace packages to their TypeScript sources while developing/testing.
  resolve: {
    conditions: ['development'],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    // Generating a full-size island is seconds of work, so give tests room.
    testTimeout: 20_000,
  },
})