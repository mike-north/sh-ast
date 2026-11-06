/** Enforces typed syntax access and justified lint exceptions across TypeScript projects. */
import { defineConfig } from 'eslint/config';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import apiExtractorPlugin from '@api-extractor-tools/eslint-plugin';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/api-report/**',
      '**/docs/**',
      '**/temp/**',
      '**/api-report-combined/**',
      '**/api-docs-temp/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      apiExtractorPlugin.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Keep the any boundary explicit even if preset membership changes.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    plugins: { '@eslint-community/eslint-comments': eslintComments },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@eslint-community/eslint-comments/require-description': 'error',
      '@eslint-community/eslint-comments/no-unused-disable': 'error',
      'no-plusplus': 'off',
    },
  },
  eslintConfigPrettier,
);
