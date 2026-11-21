#!/usr/bin/env node
// E2E for a workspace nx-archweave did not create: Nx's own generator makes the workspace, then
// the packed plugin is added and init detects the framework on its own. It covers what the
// create flow cannot reach — today Expo, which create-nx-archweave does not offer.
//
//   node tools/e2e-existing.mjs --frontend=expo [--mode=pr]
//
// Modes (same hybrid gate as e2e-create.mjs):
//   (default, strict)  every failure exits 1.
//   --mode=pr          UPSTREAM failures (create-nx-workspace, the workspace's own install)
//                      exit 0 with a ::warning::; OUR failures (pack, plugin install, init,
//                      the generated files, lint, doctor) still exit 1.
//
// pnpm only: the package manager is not what this covers (e2e-create.mjs runs all four).
// Asserts:
//   0. init on the tree the plugin install dirtied is refused: it names the files and exits non-zero
//   1. init without --frontend detects Expo, records it, and wires the rule with the platform suffixes
//      and puts toolkit.config.json in lint's inputs after "..." (default kept)
//   2. the layer guide keeps the app layer in app/ (Nx's Expo app has no expo-router)
//   3. the page and feature generators land in the app's source root
//   4. lint: an index.ios.ts slice is a public API (no finding); an upward import is reported
//   5. `doctor --json --quiet` names the framework and reports safe or manual-review-required
//   6. targetDefaults lint inputs with "...": kept on an inferred target, nothing to keep on an own
//      target (with the plugin or without); doctor's lint-inputs-spread names that project
//      (and a package.json lint script, which takes the inferred target's place)
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
  console.error(`e2e-existing: unsupported --mode "${mode}" (strict|pr)`);
  process.exit(2);
}
const extraArgs = process.argv.slice(2).filter((a) => !a.startsWith('--mode=') && !a.startsWith('--frontend='));
if (extraArgs.length > 0) {
  console.error(`e2e-existing: unknown arguments: ${extraArgs.join(' ')} (accepted: --frontend=expo, --mode=strict|pr)`);
  process.exit(2);
}
const frontendArg = process.argv.find((a) => a.startsWith('--frontend='));
const frontend = frontendArg ? frontendArg.slice('--frontend='.length) : 'expo';
if (frontend !== 'expo') {
  console.error(`e2e-existing: unsupported --frontend "${frontend}" (expo)`);
  process.exit(2);
}

// The create-nx-workspace version the create CLI is validated against, so both e2e scripts
// build on the same Nx.
const planSource = readFileSync(join(repoRoot, 'packages/create-nx-archweave/src/cli/plan.ts'), 'utf-8');
const nxVersion = /VALIDATED_CREATE_NX_WORKSPACE_VERSION = '([^']+)'/.exec(planSource)?.[1];
if (!nxVersion) {
  console.error('e2e-existing: VALIDATED_CREATE_NX_WORKSPACE_VERSION not found in plan.ts');
  process.exit(2);
}

const MAX_BUFFER = 64 * 1024 * 1024;
const UPSTREAM_STEPS = ['create workspace'];
const stepLog = createStepLog();
const steps = stepLog.names;
function fail(step, detail, output) {
  if (UPSTREAM_STEPS.includes(step) && mode === 'pr') {
    console.log(`::warning title=e2e-existing (${frontend}): upstream drift at "${step}"::${(detail ?? '').replace(/\n/g, ' ')} — not blocking this PR; the manual strict CI run reports it as a failure.`);
    console.error(`\ne2e-existing (${frontend}) UPSTREAM failure at: ${step} (pr mode → green)`);
    if (output) console.error(`\n--- captured output (tail) ---\n${output.slice(-4000)}`);
    process.exit(0);
  }
  console.error(`\ne2e-existing FAILED at: ${step}`);
  if (detail) console.error(`  ${detail}`);
  if (output) console.error(`\n--- captured output (tail) ---\n${output.slice(-4000)}`);
  console.error(`\ncompleted steps: ${steps.join(' → ') || '(none)'}`);
  if (steps.length > 0) console.error(`\ntimings of the completed steps:\n${stepLog.timings()}`);
  process.exit(1);
}

