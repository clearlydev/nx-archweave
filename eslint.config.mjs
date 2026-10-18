import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            { sourceTag: 'type:util', onlyDependOnLibsWithTags: [] },
            { sourceTag: 'type:assets', onlyDependOnLibsWithTags: ['type:util'] },
            { sourceTag: 'type:policy', onlyDependOnLibsWithTags: ['type:util'] },
            { sourceTag: 'type:integration', onlyDependOnLibsWithTags: ['type:util'] },
            { sourceTag: 'type:engine', onlyDependOnLibsWithTags: ['type:util', 'type:policy', 'type:assets'] },
            {
              sourceTag: 'type:plugin',
              onlyDependOnLibsWithTags: ['type:util', 'type:integration', 'type:engine'],
            },
            { sourceTag: 'type:cli', onlyDependOnLibsWithTags: ['type:plugin'] },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      // _-prefixed parameters are the deliberate "unused by contract" idiom
      // (e.g. an interface method that ignores its context argument).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests assert non-null on values the test itself just arranged;
    // the ! there is signal, not risk.
    files: ['**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
