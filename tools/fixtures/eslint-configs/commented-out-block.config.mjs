import nx from '@nx/eslint-plugin';

// An older experiment, kept around commented out:
// depConstraints: [
//   {
//     sourceTag: '*',
//     onlyDependOnLibsWithTags: ['*'],
//   },
// ],

export default [
  {
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
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