function run(step, command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf-8', maxBuffer: MAX_BUFFER, ...options });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) fail(step, `${command} ${args.join(' ')} → exit ${result.status}`, output);
  stepLog.record(step);
  return { output, stdout: result.stdout ?? '' };
}

const work = realpathSync.native(mkdtempSync(join(tmpdir(), `e2e-existing-${frontend}-`)));
console.log(`e2e-existing (${frontend}) — working in ${work}`);
process.on('exit', (code) => {
  if (code === 0) rmSync(work, { recursive: true, force: true });
  else console.error(`(left in place for inspection: ${work})`);
});

// 1. pack the plugin (prepack runs the nx bundle)
const packDir = join(work, 'pack');
mkdirSync(packDir, { recursive: true });
run('pack plugin', 'npm', ['pack', '--pack-destination', packDir], { cwd: join(repoRoot, 'packages/nx-plugin') });
const pluginTgz = readdirSync(packDir).find((f) => f.startsWith('clearlydev-nx-archweave-'));
if (!pluginTgz) fail('locate tarball', `found: ${readdirSync(packDir).join(', ')}`);

// 2. the workspace, from Nx's own Expo preset — not from create-nx-archweave. A git identity
// lets create-nx-workspace make its initial commit, as it does on a developer's machine (a CI
// runner has none configured).
const demo = 'e2e-expo';
const app = 'mobile';
const gitIdentity = { GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@example.com', GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@example.com' };
run(
  'create workspace',
  'pnpm',
  ['dlx', `create-nx-workspace@${nxVersion}`, demo, '--preset=expo', `--appName=${app}`, '--e2eTestRunner=none', '--pm=pnpm', '--nxCloud=skip', '--interactive=false'],
  { cwd: work, env: { ...process.env, ...gitIdentity } },
);
const demoDir = join(work, demo);
// The refusal check below assumes the workspace starts committed, so the plugin install is the
// only change.
const initialCommit = spawnSync('git', ['log', '--oneline', '-1'], { cwd: demoDir, encoding: 'utf-8' });
const uncommitted = spawnSync('git', ['status', '--porcelain'], { cwd: demoDir, encoding: 'utf-8' });
console.log(`initial commit: ${initialCommit.status === 0 ? initialCommit.stdout.trim() : '(none)'}; uncommitted entries: ${(uncommitted.stdout ?? '').split('\n').filter(Boolean).length}`);
if (initialCommit.status !== 0 || (uncommitted.stdout ?? '').trim() !== '') {
  fail('initial commit', 'create-nx-workspace left the workspace uncommitted even with a git identity', `${initialCommit.stderr ?? ''}${uncommitted.stdout ?? ''}`);
}
const appDir = join(demoDir, 'apps', app);
const project = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8')).name ?? app;

// 3. the plugin goes in the way a user adds it to a workspace they already have
run('add plugin', 'pnpm', ['add', '-D', '-w', join(packDir, pluginTgz)], { cwd: demoDir });

// 3b. init on the tree the plugin install just dirtied: refused, with the files to commit, and
// a non-zero exit whose last line is init's one-line message (Nx adds a stack only with --verbose).
const refusal = spawnSync('pnpm', ['nx', 'g', '@clearlydev/nx-archweave:init', '--preset=solo', '--review=false'], {
  cwd: demoDir,
  encoding: 'utf-8',
  maxBuffer: MAX_BUFFER,
});
const refusalOutput = `${refusal.stdout ?? ''}${refusal.stderr ?? ''}`;
if (refusal.status === 0) fail('init refusal', 'init exited 0 on a dirty tree', refusalOutput);
if (!refusalOutput.includes('git add package.json pnpm-lock.yaml && git commit -m "chore: add @clearlydev/nx-archweave"')) {
  fail('init refusal', 'the refusal does not name the plugin install files', refusalOutput);
}
const refusalLastLine = (refusal.stderr || refusal.stdout || '').trimEnd().split('\n').at(-1) ?? '';
if (!refusalLastLine.includes('init refused: the working tree has uncommitted changes — see the report above.')) {
  fail('init refusal', `the last line is not init's message: ${refusalLastLine}`, refusalOutput);
}
stepLog.record('init refusal');

