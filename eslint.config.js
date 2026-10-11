// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'data/**',
      'build/**',
      '.toolchain/**',
      // Fixture sintetis sengaja memuat error browser untuk uji ground truth (lihat fixtures/ground-truth.json).
      'fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
  prettier,
);
