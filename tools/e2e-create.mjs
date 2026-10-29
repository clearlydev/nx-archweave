#!/usr/bin/env node
// Release-gate E2E for the create flow: packs both packages, runs the CLI from the
// tarball and checks the generated workspace end to end.
//
//   node tools/e2e-create.mjs --pm=pnpm
//   node tools/e2e-create.mjs --pm=npm
//   node tools/e2e-create.mjs --pm=yarn [--frontend=next]   (the yarn on PATH decides the flavor)
//   node tools/e2e-create.mjs --pm=pnpm --frontend=next --backend=nest
//   node tools/e2e-create.mjs --pm=npm --backend=nest   (react-vite × nest)
//   node tools/e2e-create.mjs --pm=pnpm --frontend=none --backend=express   (backend-only)
//   node tools/e2e-create.mjs --pm=bun
//
// Modes (hybrid gate):
//   (default, strict)  every failure exits 1 — local release gate and the manual CI run.
//   --mode=pr          UPSTREAM failures (create-nx-workspace itself, @nx/*
//                      installs, official generators, the workspace's own
//                      dependency install) exit 0 with a ::warning:: — the
//                      ecosystem's drift must not hold our merges hostage.
//                      OUR failures (pack, CLI start-up before its plan
//                      print, wiring markers, registration, build/lint/typecheck/test,
//                      doctor gate) still exit 1.
//
// Packs both publishable packages (prepack bundles them), launches the packed
// CLI the way a user does (`npm exec` / `pnpm dlx` / `yarn dlx` / `bunx`; only yarn
// classic, which has no dlx, passes --package-manager),
// creates a real workspace with the real create-nx-workspace and Nx generators, and asserts the wiring that
// the product promises:
//   1. the CLI takes the launching package manager, exits 0, and the
//      add-backend report shows the deny-rule wiring
//   2. libs/shared-types is registered (pnpm-workspace.yaml / workspaces field)
//   3. the generated workspace installs, `nx run-many -t build,lint` is green, then `-t typecheck,test`
//      (bun × next skips the web app's test, a known Nx issue)
//   4. `doctor --json --quiet` reports safe or manual-review-required
//
// Read-only toward the repo; everything happens in a temp directory.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStepLog } from './e2e-steps.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modeArg = process.argv.find((a) => a.startsWith('--mode='));
const mode = modeArg ? modeArg.slice('--mode='.length) : 'strict';
if (mode !== 'strict' && mode !== 'pr') {
  console.error(`e2e-create: unsupported --mode "${mode}" (strict|pr)`);
  process.exit(2);
}
const extraArgs = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--pm=') && !a.startsWith('--mode=') && !a.startsWith('--frontend=') && !a.startsWith('--backend='));
if (extraArgs.length > 0) {
  console.error(`e2e-create: unknown arguments: ${extraArgs.join(' ')} (accepted: --pm=pnpm|npm|yarn|bun, --frontend=react-vite|next|none, --backend=express|nest|none, --mode=strict|pr)`);
  process.exit(2);
}
const pmArg = process.argv.find((a) => a.startsWith('--pm='));
const pm = pmArg ? pmArg.slice('--pm='.length) : 'pnpm';
if (pm !== 'pnpm' && pm !== 'npm' && pm !== 'yarn' && pm !== 'bun') {
  console.error(`e2e-create: unsupported --pm "${pm}" (pnpm|npm|yarn|bun)`);
  process.exit(2);
}
// react-vite (default) is the full fullstack flow with the express backend. next
// defaults to no backend — creation, build/lint and doctor only;
// --backend=express|nest wires one there too (both frontends build apps/web).
const frontendArg = process.argv.find((a) => a.startsWith('--frontend='));
const frontend = frontendArg ? frontendArg.slice('--frontend='.length) : 'react-vite';
if (frontend !== 'react-vite' && frontend !== 'next' && frontend !== 'none') {
  console.error(`e2e-create: unsupported --frontend "${frontend}" (react-vite|next|none)`);
  process.exit(2);
}
const backendArg = process.argv.find((a) => a.startsWith('--backend='));
// none (backend-only) needs a backend; express unless --backend says otherwise
const backend = backendArg ? backendArg.slice('--backend='.length) : frontend === 'next' ? 'none' : 'express';
if (!['express', 'nest', 'none'].includes(backend)) {
  console.error(`e2e-create: unsupported --backend "${backend}" (express|nest|none)`);
  process.exit(2);
}
if (frontend === 'none' && backend === 'none') {
  console.error('e2e-create: --frontend=none is a backend-only workspace — pass --backend=express|nest');
  process.exit(2);
}

