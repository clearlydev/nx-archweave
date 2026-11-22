import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDoctorCheck, type DoctorCheck } from '@nx-archweave/shared';
import { ESLINT_CONFIG_CANDIDATES } from '../backend/eslint-boundaries.ts';
import { lintInputsProjectSnippet, lintInputsTargetDefaultsSnippet, TOOLKIT_CONFIG_INPUT } from '../fsd/lint-cache-inputs.ts';
import { detectWorkspacePackageManager, runNxCommand, type SupportedPackageManager } from '../environment/package-manager.ts';
import { appliedFsdConfigs } from './fsd-enforcement-check.ts';
import { projectPrefix, type DoctorProject } from './doctor-projects.ts';

const ESLINT_PLUGIN = '@nx/eslint/plugin';
const ESLINT_EXECUTOR = '@nx/eslint:lint';

type Json = Record<string, unknown>;
type Input = string | Json;

interface LintSetup {
  /** The lint target's name: @nx/eslint/plugin's targetName, `lint` by default. */
  target: string;
  pluginRegistered: boolean;
  targetDefaults: Json;
  namedInputs: Json;
}

interface OwnLintTarget {
  project: string;
  /** The file the target is written in, relative to the workspace root. */
  file: string;
  executor: string | undefined;
  inputs: Input[] | undefined;
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function readJson(path: string): Json | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readLintSetup(root: string): LintSetup | null {
  const nxJson = readJson(join(root, 'nx.json'));
  if (nxJson === null) return null;
  const plugins = Array.isArray(nxJson['plugins']) ? nxJson['plugins'] : [];
  const entry = plugins.find((plugin) => plugin === ESLINT_PLUGIN || (isObject(plugin) && plugin['plugin'] === ESLINT_PLUGIN));
  const options = isObject(entry) && isObject(entry['options']) ? entry['options'] : {};
  return {
    target: typeof options['targetName'] === 'string' ? options['targetName'] : 'lint',
    pluginRegistered: entry !== undefined,
    targetDefaults: isObject(nxJson['targetDefaults']) ? nxJson['targetDefaults'] : {},
    namedInputs: isObject(nxJson['namedInputs']) ? nxJson['namedInputs'] : {},
  };
}

/** Project roots doctor was given, or the conventional apps/ and libs/ folders (one level) that
 * hold a project.json or package.json. */
function projectList(root: string, projects?: DoctorProject[]): { name: string; root: string }[] {
  if (projects !== undefined) return projects.map((project) => ({ name: project.name, root: project.root }));
  const found: { name: string; root: string }[] = [];
  for (const folder of ['apps', 'libs']) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(root, folder), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const name of entries) {
      const dir = `${folder}/${name}`;
      const config = readJson(join(root, dir, 'project.json')) ?? readJson(join(root, dir, 'package.json'));
      if (config === null) continue;
      found.push({ name: typeof config['name'] === 'string' ? config['name'] : name, root: dir });
    }
  }
  return found;
}

/** The lint target a project writes itself (project.json `targets`, else package.json
 * `nx.targets`, else a package.json script of that name, which Nx runs with nx:run-script), as
 * opposed to one @nx/eslint/plugin infers. Each one takes the inferred target's place. */
function ownLintTarget(root: string, project: { name: string; root: string }, target: string): OwnLintTarget | null {
  const prefix = projectPrefix(project.root);
  const candidates: [string, (config: Json) => unknown][] = [
    [`${prefix}project.json`, (config) => (isObject(config['targets']) ? config['targets'][target] : undefined)],
    [`${prefix}package.json`, (config) => (isObject(config['nx']) && isObject(config['nx']['targets']) ? config['nx']['targets'][target] : undefined)],
  ];
  for (const [file, pick] of candidates) {
    const config = readJson(join(root, file));
    if (config === null) continue;
    const own = pick(config);
    if (!isObject(own)) continue;
    return {
      project: project.name,
      file,
      executor: typeof own['executor'] === 'string' ? own['executor'] : undefined,
      inputs: Array.isArray(own['inputs']) ? (own['inputs'] as Input[]) : undefined,
    };
  }
  const pkg = readJson(join(root, `${prefix}package.json`));
  if (pkg !== null && isObject(pkg['scripts']) && typeof pkg['scripts'][target] === 'string') {
    return { project: project.name, file: `${prefix}package.json`, executor: 'nx:run-script', inputs: undefined };
  }
  return null;
}

