import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      'dist/**',
      'eslint.config.mjs',
      'jest.config.mjs',
      'webpack.config.mjs',
    ],
  },
  { files: ['**/*.{js,mjs,cjs,ts}'] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.all,
  // See: https://typescript-eslint.io/getting-started/typed-linting/
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // See: https://eslint.org/docs/latest/rules/
    rules: {
      'no-use-before-define': 'off',
      'capitalized-comments': 'off',
      'class-methods-use-this': 'off',
      eqeqeq: ['error', 'smart'],
      'func-style': [
        'error',
        'declaration',
        {
          allowArrowFunctions: true,
        },
      ],
      'init-declarations': 'off', // Conflicts with no-useless-assignment
      'max-classes-per-file': 'off',
      'max-lines': 'off',
      'max-params': ['error', 5],
      'max-statements': ['error', 20],
      'no-eq-null': 'off', // Conflicts with eqeqeq:smart
      'no-inline-comments': 'off',
      'no-magic-numbers': 'off',
      'no-plusplus': [
        'error',
        {
          allowForLoopAfterthoughts: true,
        },
      ],
      'no-shadow': [
        'error',
        {
          ignoreOnInitialization: true,
        },
      ],
      'no-ternary': 'off',
      'no-warning-comments': 'warn',
      'one-var': ['error', 'never'],
      'prefer-destructuring': 'off',
      'prefer-named-capture-group': 'off',
      'sort-imports': 'error',
      'sort-keys': 'off',
      'sort-vars': 'off',

      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowAny: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowNumber: true,
          allowRegExp: false,
        },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/non-nullable-type-assertion-style': 'off', // Conflicts with @typescript-eslint/no-non-null-assertion
      '@typescript-eslint/prefer-promise-reject-errors': 'off', // Duplicate @typescript-eslint/only-throw-error
    },
  },
  eslintConfigPrettier,
];
