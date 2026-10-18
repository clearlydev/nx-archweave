import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
          // Bundled inline by tools/bundle.mjs (esbuild) into dist/ — stays
          // in devDependencies (needed at build/bundle time only) and never
          // appears as a runtime dep of the published tarball.
          ignoredDependencies: ['@clearlydev/nx-archweave'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
