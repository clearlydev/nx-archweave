import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?js$'],
          // nx-archweave boundaries — the frontend and the backend may never import each other
          depConstraints: [
            {
              sourceTag: 'scope:frontend',
              notDependOnLibsWithTags: ['scope:backend'],
            },
            {
              sourceTag: 'scope:backend',
              notDependOnLibsWithTags: ['scope:frontend'],
            },
            {
              sourceTag: 'scope:shared',
              notDependOnLibsWithTags: ['scope:frontend', 'scope:backend'],
            },
            // baseline: everything else stays allowed (constraints apply conjunctively)
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
];
