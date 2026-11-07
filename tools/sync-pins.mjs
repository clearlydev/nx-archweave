#!/usr/bin/env node
// Brings the generated review workflows up to the action pins in
// .github/workflows/pinned-actions.yml.
//
// Dependabot reads only workflow files, so its update pull requests change
// pinned-actions.yml and nothing else. Run this on the Dependabot branch:
//   1. copies each changed `uses:` value into
//      packages/template-engine/src/review/action-pins.ts
//   2. regenerates the doctor fixtures that hold a current workflow
//      (tools/fixtures/doctor/*-matches-workflow)
//   3. updates the provider workflow snapshots (pnpm nx test, provider specs only)
// Then review `git diff` and run the gate.
//
// Usage: node tools/sync-pins.mjs [--verify] [--check] [--no-snapshots]
//   --verify        before writing, check with the GitHub API (`gh api`) that each changed
//                   pin's version tag points at its SHA, following an annotated tag to its
//                   commit; any mismatch or failed lookup stops it with nothing written
//   --check         change nothing; exit 1 if the two files differ
//   --no-snapshots  skip step 3
//
// It refuses to guess: an action listed in only one of the two files, a value
// that isn't `<owner>/<repo>@<40-hex sha> # <version>`, or an action listed
// twice stops it before anything is written.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/pinned-actions.yml';
const PINS = 'packages/template-engine/src/review/action-pins.ts';
const PIN_VALUE = /^([\w.-]+\/[\w.-]+)@[0-9a-f]{40} # \S+$/;

// The doctor fixtures whose workflow must equal what the generator writes today.
const FIXTURES = [
  { dir: 'review-config-matches-workflow', file: 'claude-code-review.yml', packageManager: 'pnpm' },
  { dir: 'review-gemini-matches-workflow', file: 'gemini-code-review.yml', packageManager: 'pnpm' },
  { dir: 'review-npm-matches-workflow', file: 'claude-code-review.yml', packageManager: 'npm' },
];

const args = new Set(process.argv.slice(2));

if (args.has('--fixtures-only')) {
  await regenerateFixtures();
  process.exit(0);
}

function fail(message) {
  console.error(`sync-pins: ${message}`);
  process.exit(1);
}

function read(file) {
  return readFileSync(path.join(workspaceRoot, file), 'utf-8');
}

/** action → pinned value, from one file's lines; refuses duplicates and malformed values. */
function collect(file, lines) {
  const pins = new Map();
  for (const value of lines) {
    const match = PIN_VALUE.exec(value);
    if (!match) fail(`${file}: "${value}" is not <owner>/<repo>@<40-hex sha> # <version>`);
    if (pins.has(match[1])) fail(`${file}: ${match[1]} is listed twice`);
    pins.set(match[1], value);
  }
  return pins;
}

const workflowPins = collect(
  WORKFLOW,
  read(WORKFLOW)
    .split('\n')
    .map((line) => /^\s*(?:- )?uses: (.+)$/.exec(line)?.[1].trim())
    .filter((value) => value !== undefined),
);

const pinsSource = read(PINS);
const PIN_LINE = /^(\s*)'([\w.-]+\/[\w.-]+)': '([^']+)',$/;
const sourcePins = collect(
  PINS,
  pinsSource
    .split('\n')
    .map((line) => PIN_LINE.exec(line)?.[3])
    .filter((value) => value !== undefined),
);

const onlyInWorkflow = [...workflowPins.keys()].filter((action) => !sourcePins.has(action));
const onlyInSource = [...sourcePins.keys()].filter((action) => !workflowPins.has(action));
if (onlyInWorkflow.length > 0 || onlyInSource.length > 0) {
  fail(
    [
      'the two files list different actions, so this is not a version update:',
      ...onlyInWorkflow.map((action) => `  only in ${WORKFLOW}: ${action}`),
      ...onlyInSource.map((action) => `  only in ${PINS}: ${action}`),
      'Add or remove the action in both files by hand.',
    ].join('\n'),
  );
}

const changed = [...workflowPins].filter(([action, value]) => sourcePins.get(action) !== value);

if (args.has('--verify') && changed.length > 0) {
  const problems = changed.map(([, value]) => verifyPin(value)).filter((problem) => problem !== undefined);
  if (problems.length > 0) fail([...problems, 'Nothing was written.'].join('\n'));
  for (const [, value] of changed) {
    const { repo, sha, version } = parsePin(value);
    console.log(`sync-pins: verified ${repo} ${version} -> ${sha}`);
  }
}

if (args.has('--check')) {
  if (changed.length === 0) {
    console.log('sync-pins: action-pins.ts matches pinned-actions.yml');
    process.exit(0);
  }
  for (const [action, value] of changed) console.log(`  ${action}: ${sourcePins.get(action)} -> ${value}`);
  fail('action-pins.ts differs from pinned-actions.yml; run node tools/sync-pins.mjs');
}

if (changed.length === 0) {
  console.log('sync-pins: action-pins.ts already matches pinned-actions.yml; nothing to do');
  process.exit(0);
}

const updated = pinsSource
  .split('\n')
  .map((line) => {
    const match = PIN_LINE.exec(line);
    if (!match || !workflowPins.has(match[2])) return line;
    return `${match[1]}'${match[2]}': '${workflowPins.get(match[2])}',`;
  })
  .join('\n');
