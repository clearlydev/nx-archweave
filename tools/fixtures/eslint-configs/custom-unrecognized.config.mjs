import nx from '@nx/eslint-plugin';

const myConstraints = [
  { sourceTag: 'type:feature', onlyDependOnLibsWithTags: ['type:util'] },
];

export default [
  ...nx.configs['flat/base'],
  {
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          depConstraints: [...myConstraints, { sourceTag: '*', onlyDependOnLibsWithTags: ['type:util', '*'] }],
        },
      ],
    },
  },
];
