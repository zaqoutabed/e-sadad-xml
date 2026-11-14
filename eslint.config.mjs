// Lint rules: catch bugs and keep the code consistent. Formatting is Prettier's job.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'examples/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,mts,js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // Tests and scripts may log and use non-null assertions freely.
    files: ['test/**', 'scripts/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // CommonJS files use require() by definition.
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