writeFileSync(path.join(workspaceRoot, PINS), updated);
for (const [action, value] of changed) console.log(`sync-pins: ${action} -> ${value.slice(value.indexOf('@') + 1)}`);

// The fixtures render through the TypeScript sources, which only the
// @nx-archweave/source export condition resolves, so they run in a child node.
const fixtures = spawnSync(
  process.execPath,
  ['--conditions=@nx-archweave/source', fileURLToPath(import.meta.url), '--fixtures-only'],
  { cwd: workspaceRoot, stdio: 'inherit' },
);
if (fixtures.status !== 0) fail('regenerating the doctor fixtures failed');

if (args.has('--no-snapshots')) {
  console.log('sync-pins: skipped the snapshots; update them with:');
  console.log('  pnpm nx test @nx-archweave/template-engine --skip-nx-cache -- --ci=false -u --testPathPatterns=provider.spec');
} else {
  const snapshots = spawnSync(
    'pnpm',
    ['nx', 'test', '@nx-archweave/template-engine', '--skip-nx-cache', '--output-style=static', '--', '--ci=false', '-u', '--testPathPatterns=provider.spec'],
    { cwd: workspaceRoot, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (snapshots.status !== 0) fail('updating the provider snapshots failed');
}

if (!args.has('--verify')) {
  console.log('sync-pins: the new pins were NOT checked against their version tags. Check each one:');
  for (const [, value] of changed) {
    const { repo, sha, version } = parsePin(value);
    console.log(`  gh api repos/${repo}/git/ref/tags/${version} --jq .object   # expect ${sha}`);
  }
  console.log('  (an object of type "tag" is an annotated tag: gh api repos/<owner>/<repo>/git/tags/<its sha> --jq .object)');
  console.log('  Next time, run pnpm sync-pins --verify to do this before anything is written.');
}
console.log('sync-pins: done. Check that `git diff` changes only the pinned lines, then run the gate:');
console.log('  pnpm nx run-many -t build,test,lint,typecheck,bundle');

/** `owner/repo`, the 40-hex SHA and the version tag of a pin value already checked by PIN_VALUE. */
function parsePin(value) {
  const [uses, version] = value.split(' # ');
  const [repo, sha] = uses.split('@');
  return { repo, sha, version };
}

/** One GitHub API read through the gh CLI: the parsed body, or why it failed. */
function ghApi(endpoint) {
  const result = spawnSync('gh', ['api', endpoint], { encoding: 'utf-8' });
  if (result.error) return { failure: `could not run gh (${result.error.code ?? result.error.message}); install the GitHub CLI and sign in with gh auth login` };
  if (result.status === 0) return { body: JSON.parse(result.stdout) };
  const output = `${result.stderr}`.trim();
  if (/HTTP 404/.test(output)) return { failure: 'not found', notFound: true };
  if (/HTTP \d{3}/.test(output)) return { failure: output.split('\n').pop() };
  return { failure: `could not reach the GitHub API, so nothing could be verified (${output.split('\n').pop() || `gh exited ${result.status}`}). Check the network and gh auth status, then run it again` };
}

/** Follows the version tag to its commit; returns a problem line, or undefined when the tag points at the pinned SHA. */
function verifyPin(value) {
  const { repo, sha, version } = parsePin(value);
  const label = `${repo} ${version}`;
  const ref = ghApi(`repos/${repo}/git/ref/tags/${version}`);
  if (ref.notFound) return `${label}: the tag ${version} does not exist in ${repo}`;
  if (ref.failure) return `${label}: ${ref.failure}`;
  let object = ref.body.object;
  // An annotated tag points at a tag object; follow it (and any tag it points at) to the commit.
  for (let depth = 0; object?.type === 'tag' && depth < 5; depth++) {
    const tag = ghApi(`repos/${repo}/git/tags/${object.sha}`);
    if (tag.failure) return `${label}: reading the annotated tag ${object.sha}: ${tag.failure}`;
    object = tag.body.object;
  }
  if (object?.type !== 'commit') return `${label}: the tag does not lead to a commit (${object?.type ?? 'nothing'})`;
  if (object.sha !== sha) return `${label}: the tag points at ${object.sha}, but the pin says ${sha}`;
  return undefined;
}

async function regenerateFixtures() {
  const provider = pathToFileURL(path.join(workspaceRoot, 'packages/template-engine/src/review/provider.ts')).href;
  const { REVIEW_PROVIDERS } = await import(provider);
  for (const fixture of FIXTURES) {
    const base = path.join(workspaceRoot, 'tools/fixtures/doctor', fixture.dir);
    const { review } = JSON.parse(readFileSync(path.join(base, 'toolkit.config.json'), 'utf-8'));
    const yaml = REVIEW_PROVIDERS[review.provider].buildWorkflowYaml({
      mode: review.mode,
      locale: review.locale,
      maxRounds: review.maxRounds,
      packageManager: fixture.packageManager,
    });
    writeFileSync(path.join(base, '.github/workflows', fixture.file), yaml);
    console.log(`sync-pins: regenerated tools/fixtures/doctor/${fixture.dir}`);
  }
}
