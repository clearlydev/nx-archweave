import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      // Nx's own plugin check: generators.json and migrations.json point at real factories and
      // schemas, and package.json registers them.
      '@nx/nx-plugin-checks': 'error',
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
          // Bundled inline by tools/bundle.mjs (esbuild) into dist/ — these
          // stay in devDependencies (needed at build/bundle time only) and
          // never appear as runtime deps of the published tarball.
          ignoredDependencies: [
            '@nx-archweave/integrations',
            '@nx-archweave/shared',
            '@nx-archweave/template-engine',
          ],
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
