/**
 * Content for the generated `libs/shared-types` library (shape verified end-to-end on
 * 2026-10-05).
 *
 * The library is a PACKAGE.JSON workspace project — the same shape the Nx
 * fullstack template uses for its own libs (source-exported, private, tagged
 * via the nx field). A project.json/tsconfig-paths shape broke the modern TS
 * setup outright (TS5090: paths without baseUrl), so the package link IS the
 * wiring; a tsconfig path alias is only an extra for classic setups that
 * already carry a baseUrl.
 */

export function sharedTypesIndexContent(): string {
  return `export * from './lib/api-types.js';\n`;
}

export function sharedTypesApiTypesContent(): string {
  return [
    '// Types shared between the frontend and the backend live here.',
    '// Example: the api app returns this from GET /api/health, and the',
    '// frontend consumes the same shape — one definition, no drift.',
    'export interface ApiHealthResponse {',
    "  status: 'ok';",
    '}',
    '',
  ].join('\n');
}

/** @param packageName e.g. `@org/shared-types` — also the import specifier. */
/** `sharedTag` is the tag the shared role carries (`boundaries.tags.shared`). */
export function sharedTypesPackageJsonContent(packageName: string, sharedTag = 'scope:shared'): string {
  return `${JSON.stringify(
    {
      name: packageName,
      version: '0.0.1',
      private: true,
      type: 'module',
      main: './src/index.ts',
      types: './src/index.ts',
      exports: {
        '.': {
          types: './src/index.ts',
          import: './src/index.ts',
          default: './src/index.ts',
        },
      },
      nx: {
        projectType: 'library',
        tags: [sharedTag],
        targets: {},
      },
    },
    null,
    2,
  )}\n`;
}