/** The project's config file a snippet goes into: project.json when there is one. */
function configFileOf(root: string, projectRoot: string): string {
  const prefix = projectPrefix(projectRoot);
  return existsSync(join(root, `${prefix}project.json`)) ? `${prefix}project.json` : `${prefix}package.json`;
}

function defaultsInputs(setup: LintSetup, executor: string | undefined): Input[] | undefined {
  for (const key of [executor ?? ESLINT_EXECUTOR, setup.target]) {
    const entry = setup.targetDefaults[key];
    if (isObject(entry) && Array.isArray(entry['inputs'])) return entry['inputs'] as Input[];
  }
  return undefined;
}

function carriesToolkitConfig(inputs: Input[], namedInputs: Json): boolean {
  return inputs.some((input) => {
    if (input === TOOLKIT_CONFIG_INPUT) return true;
    if (typeof input !== 'string') return false;
    const named = namedInputs[input.replace(/^\^/, '')];
    return Array.isArray(named) && named.includes(TOOLKIT_CONFIG_INPUT);
  });
}

/** Whether an input list names the project's own files, so it still sees a source change. */
function namesOwnFiles(inputs: Input[]): boolean {
  return inputs.some((input) => typeof input === 'string' && (input === 'default' || input === 'production' || input.startsWith('{projectRoot}')));
}

function eslintConfigNames(root: string, projectRoot: string): string[] {
  const prefix = projectPrefix(projectRoot);
  const own = ESLINT_CONFIG_CANDIDATES.find((name) => existsSync(join(root, `${prefix}${name}`)));
  const workspace = ESLINT_CONFIG_CANDIDATES.find((name) => existsSync(join(root, name)));
  return [
    ...(own === undefined || prefix === '' ? [] : [`{projectRoot}/${own}`]),
    ...(workspace === undefined ? [] : [`{workspaceRoot}/${workspace}`]),
  ];
}

const NOT_READ = 'nx.json could not be read';

/** How a person runs this workspace's nx: its lockfile's package manager, then the one init
 * recorded, else npx nx — the same order the generators' printed commands use. */