const MAX_BUFFER = 64 * 1024 * 1024;
const stepLog = createStepLog();
const steps = stepLog.names;
// Plan steps whose commands belong to the upstream ecosystem, not to us.
const UPSTREAM_PLAN_STEPS = ['create-workspace', 'add-react-plugin', 'create-web-app', 'install-backend-plugin', 'create-api-app'];
function fail(step, detail, output, kind = 'ours') {
  // 'create workspace' CLI failures are classified by WHICH plan step stopped.
  // Anything before the plan print is ours: the tarball or bin not starting, a
  // question asked without a terminal, the wrong package manager picked from the
  // launcher or a compatibility stop — exactly what this launch guards.
  if (step === 'create workspace' && output && output.includes('create-nx-archweave will run')) {
    const stopped = /stopped: step "([^"]+)"/.exec(output);
    if (!stopped || UPSTREAM_PLAN_STEPS.includes(stopped[1])) kind = 'upstream';
  }
  if (step === 'workspace install') kind = 'upstream'; // the workspace's own dep tree
  if (kind === 'upstream' && mode === 'pr') {
    const title = `e2e-create (${pm}): upstream drift at "${step}"`;
    console.log(`::warning title=${title}::${(detail ?? '').replace(/\n/g, ' ')} — not blocking this PR; see the job log (the manual strict CI run reports it as a failure).`);
    console.error(`\ne2e-create (${pm}) UPSTREAM failure at: ${step} (pr mode → green)`);
    if (output) console.error(`\n--- captured output (tail) ---\n${output.slice(-4000)}`);
    process.exit(0);
  }
  console.error(`\ne2e-create FAILED at: ${step}`);
  if (detail) console.error(`  ${detail}`);
  if (output) console.error(`\n--- captured output (tail) ---\n${output.slice(-4000)}`);
  console.error(`\ncompleted steps: ${steps.join(' → ') || '(none)'}`);
  if (steps.length > 0) console.error(`\ntimings of the completed steps:\n${stepLog.timings()}`);
  process.exit(1);
}
// npm, pnpm, yarn and bun are .cmd shims on Windows, which Node cannot start without a
// shell. Node joins shell arguments unquoted, so on Windows an argument with a space (a
// temp path under a user directory with one) is quoted here; the arguments are this
// script's own flags and paths (the CLI itself escapes fully — spawnable-command.ts).
const SHELL = process.platform === 'win32';
const shellArgs = (args) => (SHELL ? args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)) : args);

function run(step, command, args, options = {}) {
  const result = spawnSync(command, shellArgs(args), { encoding: 'utf-8', maxBuffer: MAX_BUFFER, shell: SHELL, ...options });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) fail(step, `${command} ${args.join(' ')} → exit ${result.status}`, output);
  stepLog.record(step);
  // stdout alone matters for pipe consumers (the doctor gate); combined is for markers.
  return { output, stdout: result.stdout ?? '' };
}

// The real long path: Windows runners' TEMP is an 8.3 short name (C:\Users\RUNNER~1\…), and bun
// computes its workspace symlinks against the long one, producing paths that do not exist.
const work = realpathSync.native(mkdtempSync(join(tmpdir(), `e2e-create-${pm}-`)));
console.log(`e2e-create (${pm}) — working in ${work}`);
process.on('exit', (code) => {
  if (code === 0) rmSync(work, { recursive: true, force: true });
  else console.error(`(left in place for inspection: ${work})`);
});

// 1. pack both packages (prepack runs the nx bundle)
const packDir = join(work, 'pack');
mkdirSync(packDir, { recursive: true });
for (const dir of ['packages/nx-plugin', 'packages/create-nx-archweave']) {
  run(`pack ${dir}`, 'npm', ['pack', '--pack-destination', packDir], { cwd: join(repoRoot, dir) });
}
const tarballs = readdirSync(packDir);
const pluginTgz = tarballs.find((f) => f.startsWith('clearlydev-nx-archweave-'));
const cliTgz = tarballs.find((f) => f.startsWith('create-nx-archweave-'));
if (!pluginTgz || !cliTgz) fail('locate tarballs', `found: ${tarballs.join(', ')}`);

