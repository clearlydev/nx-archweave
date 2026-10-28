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
// Before that, it also packs create-nx-archweave and checks both packed
// manifests against tools/tarball-policy.json: no install scripts, no
// `workspace:` range, no bundleDependencies, and no runtime dependency the
// policy doesn't list.
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
const cliDir = path.join(workspaceRoot, 'packages', 'create-nx-archweave');
const policyPath = path.join(workspaceRoot, 'tools', 'tarball-policy.json');

// The scripts npm runs on the consumer's machine when the package is installed. prepack and
// postpack stay in the packed manifest but only ever run where the package is packed.
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];
// The fields npm installs alongside the package; everything in them is checked against the policy.
const RUNTIME_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies'];
const DEPENDENCY_FIELDS = [...RUNTIME_DEPENDENCY_FIELDS, 'peerDependencies', 'devDependencies'];
// Packages listed here ship inside the tarball whole, past the policy; both packages are esbuild
// bundles and never need them. npm reads either spelling.
const BUNDLED_DEPENDENCY_FIELDS = ['bundleDependencies', 'bundledDependencies'];

function log(msg) {
  console.log(`[verify-tarball] ${msg}`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

function pack(packageDir, destination) {
  mkdirSync(destination, { recursive: true });
  // No --json: the prepack lifecycle (nx bundle) writes to stdout, which npm merges
  // into pack's own output and would corrupt JSON parsing. The tarball lands alone
  // in a dedicated destination directory, so locating it by extension is exact.
  run('npm', ['pack', '--pack-destination', destination], { cwd: packageDir });
  const tarballs = readdirSync(destination).filter((file) => file.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(`expected exactly one packed tarball, found: ${tarballs.join(', ') || '(none)'}`);
  }
  return path.join(destination, tarballs[0]);
}

// Lists every way the packed manifest breaks the policy; an empty list means it complies.
function policyViolations(manifest, policy) {
  const allowed = policy[manifest.name]?.dependencies;
  if (!Array.isArray(allowed)) {
    return [`${path.relative(workspaceRoot, policyPath)} has no "dependencies" list for ${manifest.name}`];
  }
  const violations = [];
  for (const script of INSTALL_SCRIPTS) {
    if (manifest.scripts?.[script] !== undefined) violations.push(`install script "${script}": ${manifest.scripts[script]}`);
  }
  for (const field of BUNDLED_DEPENDENCY_FIELDS) {
    if (manifest[field] !== undefined) violations.push(`${field} is set: ${JSON.stringify(manifest[field])}`);
  }
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range === 'string' && range.startsWith('workspace:')) violations.push(`${field}.${name} is ${range}`);
      if (RUNTIME_DEPENDENCY_FIELDS.includes(field) && !allowed.includes(name)) {
        violations.push(`${field}.${name} is not in the policy's allowed dependencies`);
      }
    }
  }
  return violations;
}

const tmpRoot = mkdtempSync(path.join(tmpdir(), 'nx-archweave-verify-tarball-'));
const installDir = path.join(tmpRoot, 'install');
mkdirSync(installDir, { recursive: true });

let exitCode = 0;

try {
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  const tarballs = [];
  for (const packageDir of [pluginDir, cliDir]) {
    log(`packing ${path.relative(workspaceRoot, packageDir)}`);
    tarballs.push(pack(packageDir, path.join(tmpRoot, 'pack', path.basename(packageDir))));
  }
  const [tarballPath] = tarballs;
  log(`tarball: ${tarballPath}`);

  log(`checking the packed manifests against ${path.relative(workspaceRoot, policyPath)}`);
  const broken = [];
  for (const tarball of tarballs) {
    const manifest = JSON.parse(run('tar', ['-xOzf', tarball, 'package/package.json']));
    const violations = policyViolations(manifest, policy);
    if (violations.length > 0) broken.push(`${manifest.name}@${manifest.version}:\n    ${violations.join('\n    ')}`);
    else log(`  OK  ${manifest.name}@${manifest.version}`);
  }
  if (broken.length > 0) {
    const hint = broken.some((entry) => entry.includes('not in the policy'))
      ? '\nA dependency the package really needs is added to tools/tarball-policy.json in the same pull request.'
      : '';
    throw new Error(`packed manifests break the tarball policy:\n  ${broken.join('\n  ')}${hint}`);
  }

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

  // Third-party code is never inlined: an audit can't see a bundled copy, and esbuild drops its
  // license notice. esbuild marks every module it inlines with a `// <path>` comment, so a path
  // into node_modules means one slipped in (an import of a package bundle.mjs doesn't list
  // as external).
  log('checking that no bundle inlines a node_modules package');
  const inlined = [...entries].flatMap((file) => {
    const source = readFileSync(path.join(installedPkgDir, file), 'utf8');
    const packages = [...source.matchAll(/^\/\/ (?:\.\.\/)*node_modules\/(?:\.pnpm\/)?(@[^/\s]+\/[^/\s]+|[^/\s]+)/gm)].map((match) => match[1]);
    return [...new Set(packages)].map((name) => `${file}: ${name}`);
  });
  if (inlined.length > 0) throw new Error(`bundles that inline third-party packages (make them external in tools/bundle.mjs):\n  ${inlined.join('\n  ')}`);
  log('  OK  no third-party package inlined');

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