function runNxAt(root: string): string {
  const detected = detectWorkspacePackageManager(
    (path) => existsSync(join(root, path)),
    (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf-8') : undefined),
  );
  const recorded = readJson(join(root, 'toolkit.config.json'))?.['packageManager'];
  const known = ['pnpm', 'npm', 'yarn', 'bun'].includes(recorded as string) ? (recorded as SupportedPackageManager) : null;
  return runNxCommand(detected ?? known);
}

/** The FSD rule reads toolkit.config.json, so a project's lint result depends on it. Without it
 * among lint's inputs, Nx can replay a cached result after the fsd policy changed. Always a pass
 * (the workspace still works; `nx lint --skip-nx-cache` checks it): the guidance is the
 * suggested action. */
export function buildLintCacheCheck(root: string, projects?: DoctorProject[]): DoctorCheck {
  const id = 'fsd-lint-cache';
  const label = 'Lint cache sees toolkit.config.json';
  const setup = readLintSetup(root);
  if (setup === null) return createDoctorCheck({ id, label, status: 'not-applicable', message: NOT_READ, evidence: [] });

  const all = projectList(root, projects);
  const fsdRoots = appliedFsdConfigs(root, projects).map((config) => config.replace(/\/?[^/]+$/, ''));
  const fsdProjects = all.filter((project) => fsdRoots.includes(projectPrefix(project.root).replace(/\/$/, '')));
  if (fsdRoots.length === 0) {
    return createDoctorCheck({ id, label, status: 'not-applicable', message: 'no ESLint config wires the FSD rule', evidence: [] });
  }

  // A project at the workspace root already has toolkit.config.json among its own files.
  const missing = fsdProjects.filter((project) => {
    if (projectPrefix(project.root) === '') return false;
    const own = ownLintTarget(root, project, setup.target);
    const inputs = own?.inputs ?? defaultsInputs(setup, own?.executor);
    return inputs === undefined || !carriesToolkitConfig(inputs, setup.namedInputs);
  });
  if (missing.length === 0) {
    return createDoctorCheck({ id, label, status: 'pass', message: "toolkit.config.json is among the FSD projects' lint inputs", evidence: [] });
  }

  // targetDefaults only helps when no project writes its own lint target: "..." would have
  // nothing to keep in one, and the snippet would leave that target with toolkit.config.json alone.
  const ownTargets = all.map((project) => ownLintTarget(root, project, setup.target)).filter((own) => own !== null);
  const lines =
    setup.pluginRegistered && ownTargets.length === 0
      ? lintInputsTargetDefaultsSnippet(setup.target)
      : missing.flatMap((project) => {
          const own = ownLintTarget(root, project, setup.target);
          return lintInputsProjectSnippet({
            file: own?.file ?? configFileOf(root, project.root),
            target: setup.target,
            ownInputs: own?.inputs !== undefined,
            eslintConfigs: eslintConfigNames(root, project.root),
          });
        });
  const runNx = runNxAt(root);
  const skipCache = missing.map((project) => `${runNx} ${setup.target} ${project.name} --skip-nx-cache`).join(', ');
  return createDoctorCheck({
    id,
    label,
    status: 'pass',
    message: 'toolkit.config.json is not among lint\'s inputs: after a change to the fsd policy, Nx can replay a cached lint result',
    evidence: missing.map((project) => project.name),
    suggestedAction: [
      'A workspace init sets up from nx-archweave 0.5.0 on has it already (when its lint targets are inferred).',
      ...lines,
      `Or, after changing the fsd policy, check with: ${skipCache}`,
    ].join('\n    '),
  });
}

/** A "..." anywhere in targetDefaults inputs keeps what the target already has, at that spot. A lint target a
 * project writes itself without inputs has nothing to keep, so its inputs become exactly the
 * other entries — without the project's files, a source change can be served from the cache. */
export function buildLintInputsSpreadCheck(root: string, projects?: DoctorProject[]): DoctorCheck {
  const id = 'lint-inputs-spread';
  const label = 'Lint targets keep their own inputs';
  const setup = readLintSetup(root);
  if (setup === null) return createDoctorCheck({ id, label, status: 'not-applicable', message: NOT_READ, evidence: [] });

  const affected = projectList(root, projects).filter((project) => {
    const own = ownLintTarget(root, project, setup.target);
    if (own === null || own.inputs !== undefined) return false;
    const inputs = defaultsInputs(setup, own.executor);
    return inputs !== undefined && inputs.includes('...') && !namesOwnFiles(inputs);
  });
  if (affected.length === 0) {
    return createDoctorCheck({ id, label, status: 'pass', message: 'no lint target loses its own files to a "..." in targetDefaults', evidence: [] });
  }
  return createDoctorCheck({
    id,
    label,
    status: 'warning',
    message: `targetDefaults gives the ${setup.target} target inputs with "...", but these projects write their own ${setup.target} target without inputs, so "..." has nothing to keep: their lint inputs leave out the project's files, and a source change can come back from the cache`,
    evidence: affected.map((project) => project.name),
    suggestedAction: [
      `Give each of these ${setup.target} targets its own inputs, or list "default" and "^default" in targetDefaults next to "...":`,
      ...affected.map((project) => {
        const own = ownLintTarget(root, project, setup.target);
        const inputs = ['"default"', '"^default"', ...eslintConfigNames(root, project.root).map((name) => `"${name}"`), '{ "externalDependencies": ["eslint"] }'];
        return `${project.name} (${own?.file ?? configFileOf(root, project.root)}): "inputs": [${inputs.join(', ')}]`;
      }),
    ].join('\n    '),
  });
}