// 2–3. run the real create flow, launched the way a user launches it — `npm exec` /
// `pnpm dlx` / `yarn dlx` / `bunx` on the packed CLI — and WITHOUT --package-manager: the CLI must
// take the manager that launched it (stdin is not a TTY here, so nothing is asked). The
// npm leg uses `--package=`, which also exports npm_config_package to the CLI: its own
// `npx create-nx-workspace` step must not pick that up. Only yarn classic (no dlx) and yarn on
// Windows name their manager.
const demo = 'e2e-demo';
const withBackend = backend !== 'none';
// yarn reads a Windows absolute path (C:\…\x.tgz) as a package name and asks the registry for
// it. On Windows the yarn leg passes the plugin tarball relative to the workspace, where the
// CLI's `yarn add` runs, and launches the CLI through `npm exec` (yarn dlx resolves relative
// paths inside its own temp project).
const yarnOnWindows = pm === 'yarn' && SHELL;
const pluginSource = yarnOnWindows ? `../pack/${pluginTgz}` : join(packDir, pluginTgz);
const cliArgs = [
  demo,
  '--preset=solo',
  `--frontend=${frontend}`,
  `--backend=${backend}`,
  '--locale=en',
  `--plugin-source=${pluginSource}`,
];
// The yarn flavor on PATH decides the yarn leg: berry launches like a user does
// (`yarn dlx`), classic has no dlx, so it names the manager through `npm exec`.
// Asked from the temp dir: the repo root pins pnpm, and Corepack refuses yarn there.
const yarnMajor =
  pm === 'yarn'
    ? Number(spawnSync('yarn', ['--version'], { cwd: work, encoding: 'utf-8', shell: SHELL, env: { ...process.env, COREPACK_ENABLE_STRICT: '0' } }).stdout.split('.')[0])
    : undefined;
if (pm === 'yarn' && !(yarnMajor >= 1)) fail('yarn version', 'could not read `yarn --version`');
const yarnBerry = yarnMajor !== undefined && yarnMajor >= 2;
const cliTarball = join(packDir, cliTgz);
const [launcher, launcherArgs] =
  pm === 'pnpm'
    ? ['pnpm', ['dlx', `--package=${cliTarball}`, 'create-nx-archweave', ...cliArgs]]
    : pm === 'bun'
      ? // bunx resolves --package only from an absolute tarball path (measured, bun 1.4.2)
        ['bunx', ['--package', cliTarball, 'create-nx-archweave', ...cliArgs]]
      : yarnBerry && !yarnOnWindows
      ? ['yarn', ['dlx', '-p', cliTarball, 'create-nx-archweave', ...cliArgs]]
      : pm === 'yarn'
        ? ['npm', ['exec', '--yes', `--package=${cliTarball}`, '--', 'create-nx-archweave', ...cliArgs, '--package-manager=yarn']]
        : ['npm', ['exec', '--yes', `--package=${cliTarball}`, '--', 'create-nx-archweave', ...cliArgs]];
// CREATE_NX_ARCHWEAVE_TIMINGS makes the CLI print how long each of its plan steps took, so the
// step log can show which part of the create run is slow (create-nx-workspace, an install, a generator).
const { output: createOutput } = run('create workspace', launcher, launcherArgs, { cwd: work, env: { ...process.env, CREATE_NX_ARCHWEAVE_TIMINGS: '1' } });
const planTimings = createOutput.slice(createOutput.lastIndexOf('Step timings:'));
stepLog.detail(
  'create workspace',
  [...planTimings.matchAll(/^\s+(\d+\.\d)s {2}(\S.*)$/gm)].map((match) => [match[2], Number(match[1]) * 1000]),
);
for (const marker of [
  // the version proves which yarn ran (a yarn-1 runner would pass a bare "yarn" check)
  pm === 'yarn' ? `Package manager: yarn ${yarnMajor}.` : `Package manager: ${pm}`,
  pm === 'yarn' && (!yarnBerry || yarnOnWindows) ? '(--package-manager)' : '(the package manager that ran this command)',
  ...(withBackend ? ['## add-backend', 'cross-side deny rules written'] : []),
  // bun: the last step ran (its note, printed only after it succeeded) and names the way back
  ...(pm === 'bun' ? ['the list above (bun pm untrusted)', 'bun pm trust <package>'] : []),
  'finished successfully',
]) {
  if (!createOutput.includes(marker)) fail('create output markers', `missing "${marker}"`, createOutput);
}
stepLog.record('create output markers');

