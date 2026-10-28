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
//   1. init without --frontend detects Expo, records it, and wires the rule with the platform suffixes
//   2. the layer guide keeps the app layer in app/ (Nx's Expo app has no expo-router)
//   3. the page and feature generators land in the app's source root
//   4. lint: an index.ios.ts slice is a public API (no finding); an upward import is reported
//   5. `doctor --json --quiet` names the framework and reports safe or manual-review-required
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

// 2. the workspace, from Nx's own Expo preset — not from create-nx-archweave
const demo = 'e2e-expo';
const app = 'mobile';
run(
  'create workspace',
  'pnpm',
  ['dlx', `create-nx-workspace@${nxVersion}`, demo, '--preset=expo', `--appName=${app}`, '--e2eTestRunner=none', '--pm=pnpm', '--nxCloud=skip', '--interactive=false'],
  { cwd: work },
);
const demoDir = join(work, demo);
const appDir = join(demoDir, 'apps', app);
const project = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8')).name ?? app;

// 3. the plugin goes in the way a user adds it to a workspace they already have
run('add plugin', 'pnpm', ['add', '-D', '-w', join(packDir, pluginTgz)], { cwd: demoDir });

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

// 7. doctor gate, stdout only (the README's CI gate pipes stdout)
const { stdout: doctorStdout, output: doctorCombined } = run('doctor --json', 'pnpm', ['nx', 'g', '@clearlydev/nx-archweave:doctor', '--json', '--quiet'], { cwd: demoDir });
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

console.log(`\ne2e-existing (${frontend}) PASSED — ${steps.length} steps: ${steps.join(' → ')}`);
console.log(`\ntimings:\n${stepLog.timings()}`);
stepLog.summarize(`e2e-existing (${frontend})`);
