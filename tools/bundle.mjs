#!/usr/bin/env node
// Bundles a publishable package's dist output with esbuild so the tarball
// carries no `workspace:*` internal deps.
//
// - platform=node, format=esm
// - `@nx-archweave/*` (and any other workspace-only package actually used
//   at runtime) are inlined into the bundle
// - the one real third-party runtime dep (@nx/devkit) and node builtins
//   stay external, resolved from the consumer's own node_modules
//
// Usage: node tools/bundle.mjs <package-dir-name>
//   node tools/bundle.mjs nx-plugin
//   node tools/bundle.mjs create-nx-archweave
//
// Run via Nx: `nx run @clearlydev/nx-archweave:bundle` / `nx run create-nx-archweave:bundle`
// (both depend on `build` so tsc has already emitted declarations into dist/
// before esbuild overwrites the plain .js entry files with bundled ones).

import { build } from 'esbuild';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Registry of publishable packages and how to bundle them.
 * `external` lists real third-party runtime deps + anything the consumer's
 * own node_modules must provide; everything else (in particular
 * `@nx-archweave/*` workspace packages) gets inlined by esbuild.
 */
const PACKAGES = {
  'nx-plugin': {
    dir: 'packages/nx-plugin',
    external: ['@nx/devkit'],
    entryPoints(pkgDir) {
      // src/eslint: the `@clearlydev/nx-archweave/eslint` entry a workspace's eslint.config.mjs imports
      const entries = ['src/index.ts', 'src/bin/review-verdict.ts', 'src/eslint/index.ts'];
      const generatorsDir = path.join(pkgDir, 'src/generators');
      for (const name of readdirSync(generatorsDir, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        const generatorFile = path.join(generatorsDir, name.name, 'generator.ts');
        if (existsSync(generatorFile)) {
          entries.push(`src/generators/${name.name}/generator.ts`);
        }
      }
      // Nx migrations (src/migrations/update-<version>/*.ts), once there are any — bundled like
      // the generators, so migrations.json can point into dist/.
      const migrationsDir = path.join(pkgDir, 'src/migrations');
      if (existsSync(migrationsDir)) {
        for (const entry of readdirSync(migrationsDir, { recursive: true })) {
          const file = String(entry);
          if (file.endsWith('.ts') && !file.endsWith('.spec.ts')) entries.push(`src/migrations/${file.split(path.sep).join('/')}`);
        }
      }
      return entries;
    },
    // Each generator's files/ templates (rendered by Nx's generateFiles) are not code, so esbuild
    // never sees them: they are copied next to the bundles, where the generators look for them.
    assets(pkgDir) {
      const generatorsDir = path.join(pkgDir, 'src/generators');
      return readdirSync(generatorsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(path.join(generatorsDir, entry.name, 'files')))
        .map((entry) => `generators/${entry.name}/files`);
    },
  },
  'create-nx-archweave': {
    dir: 'packages/create-nx-archweave',
    // The CLI has no runtime import of @clearlydev/nx-archweave (it only names
    // the package as an install spec in the plan it executes), so nothing
    // workspace-internal needs inlining here; only node builtins stay external.
    external: [],
    entryPoints() {
      return ['src/index.ts', 'src/bin.ts'];
    },
    // bin.ts already starts with `#!/usr/bin/env node`; esbuild preserves an
    // entry file's own shebang, so no banner override is needed here.
  },
};

async function main() {
  const pkgName = process.argv[2];
  if (!pkgName || !PACKAGES[pkgName]) {
    console.error(
      `Usage: node tools/bundle.mjs <${Object.keys(PACKAGES).join('|')}>`
    );
    process.exit(1);
  }

  const config = PACKAGES[pkgName];
  const pkgDir = path.join(workspaceRoot, config.dir);
  const entryPoints = config.entryPoints(pkgDir);

  const result = await build({
    absWorkingDir: pkgDir,
    metafile: true,
    entryPoints,
    outdir: 'dist',
    outbase: 'src',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // ESM entry first: an inlined third-party package (jsonc-parser) otherwise resolves to its
    // UMD build, whose dynamic require() cannot run inside an ESM bundle.
    mainFields: ['module', 'main'],
    external: config.external,
    sourcemap: false,
    logLevel: 'info',
  });

  // tsc's per-file .js output is only an input to the bundles: what is left of it still imports
  // the internal @nx-archweave/* packages, which the tarball does not carry. Only the bundles
  // stay; the .d.ts files (types for the exported entries) are kept.
  const bundles = new Set(Object.keys(result.metafile.outputs).map((output) => path.resolve(pkgDir, output)));
  const distDir = path.join(pkgDir, 'dist');
  let pruned = 0;
  for (const entry of readdirSync(distDir, { recursive: true })) {
    const file = path.join(distDir, String(entry));
    if (/\.js(\.map)?$/.test(file) && !bundles.has(file.replace(/\.map$/, ''))) {
      rmSync(file);
      pruned++;
    }
  }

  const assets = config.assets?.(pkgDir) ?? [];
  for (const asset of assets) {
    cpSync(path.join(pkgDir, 'src', asset), path.join(pkgDir, 'dist', asset), { recursive: true });
  }

  console.log(`[bundle] ${pkgName}: bundled ${entryPoints.length} entry point(s)${assets.length ? ` and copied ${assets.length} template folder(s)` : ''} into ${config.dir}/dist, removed ${pruned} unbundled .js file(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