const demoDir = join(work, demo);

// 3'. the api is a webpack app. Neither @nx/express nor @nx/nest takes a bundler option: both
// pick webpack themselves (24.0.1), while @nx/node's own default moved to tsc/rolldown in Nx 24.
// This catches the day they follow it.
if (withBackend) {
  const apiDir = join(demoDir, 'apps', 'api');
  if (!['js', 'cjs', 'mjs', 'ts'].some((ext) => existsSync(join(apiDir, `webpack.config.${ext}`)))) {
    fail('api bundler', 'apps/api has no webpack.config — the api generators no longer pick webpack', readdirSync(apiDir).join('\n'));
  }
  stepLog.record('api bundler');
}

// 4. workspace registration is real on disk (only the backend flow registers shared-types)
if (!withBackend) {
  // nothing registered without a backend
} else if (/libs\/shared-types\/src\/index\.ts/.test(readFileSync(join(demoDir, 'tsconfig.base.json'), 'utf-8'))) {
  // an integrated layout (Nx's nest preset): libs resolve through tsconfig paths, not packages
} else if (pm === 'pnpm') {
  const yaml = readFileSync(join(demoDir, 'pnpm-workspace.yaml'), 'utf-8');
  if (!yaml.includes('libs/shared-types')) fail('registration', 'pnpm-workspace.yaml lacks libs/shared-types', yaml);
} else {
  const pkg = JSON.parse(readFileSync(join(demoDir, 'package.json'), 'utf-8'));
  const list = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
  if (!list.includes('libs/shared-types')) fail('registration', `workspaces: ${JSON.stringify(pkg.workspaces)}`);
}
if (withBackend) stepLog.record('registration');

// 4'. agent rules: without --ai-hosts the default host is
// Claude Code, so CLAUDE.md carries our marked block — next to Nx's own block, which
// must survive (create-nx-workspace's --aiAgents=claude writes it).
const claudeMd = readFileSync(join(demoDir, 'CLAUDE.md'), 'utf-8');
// The start marker carries a hash of the block (`start hash=<12 hex> -->`), so only its prefix is fixed.
for (const marker of ['<!-- nx-archweave:agent-rules start hash=', '<!-- nx-archweave:agent-rules end -->', '<!-- nx configuration start-->']) {
  if (!claudeMd.includes(marker)) fail('agent rules', `CLAUDE.md lacks "${marker}"`, claudeMd);
}
if (readdirSync(demoDir).some((file) => file.endsWith('.generated.md'))) fail('agent rules', 'a .generated.md file was written');
stepLog.record('agent rules');

// 4''. FSD: add-fsd-lite makes no folders — it wires the
// archweave/fsd-boundaries rule into the frontend app's eslint config (the CLI passes
// --applyEslint). Nothing lands in a workspace-root src/ (it belongs to no project).
let fsdApp = null; // { dir, project } — the app whose config carries the rule
if (frontend !== 'none') {
  if (existsSync(join(demoDir, 'src'))) fail('fsd layers', 'a workspace-root src/ was written');
  const holders = readdirSync(join(demoDir, 'apps')).filter((app) => {
    const config = join(demoDir, 'apps', app, 'eslint.config.mjs');
    return existsSync(config) && readFileSync(config, 'utf-8').includes('@clearlydev/nx-archweave/eslint');
  });
  if (holders.length !== 1) fail('fsd layers', `expected one app whose eslint config imports the FSD rule, found: ${JSON.stringify(holders)}`);
  const dir = join(demoDir, 'apps', holders[0]);
  const manifest = ['package.json', 'project.json'].map((f) => join(dir, f)).find((f) => existsSync(f));
  const project = manifest ? JSON.parse(readFileSync(manifest, 'utf-8')).name : holders[0];
  fsdApp = { dir, project: project ?? holders[0] };
  stepLog.record('fsd layers');
}