// 4. init without --frontend: the framework comes from the app (app.json's expo key)
const { output: initOutput } = run(
  'init',
  'pnpm',
  ['nx', 'g', '@clearlydev/nx-archweave:init', '--preset=solo', '--applyEslint=true', '--review=false', '--allowDirty=true'],
  { cwd: demoDir },
);
for (const marker of ['init (preset: solo, frontend: expo)', `apps/${app}/src/app `, `ESLint: archweave/fsd-boundaries (warn) written to apps/${app}/eslint.config.mjs`]) {
  if (!initOutput.includes(marker)) fail('init output', `missing "${marker}"`, initOutput);
}
// Nx's Expo app has no expo-router, so FSD's app layer is app/ itself, never _app/.
if (initOutput.includes('_app')) fail('init output', 'the layer guide moved the app layer to _app/ in an app without expo-router', initOutput);
const eslintConfig = readFileSync(join(appDir, 'eslint.config.mjs'), 'utf-8');
if (!eslintConfig.includes("platformSuffixes: ['ios', 'android', 'native', 'web']")) fail('eslint config', 'the rule lacks the platform suffixes', eslintConfig);
const recorded = JSON.parse(readFileSync(join(demoDir, 'toolkit.config.json'), 'utf-8'));
if (recorded.frontend !== 'expo') fail('toolkit.config.json', `frontend: ${JSON.stringify(recorded.frontend)}`);
stepLog.record('init wiring');

// 4b. init's first run put toolkit.config.json in lint's inputs after "...": the app's lint keeps
// the inferred inputs (default among them) and re-runs when the fsd policy changes.
{
  const { stdout } = run('init lint inputs', 'pnpm', ['--silent', 'nx', 'show', 'project', project, '--json'], { cwd: demoDir });
  const targets = JSON.parse(stdout).targets ?? {};
  const lintTargetName = Object.keys(targets).find((name) => targets[name]?.inputs?.includes('{workspaceRoot}/toolkit.config.json'));
  const inputs = lintTargetName === undefined ? undefined : targets[lintTargetName].inputs;
  console.log(`lint inputs after init: ${JSON.stringify(inputs ?? targets.lint?.inputs)}`);
  if (!Array.isArray(inputs) || !inputs.includes('default')) fail('init lint inputs', `no lint target has both default and toolkit.config.json: ${JSON.stringify(targets.lint?.inputs)}`);
}

// 5. slices land in the app's source root
run('slice generators', 'pnpm', ['nx', 'g', '@clearlydev/nx-archweave:page', '--name=e2e-home'], { cwd: demoDir });
run('slice generators', 'pnpm', ['nx', 'g', '@clearlydev/nx-archweave:feature', '--name=e2e-probe', '--segments=ui,api'], { cwd: demoDir });
stepLog.mergeLast(); // the two runs are one step
for (const rel of ['src/pages/e2e-home/index.ts', 'src/features/e2e-probe/index.ts', 'src/features/e2e-probe/ui/index.ts', 'src/features/e2e-probe/api/index.ts']) {
  if (!existsSync(join(appDir, rel))) fail('slice generators', `${rel} is missing`);
}

