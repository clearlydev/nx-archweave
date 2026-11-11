import { parseUserAgent, isCliPackageManager, type CliPackageManager } from './package-manager.ts';
import { DEFAULT_PLUGIN_SOURCE, nxGenerateCommand, VALIDATED_CREATE_NX_WORKSPACE_VERSION } from './plan.ts';
import type { CliBackend, CliFrontend, CliLocale, CliPreset } from './types.ts';

/** Where create-nx-archweave was started: a new workspace goes into a new folder, so a
 * directory that already belongs to a project is almost always a mistake — the workspace would
 * land inside that repository as untracked files, its `.github/` would have no effect, and the
 * suggested `git add -A` would stage the outer repository's changes too. */
export type InvocationCheck = { ok: true } | { ok: false; reason: 'git' | 'package'; at: string };

export interface LocationProbe {
  /** The top of the git repository containing `dir`, or null outside one. */
  gitRoot(dir: string): string | null;
  hasPackageJson(dir: string): boolean;
}

/** A package.json counts only in `dir` itself: one further up (a home directory's) says
 * nothing about the folder the workspace goes into. */
export function checkInvocationDirectory(dir: string, probe: LocationProbe): InvocationCheck {
  const gitRoot = probe.gitRoot(dir);
  if (gitRoot !== null) return { ok: false, reason: 'git', at: gitRoot };
  if (probe.hasPackageJson(dir)) return { ok: false, reason: 'package', at: dir };
  return { ok: true };
}

/** How the refused repository installs packages, so the printed commands run there as they are. */
export interface ExistingRepository {
  packageManager: CliPackageManager;
  /** What decided the manager, shown to the user. */
  source: string;
  /** yarn 2 or later (`.yarnrc.yml`, or a `__metadata:` lockfile). */
  yarnBerry: boolean;
  /** The root is a workspace root (`pnpm-workspace.yaml`, or `workspaces` in package.json):
   * pnpm needs `-w` and yarn 1 needs `-W` to add a root dependency there, and pnpm refuses
   * `-w` anywhere else. */
  workspaceRoot: boolean;
}

/** Reads the refused repository: the lockfile first, then package.json's `packageManager`,
 * then `--package-manager`, then the manager that launched the CLI, else npm. `readFile` is
 * relative to the repository root and returns undefined for a missing file. */
export function readExistingRepository(
  readFile: (name: string) => string | undefined,
  flag: string | undefined,
  userAgent: string | undefined,
): ExistingRepository {
  const packageJson = parsePackageJson(readFile('package.json'));
  const lockfiles: [string, CliPackageManager][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];
  let resolved: { packageManager: CliPackageManager; source: string } | undefined;
  for (const [file, manager] of lockfiles) {
    if (readFile(file) !== undefined) {
      resolved = { packageManager: manager, source: `from ${file}` };
      break;
    }
  }
  const field = typeof packageJson?.['packageManager'] === 'string' ? packageJson['packageManager'].split('@')[0] : undefined;
  if (resolved === undefined && field !== undefined && isCliPackageManager(field)) {
    resolved = { packageManager: field, source: "from package.json's packageManager" };
  }
  if (resolved === undefined && flag !== undefined && isCliPackageManager(flag)) {
    resolved = { packageManager: flag, source: 'from --package-manager' };
  }
  const launcher = parseUserAgent(userAgent)?.name;
  if (resolved === undefined && launcher !== undefined && isCliPackageManager(launcher)) {
    resolved = { packageManager: launcher, source: 'the manager that started create-nx-archweave' };
  }
  resolved ??= { packageManager: 'npm', source: 'no lockfile found' };
  return {
    ...resolved,
    yarnBerry: readFile('.yarnrc.yml') !== undefined || /^__metadata:/m.test(readFile('yarn.lock') ?? ''),
    workspaceRoot: readFile('pnpm-workspace.yaml') !== undefined || packageJson?.['workspaces'] !== undefined,
  };
}

function parsePackageJson(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The options passed to create-nx-archweave that init takes too. init needs a preset and a
 * frontend when toolkit.config.json records none, so those two always get a value. */
export interface InitOptions {
  preset?: CliPreset | undefined;
  frontend?: CliFrontend | undefined;
  backend?: CliBackend | undefined;
  locale?: CliLocale | undefined;
}

/** solo and generic when not passed: init has no question for either, and generic makes no
 * assumption about the app. The refusal says to change them to fit the repository. */
function initFlags(options: InitOptions): string {
  return [
    `--preset=${options.preset ?? 'solo'}`,
    `--frontend=${options.frontend ?? 'generic'}`,
    ...(options.backend === undefined ? [] : [`--backend=${options.backend}`]),
    ...(options.locale === undefined ? [] : [`--locale=${options.locale}`]),
  ].join(' ');
}

/** The commands that set the repository up with nx-archweave: Nx at the version this CLI
 * validates, the plugin at the version it pairs with, then init as a preview. */
export function existingRepositoryCommands(repo: ExistingRepository, options: InitOptions = {}): string[] {
  const nx = `nx@${VALIDATED_CREATE_NX_WORKSPACE_VERSION}`;
  const plugin = DEFAULT_PLUGIN_SOURCE;
  const pm = repo.packageManager;
  const nxInit =
    pm === 'pnpm'
      ? `pnpm dlx ${nx} init`
      : pm === 'bun'
        ? `bunx ${nx} init`
        : pm === 'yarn' && repo.yarnBerry
          ? `yarn dlx ${nx} init`
          : `npx ${nx} init`; // npm, and yarn 1, which has no dlx
  const addPlugin =
    pm === 'pnpm'
      ? `pnpm add -D${repo.workspaceRoot ? ' -w' : ''} ${plugin}`
      : pm === 'bun'
        ? `bun add -d ${plugin}`
        : pm === 'yarn'
          ? `yarn add -D${!repo.yarnBerry && repo.workspaceRoot ? ' -W' : ''} ${plugin}`
          : `npm install -D ${plugin}`;
  return [nxInit, addPlugin, `${nxGenerateCommand(pm)} @clearlydev/nx-archweave:init ${initFlags(options)} --dryRun`];
}

export function renderLocationRefusal(
  check: Extract<InvocationCheck, { ok: false }>,
  repo: ExistingRepository,
  options: InitOptions = {},
): string {
  const where = check.reason === 'git' ? `${check.at} is a git repository` : `${check.at} has a package.json`;
  return [
    `create-nx-archweave makes a new workspace in a new folder, but ${where}.`,
    `To set up this repository with nx-archweave instead, run these in ${check.at} (${repo.packageManager}, ${repo.source}):`,
    ...existingRepositoryCommands(repo, options).map((command) => `  ${command}`),
    ...(options.preset === undefined || options.frontend === undefined
      ? ['Change --preset and --frontend to fit the repository (presets: quick-start, solo, team; frontends: react-vite, next, expo, generic, none).']
      : []),
    'The last command only previews the changes. To apply them, commit what the first two commands changed (init needs a clean working tree), then run it again without --dryRun.',
    'To create a separate workspace, run create-nx-archweave from a folder outside it.',
    'To nest a workspace here anyway, pass --allow-nested.',
  ].join('\n');
}