// 5. the generated workspace installs and builds green
// --no-frozen-lockfile: add-backend just registered libs/shared-types, so the
// workspace's lockfile is legitimately behind — CI sets CI=true, which would
// otherwise flip pnpm into frozen mode and fail.
// yarn: berry also turns immutable under CI=true; the variable is ignored by classic.
const INSTALL_ARGS = { pnpm: ['install', '--no-frozen-lockfile'], npm: ['install', '--no-audit', '--no-fund'], yarn: ['install'], bun: ['install'] };
run('workspace install', pm, INSTALL_ARGS[pm], {
  cwd: demoDir,
  env: { ...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' },
});
const nxArgs = (rest) => (pm === 'npm' ? ['exec', 'nx', '--', ...rest] : ['nx', ...rest]);

// 5'. express 5 on every path and manager: @nx/express installs it, and Nx 24's @nx/react no
// longer peers on express 4, so the frontend choice can't pull the api back to 4.
if (backend === 'express') {
  const manifest = join(demoDir, 'node_modules', 'express', 'package.json');
  const version = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf-8')).version : undefined;
  if (typeof version !== 'string' || !version.startsWith('5.')) fail('express major', `node_modules/express is ${version ?? 'missing'}, expected 5.x`);
  stepLog.record('express major');
}

// 5a. the slice generators land in the frontend app: a page slice
// (in _pages on Next.js) and a feature with extra segments. The run-many below then covers the
// generated stubs — they lint, typecheck and pass their spec by construction.
if (fsdApp !== null) {
  run('slice generators', pm, nxArgs(['g', '@clearlydev/nx-archweave:page', '--name=e2e-home']), { cwd: demoDir });
  run('slice generators', pm, nxArgs(['g', '@clearlydev/nx-archweave:feature', '--name=e2e-probe', '--segments=ui,api']), { cwd: demoDir });
  stepLog.mergeLast(); // the two runs are one step
  const pagesDir = frontend === 'next' ? '_pages' : 'pages';
  for (const rel of [`src/${pagesDir}/e2e-home/index.ts`, `src/${pagesDir}/e2e-home/model/e2e-home.ts`, 'src/features/e2e-probe/ui/index.ts', 'src/features/e2e-probe/api/index.ts']) {
    if (!existsSync(join(fsdApp.dir, rel))) fail('slice generators', `${rel} is missing`);
  }
  if (frontend === 'next' && existsSync(join(fsdApp.dir, 'src/pages'))) fail('slice generators', 'the page slice landed in src/pages on Next.js');
}

// exit 0 is the contract; the banner text is nx-version-dependent. typecheck and test catch a
// generated project that builds but doesn't typecheck or pass its own tests (Nx's e2e projects
// on TypeScript 6 were one).
run('build+lint', pm, nxArgs(['run-many', '-t', 'build,lint']), { cwd: demoDir });
// typecheck runs after build, never alongside it: in Nx's generated tsconfigs both write to the
// app's dist (tsc --build keeps its .d.ts and tsbuildinfo there while webpack and vite empty it),
// so the two in one run-many can race into TS6305 (reproduced with a plain `run-many -t build
// typecheck` on create-nx-workspace 23.3.0; Nx 24.0.1 still adds the build edge only for libraries
// with a tsconfig.lib.json; related: https://github.com/nrwl/nx/issues/36744).
// bun × next: the web app's jest config transforms with @nx/react/plugins/jest, which bun's
// isolated install doesn't expose at the root (@nx/react only arrives through @nx/next), so its
// test can't start — on create-nx-workspace 23.3.0 too. No Nx issue found (2026-10-25); repro:
// create-nx-workspace@24.0.1 ws --preset=next --pm=bun …, then `bun nx test <web>`. Only that
// test is skipped.
const skipTest = pm === 'bun' && frontend === 'next' && fsdApp !== null ? [`--exclude=${fsdApp.project}`] : [];
if (skipTest.length === 0) {
  run('typecheck+test', pm, nxArgs(['run-many', '-t', 'typecheck,test']), { cwd: demoDir });
} else {
  run('typecheck+test', pm, nxArgs(['run-many', '-t', 'typecheck']), { cwd: demoDir });
  run('typecheck+test', pm, nxArgs(['run-many', '-t', 'test', ...skipTest]), { cwd: demoDir });
  stepLog.mergeLast(); // the two runs are one step
  console.log(`e2e-create: skipped ${fsdApp.project}:test on bun × next (a known Nx issue; see the comment above)`);
}

// 5'. the FSD rule is live: a planted upward import (shared → entities) shows up in the
// app's lint output. The solo preset reports at warn level, so lint still exits 0 — the
// rule name in the output is the signal; the probe is removed afterwards. Next.js's pages
// layer is _pages, but the probe stays on layers whose names are the same everywhere.
if (fsdApp !== null) {
  const probeEntity = join(fsdApp.dir, 'src/entities/probe/index.ts');
  const probeShared = join(fsdApp.dir, 'src/shared/lib/probe.ts');
  mkdirSync(dirname(probeEntity), { recursive: true });
  mkdirSync(dirname(probeShared), { recursive: true });
  writeFileSync(probeEntity, 'export const probe = 1;\n');
  writeFileSync(probeShared, "import { probe } from '../../entities/probe';\nexport const bad = probe;\n");
  try {
    const { output } = run('fsd lint', pm, nxArgs(['lint', fsdApp.project, '--skip-nx-cache']), { cwd: demoDir });
    if (!output.includes('archweave/fsd-boundaries')) fail('fsd lint', 'the planted upward import was not reported', output);
  } finally {
    rmSync(join(fsdApp.dir, 'src/entities/probe'), { recursive: true, force: true });
    rmSync(join(fsdApp.dir, 'src/shared/lib'), { recursive: true, force: true });
  }
}

// 5''. steiger, the official FSD linter, as an opt-in target: the
// generated config and the scaffolded slices must pass it — that is the whole point of
// aligning the scaffold with canonical FSD. insignificant-slice (every fresh slice) is a
// warning in our config, so the run exits 0.
if (fsdApp !== null) {
  const { output: steigerSetup } = run('steiger setup', pm, nxArgs(['g', '@clearlydev/nx-archweave:add-fsd-lite', '--steiger']), { cwd: demoDir });
  if (!steigerSetup.includes('steiger.config.mjs: created')) fail('steiger setup', 'the steiger config was not created', steigerSetup);
  run('steiger install', pm, INSTALL_ARGS[pm], { cwd: demoDir, env: { ...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' } });
  const { output: steigerOut } = run('fsd-check', pm, nxArgs(['run', `${fsdApp.project}:fsd-check`, '--skip-nx-cache']), { cwd: demoDir });
  if (/Found \d+ error/.test(steigerOut)) fail('fsd-check', 'steiger reported errors on the scaffolded workspace', steigerOut);
}

// 6. doctor gate — the same gate the README documents for CI. yarn 1 prints a
// "yarn run v1.x" banner and a "Done in" line on stdout, so the README's yarn-classic
// form adds --silent (berry prints neither and rejects the flag).
const yarnClassic = pm === 'yarn' && !/^__metadata:/m.test(readFileSync(join(demoDir, 'yarn.lock'), 'utf-8'));
const { stdout: doctorStdout, output: doctorCombined } = run(
  'doctor --json',
  pm,
  [...(yarnClassic ? ['--silent'] : []), ...nxArgs(['g', '@clearlydev/nx-archweave:doctor', '--json', '--quiet'])],
  { cwd: demoDir },
);
// stdout ONLY — the README gate pipes stdout, so the test must too.
let report;
try {
  report = JSON.parse(doctorStdout);
} catch {
  fail('doctor --json', 'stdout is not pure parseable JSON', doctorCombined);
}
if (report.schema !== 'archweave/doctor-report@1') fail('doctor --json', `schema: ${report.schema}`);
if (report.overallStatus !== 'safe' && report.overallStatus !== 'manual-review-required') {
  fail('doctor gate', `overallStatus: ${report.overallStatus}`, JSON.stringify(report, null, 2));
}
stepLog.record('doctor gate');

console.log(`\ne2e-create (${pm}, ${frontend}, backend ${backend}) PASSED — ${steps.length} steps: ${steps.join(' → ')}`);
console.log(`\ntimings:\n${stepLog.timings()}`);
stepLog.summarize(`e2e-create (${pm}, ${frontend}, backend ${backend})${SHELL ? ' on Windows' : ''}`);
