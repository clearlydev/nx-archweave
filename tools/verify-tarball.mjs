#!/usr/bin/env node
// Smoke test for the npm bundling strategy.
//
// Packs @clearlydev/nx-archweave into a real tarball (via `npm pack`, which
// runs the prepack/postpack hooks in tools/pack-sanitize.mjs — so the packed
// manifest never carries a `workspace:` range), installs that tarball into a
// throwaway temp project with a plain `npm i <tarball>` (no workspace/pnpm
// magic involved), then asserts:
//   1. generators.json is present and loads as JSON from the installed copy
//   2. every generator's `factory` module resolves and imports successfully
//      (proves the esbuild bundle inlined @nx-archweave/* correctly and the
//      dist/generators/<name>/generator.js paths generators.json points at
//      are exactly where tools/bundle.mjs wrote them)
//
// Usage: node tools/verify-tarball.mjs
// Nothing is published; everything happens under a temp dir that's removed
// at the end (unless KEEP_TMP=1 is set, for debugging).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(workspaceRoot, 'packages', 'nx-plugin');

function log(msg) {
  console.log(`[verify-tarball] ${msg}`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

const tmpRoot = mkdtempSync(path.join(tmpdir(), 'nx-archweave-verify-tarball-'));
const packDestination = path.join(tmpRoot, 'pack');
const installDir = path.join(tmpRoot, 'install');
mkdirSync(packDestination, { recursive: true });
mkdirSync(installDir, { recursive: true });

let exitCode = 0;

try {
  log(`packing @clearlydev/nx-archweave -> ${packDestination}`);
  // No --json: the prepack lifecycle (nx bundle) writes to stdout, which npm merges
  // into pack's own output and would corrupt JSON parsing. The tarball lands alone
  // in a dedicated destination directory, so locating it by extension is exact.
  run('npm', ['pack', '--pack-destination', packDestination], { cwd: pluginDir });
  const tarballs = readdirSync(packDestination).filter((file) => file.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(`expected exactly one packed tarball, found: ${tarballs.join(', ') || '(none)'}`);
  }
  const tarballPath = path.join(packDestination, tarballs[0]);
  log(`tarball: ${tarballPath}`);

  writeFileSync(
    path.join(installDir, 'package.json'),
    JSON.stringify({ name: 'verify-tarball-sandbox', version: '0.0.0', private: true }, null, 2)
  );

  log('npm i <tarball> into a clean temp project (no workspace/pnpm involved)');
  run('npm', ['i', tarballPath, '--no-audit', '--no-fund'], { cwd: installDir });

  const installedPkgDir = path.join(installDir, 'node_modules', '@clearlydev', 'nx-archweave');

  const generatorsJsonPath = path.join(installedPkgDir, 'generators.json');
  log(`loading generators.json from ${generatorsJsonPath}`);
  const generatorsJson = JSON.parse(readFileSync(generatorsJsonPath, 'utf8'));
  const generatorNames = Object.keys(generatorsJson.generators ?? {});
  if (generatorNames.length === 0) {
    throw new Error('generators.json has no generators declared');
  }
  log(`found ${generatorNames.length} generator(s): ${generatorNames.join(', ')}`);

  for (const name of generatorNames) {
    const { factory } = generatorsJson.generators[name];
    const factoryPath = path.join(installedPkgDir, `${factory}.js`);
    const factoryUrl = pathToFileURL(factoryPath).href;
    const mod = await import(factoryUrl);
    const exportNames = Object.keys(mod).filter((key) => typeof mod[key] === 'function');
    if (exportNames.length === 0) {
      throw new Error(`generator "${name}" factory ${factoryPath} exports no functions`);
    }
    log(`  OK  ${name} -> ${factory}.js (exports: ${exportNames.join(', ')})`);
  }

  // Only bundles ship: each generator factory, each migration, every exports target and the bin.
  // tsc's per-file output of everything else still imports the internal @nx-archweave/* packages
  // (and bundled libraries) the tarball does not carry.
  log('checking that every shipped .js file is a bundle entry');
  const installedManifest = JSON.parse(readFileSync(path.join(installedPkgDir, 'package.json'), 'utf8'));
  const migrationsPath = path.join(installedPkgDir, 'migrations.json');
  const installedMigrations = existsSync(migrationsPath) ? JSON.parse(readFileSync(migrationsPath, 'utf8')) : {};
  const entries = new Set(
    [
      ...Object.values(generatorsJson.generators ?? {}).map(({ factory }) => `${factory}.js`),
      ...Object.values(installedMigrations.generators ?? {}).map(({ implementation }) => `${implementation}.js`),
      ...Object.values(installedManifest.exports ?? {}).flatMap((target) => (typeof target === 'string' ? [target] : [target.import])),
      ...Object.values(installedManifest.bin ?? {}),
    ]
      .filter((file) => typeof file === 'string' && file.endsWith('.js'))
      .map((file) => path.posix.normalize(file.replace(/^\.\//, ''))),
  );
  const stray = readdirSync(path.join(installedPkgDir, 'dist'), { recursive: true })
    .map((entry) => `dist/${String(entry).split(path.sep).join('/')}`)
    .filter((file) => file.endsWith('.js') && !entries.has(file));
  if (stray.length > 0) throw new Error(`shipped .js files that are not bundle entries:\n  ${stray.join('\n  ')}`);
  log(`  OK  ${entries.size} bundle entries, nothing else`);

  // `nx migrate` loads each migration from the installed package the same way.
  for (const [name, { implementation }] of Object.entries(installedMigrations.generators ?? {})) {
    const mod = await import(pathToFileURL(path.join(installedPkgDir, `${implementation}.js`)).href);
    if (typeof mod.default !== 'function') {
      throw new Error(`migration "${name}" ${implementation}.js has no default export function`);
    }
    log(`  OK  migration ${name} -> ${implementation}.js`);
  }

  // The `@clearlydev/nx-archweave/eslint` entry a workspace's eslint.config.mjs imports —
  // resolved through the package's exports map, as ESLint would.
  log('importing @clearlydev/nx-archweave/eslint through the exports map');
  const probe = path.join(installDir, 'probe.mjs');
  writeFileSync(probe, "import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';\nconsole.log(JSON.stringify(fsdBoundaries({ severity: 'warn' })[0].rules));\n");
  const probeOut = run('node', [probe], { cwd: installDir }).trim();
  if (!probeOut.includes('archweave/fsd-boundaries')) {
    throw new Error(`eslint entry probe printed: ${probeOut}`);
  }
  log(`  OK  eslint entry -> ${probeOut}`);

  // The files/ templates ship beside the bundles and are found from them at run time — run two
  // generators from the installed package into an in-memory workspace and check what they wrote.
  log('rendering files/ templates from the installed bundles');
  const render = path.join(installDir, 'render.mjs');
  writeFileSync(
    render,
    [
      "import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';",
      "const dir = './node_modules/@clearlydev/nx-archweave/dist/generators';",
      "const { runAddGithubTemplates } = await import(`${dir}/add-github-templates/generator.js`);",
      "const { default: page } = await import(`${dir}/page/generator.js`);",
      'const tree = createTreeWithEmptyWorkspace();',
      "runAddGithubTemplates(tree, { issue: true, pr: true, codeowners: true, locale: 'ko' });",
      "tree.write('project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'src' }));",
      // a test runner, as Nx workspaces have — the page generator writes its spec stub then
      "tree.write('jest.config.ts', 'export default {};');",
      'const log = console.log; console.log = () => {};',
      "await page(tree, { name: 'home', segments: ['ui'] });",
      'console.log = log;',
      "console.log(JSON.stringify(tree.listChanges().map((c) => c.path).filter((p) => p.startsWith('.github/') || p.startsWith('src/')).sort()));",
    ].join('\n'),
  );
  const written = JSON.parse(run('node', [render], { cwd: installDir }).trim().split('\n').pop());
  const expected = [
    '.github/CODEOWNERS',
    '.github/ISSUE_TEMPLATE/bug-report.yml',
    '.github/ISSUE_TEMPLATE/feature-request.yml',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'src/pages/home/index.ts',
    'src/pages/home/model/home.spec.ts',
    'src/pages/home/model/home.ts',
    'src/pages/home/ui/index.ts',
  ];
  if (JSON.stringify(written) !== JSON.stringify(expected)) {
    throw new Error(`generated files differ:\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(written)}`);
  }
  log(`  OK  add-github-templates and page wrote ${written.length} files from their templates`);

  log('all generator factories imported successfully from the installed tarball');
} catch (error) {
  console.error('[verify-tarball] FAILED');
  console.error(error);
  exitCode = 1;
} finally {
  if (process.env.KEEP_TMP === '1') {
    log(`KEEP_TMP=1 set — leaving ${tmpRoot} in place`);
  } else {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

process.exit(exitCode);