// 6. the rule on React Native files. A slice whose only index is index.ios.ts is a public API:
// importing it is clean. Then an upward import (shared → entities) is reported. The solo
// preset reports at warn level, so lint exits 0 — the rule name in the output is the signal.
const write = (rel, text) => {
  mkdirSync(dirname(join(appDir, rel)), { recursive: true });
  writeFileSync(join(appDir, rel), text);
};
write('src/entities/device/index.ios.ts', 'export const device = 1;\n');
write('src/features/e2e-probe/model/device.ts', "import { device } from '../../../entities/device';\nexport const probeDevice = device;\n");
const lint = () => run('fsd lint', 'pnpm', ['nx', 'lint', project, '--skip-nx-cache'], { cwd: demoDir }).output;
const cleanLint = lint();
if (cleanLint.includes('archweave/fsd-boundaries')) fail('fsd lint', 'a slice with only index.ios.ts was not taken as its public API', cleanLint);
write('src/shared/lib/probe.ts', "import { device } from '../../entities/device';\nexport const bad = device;\n");
const upwardLint = lint();
if (!upwardLint.includes('archweave/fsd-boundaries')) fail('fsd lint', 'the planted upward import was not reported', upwardLint);
rmSync(join(appDir, 'src/shared/lib'), { recursive: true, force: true });

// 7. doctor gate, stdout only, run as the docs' CI gate runs it (pnpm --silent)
const { stdout: doctorStdout, output: doctorCombined } = run('doctor --json', 'pnpm', ['--silent', 'nx', 'g', '@clearlydev/nx-archweave:doctor', '--json', '--quiet'], { cwd: demoDir });
let report;
try {
  report = JSON.parse(doctorStdout);
} catch {
  fail('doctor --json', 'stdout is not pure parseable JSON', doctorCombined);
}
if (report.overallStatus !== 'safe' && report.overallStatus !== 'manual-review-required') {
  fail('doctor gate', `overallStatus: ${report.overallStatus}`, JSON.stringify(report, null, 2));
}
const framework = (report.checks ?? []).find((check) => check.id === 'framework-profile');
if (framework?.status !== 'pass' || framework.message !== 'expo') fail('doctor gate', `framework-profile: ${JSON.stringify(framework)}`, JSON.stringify(report, null, 2));
stepLog.record('doctor gate');

// 8. How Nx merges targetDefaults lint inputs that start with "..." (what doctor's snippet and
// its lint-inputs-spread warning rely on). Inferred target: "..." keeps the inferred inputs. A lint
// target the project writes itself has nothing for "..." to keep, with @nx/eslint/plugin
// registered or not: only the other entries are left. Checked on the Nx this workspace runs.
const TOOLKIT_INPUT = '{workspaceRoot}/toolkit.config.json';
const nxJsonPath = join(demoDir, 'nx.json');
const appPackagePath = join(appDir, 'package.json');
const nxJsonText = readFileSync(nxJsonPath, 'utf-8');
const appPackageText = readFileSync(appPackagePath, 'utf-8');
const nxJson = JSON.parse(nxJsonText);
const eslintPlugin = (nxJson.plugins ?? []).find((plugin) => plugin === '@nx/eslint/plugin' || plugin?.plugin === '@nx/eslint/plugin');
if (eslintPlugin === undefined) fail('lint inputs', '@nx/eslint/plugin is not registered in nx.json', nxJsonText);
const lintTarget = eslintPlugin?.options?.targetName ?? 'lint';
const lintInputs = (step) => {
  const { stdout } = run(step, 'pnpm', ['--silent', 'nx', 'show', 'project', project, '--json'], { cwd: demoDir });
  return JSON.parse(stdout).targets?.[lintTarget]?.inputs;
};
const writeNxJson = (withPlugin) => {
  const next = JSON.parse(nxJsonText);
  next.targetDefaults = { ...(next.targetDefaults ?? {}), [lintTarget]: { inputs: ['...', TOOLKIT_INPUT] } };
  if (!withPlugin) next.plugins = next.plugins.filter((plugin) => plugin !== eslintPlugin);
  writeFileSync(nxJsonPath, `${JSON.stringify(next, null, 2)}\n`);
};
const writeOwnLintTarget = () => {
  const pkg = JSON.parse(appPackageText);
  if (pkg.nx?.targets?.[lintTarget] !== undefined) fail('lint inputs', `${project} already writes its own ${lintTarget} target`, appPackageText);
  pkg.nx = { ...(pkg.nx ?? {}), targets: { ...(pkg.nx?.targets ?? {}), [lintTarget]: { executor: '@nx/eslint:lint' } } };
  writeFileSync(appPackagePath, `${JSON.stringify(pkg, null, 2)}\n`);
};

