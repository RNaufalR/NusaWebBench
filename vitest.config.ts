import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Paket workspace mengekspos kondisi `source` (src/*.ts) untuk pengujian; runtime memakai dist.
    conditions: ['source'],
  },
  test: {
    include: ['tests/**/*.test.ts', 'scripts/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
