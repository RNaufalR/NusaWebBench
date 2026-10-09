import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
