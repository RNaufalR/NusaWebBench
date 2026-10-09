import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Tes selalu memakai sumber TypeScript paket workspace (bukan dist), agar tes tidak
 * diam-diam menguji build lama. Runtime memakai dist melalui kondisi export default.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@nusawebbench/core': path.join(root, 'packages/core/src/index.ts'),
      '@nusawebbench/storage': path.join(root, 'packages/storage/src/index.ts'),
      '@nusawebbench/orchestrator': path.join(root, 'packages/orchestrator/src/index.ts'),
      '@nusawebbench/report': path.join(root, 'packages/report/src/index.ts'),
      '@nusawebbench/fixtures': path.join(root, 'packages/fixtures/src/index.ts'),
      '@nusawebbench/browser-qa': path.join(root, 'packages/browser-qa/src/index.ts'),
      '@nusawebbench/lighthouse': path.join(root, 'packages/lighthouse/src/index.ts'),
      '@nusawebbench/ux-rules': path.join(root, 'packages/ux-rules/src/index.ts'),
      '@nusawebbench/ai': path.join(root, 'packages/ai/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'scripts/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