writeNxJson(true);
const inferred = lintInputs('lint inputs: inferred');
console.log(`lint inputs, inferred target + targetDefaults ["...", toolkit.config.json]: ${JSON.stringify(inferred)}`);
if (!Array.isArray(inferred) || !inferred.includes('default') || !inferred.includes(TOOLKIT_INPUT)) {
  fail('lint inputs', `"..." did not keep the inferred inputs: ${JSON.stringify(inferred)}`);
}

writeOwnLintTarget();
const ownWithPlugin = lintInputs('lint inputs: own target, plugin registered');
console.log(`lint inputs, own target + plugin + targetDefaults: ${JSON.stringify(ownWithPlugin)}`);
writeNxJson(false);
const ownWithoutPlugin = lintInputs('lint inputs: own target, no plugin');
console.log(`lint inputs, own target, no plugin + targetDefaults: ${JSON.stringify(ownWithoutPlugin)}`);
for (const [label, inputs] of [['with the plugin', ownWithPlugin], ['without the plugin', ownWithoutPlugin]]) {
  if (JSON.stringify(inputs) !== JSON.stringify([TOOLKIT_INPUT])) {
    fail('lint inputs', `an own lint target (${label}) kept other inputs than Nx 23.3.1 did (only toolkit.config.json): ${JSON.stringify(inputs)}`);
  }
}

// doctor names the project whose own lint target lost its files (plugin registered again)
writeNxJson(true);
const { stdout: spreadStdout } = run('doctor: lint-inputs-spread', 'pnpm', ['--silent', 'nx', 'g', '@clearlydev/nx-archweave:doctor', '--json', '--quiet'], { cwd: demoDir });
const spread = (JSON.parse(spreadStdout).checks ?? []).find((check) => check.id === 'lint-inputs-spread');
if (spread?.status !== 'warning' || !spread.evidence.includes(project)) fail('doctor: lint-inputs-spread', JSON.stringify(spread), spreadStdout);

// A package.json lint script (nx:run-script) next to the inferred target takes its place, with
// only toolkit.config.json as inputs (Nx 24.0.1): init and doctor count it as an own lint target.
writeFileSync(appPackagePath, appPackageText);
{
  const pkg = JSON.parse(appPackageText);
  if (pkg.scripts?.[lintTarget] === undefined) {
    pkg.scripts = { ...(pkg.scripts ?? {}), [lintTarget]: 'eslint .' };
    writeFileSync(appPackagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  const { stdout } = run('lint inputs: lint script', 'pnpm', ['--silent', 'nx', 'show', 'project', project, '--json'], { cwd: demoDir });
  const shown = JSON.parse(stdout).targets?.[lintTarget];
  const summary = JSON.stringify({ executor: shown?.executor, command: shown?.options?.command, script: shown?.options?.script, inputs: shown?.inputs });
  console.log(`lint inputs, lint script + plugin + targetDefaults: ${summary}`);
  if (shown?.executor !== 'nx:run-script' || JSON.stringify(shown?.inputs) !== JSON.stringify([TOOLKIT_INPUT])) {
    fail(
      'lint inputs: lint script',
      `expected nx:run-script with inputs ["${TOOLKIT_INPUT}"] only, got ${summary}. If Nx changed this, revisit doctor's lint-script check (lint-inputs-spread) and init's lint input conditions.`,
    );
  }
}

writeFileSync(nxJsonPath, nxJsonText);
writeFileSync(appPackagePath, appPackageText);
stepLog.record('lint inputs');

console.log(`\ne2e-existing (${frontend}) PASSED — ${steps.length} steps: ${steps.join(' → ')}`);
console.log(`\ntimings:\n${stepLog.timings()}`);
stepLog.summarize(`e2e-existing (${frontend})`);
