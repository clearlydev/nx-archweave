import {
  checkInvocationDirectory,
  existingRepositoryCommands,
  readExistingRepository,
  renderLocationRefusal,
  type ExistingRepository,
} from './location-check.ts';
import { DEFAULT_PLUGIN_SOURCE, VALIDATED_CREATE_NX_WORKSPACE_VERSION } from './plan.ts';

const probe = (gitRoot: string | null, packageJsonHere: boolean) => ({
  gitRoot: () => gitRoot,
  hasPackageJson: () => packageJsonHere,
});

describe('checkInvocationDirectory', () => {
  it('a plain directory is fine', () => {
    expect(checkInvocationDirectory('/tmp/new', probe(null, false))).toEqual({ ok: true });
  });

  it('inside a git repository it refuses, naming the repository', () => {
    expect(checkInvocationDirectory('/repo/apps', probe('/repo', false))).toEqual({ ok: false, reason: 'git', at: '/repo' });
  });

  it('in a directory with a package.json it refuses', () => {
    expect(checkInvocationDirectory('/proj', probe(null, true))).toEqual({ ok: false, reason: 'package', at: '/proj' });
  });
});

/** A repository with these files (name → content). */
const files =
  (entries: Record<string, string>) =>
  (name: string): string | undefined =>
    entries[name];

const repo = (overrides: Partial<ExistingRepository> = {}): ExistingRepository => ({
  packageManager: 'npm',
  source: 'from package-lock.json',
  yarnBerry: false,
  workspaceRoot: false,
  ...overrides,
});

describe('readExistingRepository', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ] as const)('takes the manager from %s', (lockfile, manager) => {
    const found = readExistingRepository(files({ 'package.json': '{}', [lockfile]: '' }), undefined, undefined);
    expect(found.packageManager).toBe(manager);
    expect(found.source).toBe(`from ${lockfile}`);
  });

  it("the lockfile wins over package.json's packageManager, the flag and the launching manager", () => {
    const found = readExistingRepository(
      files({ 'package.json': '{"packageManager":"yarn@4.9.0"}', 'pnpm-lock.yaml': '' }),
      'bun',
      'npm/10.9.4 node/v22.18.0',
    );
    expect(found.packageManager).toBe('pnpm');
  });

  it("without a lockfile: package.json's packageManager, then --package-manager, then the launching manager, else npm", () => {
    expect(readExistingRepository(files({ 'package.json': '{"packageManager":"pnpm@11.9.0"}' }), 'bun', 'npm/10').packageManager).toBe('pnpm');
    expect(readExistingRepository(files({ 'package.json': '{}' }), 'bun', 'pnpm/11.9.0 npm/? node/v22').packageManager).toBe('bun');
    expect(readExistingRepository(files({ 'package.json': '{}' }), undefined, 'pnpm/11.9.0 npm/? node/v22')).toMatchObject({
      packageManager: 'pnpm',
      source: 'the manager that started create-nx-archweave',
    });
    expect(readExistingRepository(files({}), undefined, undefined)).toMatchObject({ packageManager: 'npm', source: 'no lockfile found' });
  });

  it('ignores a packageManager it does not support, and a package.json it cannot parse', () => {
    expect(readExistingRepository(files({ 'package.json': '{"packageManager":"deno@2.0.0"}' }), undefined, undefined).packageManager).toBe('npm');
    expect(readExistingRepository(files({ 'package.json': '{not json' }), undefined, undefined).packageManager).toBe('npm');
  });

  it('tells yarn 2+ from yarn 1, and a workspace root from a single package', () => {
    expect(readExistingRepository(files({ 'yarn.lock': '__metadata:\n  version: 8\n' }), undefined, undefined).yarnBerry).toBe(true);
    expect(readExistingRepository(files({ 'yarn.lock': '# yarn lockfile v1\n', '.yarnrc.yml': '' }), undefined, undefined).yarnBerry).toBe(true);
    expect(readExistingRepository(files({ 'yarn.lock': '# yarn lockfile v1\n' }), undefined, undefined).yarnBerry).toBe(false);
    expect(readExistingRepository(files({ 'pnpm-workspace.yaml': '', 'pnpm-lock.yaml': '' }), undefined, undefined).workspaceRoot).toBe(true);
    expect(readExistingRepository(files({ 'package.json': '{"workspaces":["packages/*"]}' }), undefined, undefined).workspaceRoot).toBe(true);
    expect(readExistingRepository(files({ 'package.json': '{}', 'pnpm-lock.yaml': '' }), undefined, undefined).workspaceRoot).toBe(false);
  });
});

describe('existingRepositoryCommands', () => {
  const nx = `nx@${VALIDATED_CREATE_NX_WORKSPACE_VERSION}`;
  const plugin = DEFAULT_PLUGIN_SOURCE;

  it('uses the Nx version the CLI validates and the plugin range it pairs with', () => {
    expect(VALIDATED_CREATE_NX_WORKSPACE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(plugin).toMatch(/^@clearlydev\/nx-archweave@\^\d+\.\d+\.\d+/);
  });

  it.each<[string, Partial<ExistingRepository>, string[]]>([
    ['npm', { packageManager: 'npm' }, [`npx ${nx} init`, `npm install -D ${plugin}`, 'npm exec nx -- g @clearlydev/nx-archweave:init --preset=solo --frontend=generic --dryRun']],
    ['pnpm, single package (no -w)', { packageManager: 'pnpm' }, [`pnpm dlx ${nx} init`, `pnpm add -D ${plugin}`, 'pnpm nx g @clearlydev/nx-archweave:init --preset=solo --frontend=generic --dryRun']],
    ['pnpm, workspace root', { packageManager: 'pnpm', workspaceRoot: true }, [`pnpm dlx ${nx} init`, `pnpm add -D -w ${plugin}`, 'pnpm nx g @clearlydev/nx-archweave:init --preset=solo --frontend=generic --dryRun']],
    ['yarn 2+', { packageManager: 'yarn', yarnBerry: true, workspaceRoot: true }, [`yarn dlx ${nx} init`, `yarn add -D ${plugin}`, 'yarn nx g @clearlydev/nx-archweave:init --preset=solo --frontend=generic --dryRun']],
    ['yarn 1, single package', { packageManager: 'yarn' }, [`npx ${nx} init`, `yarn add -D ${plugin}`, 'yarn nx g @clearlydev/nx-archweave:init --preset=solo --frontend=generic --dryRun']],
    ['yarn 1, workspace root', { packageManager: 'yarn', workspaceRoot: true }, [`npx ${nx} init`, `yarn add -D -W ${plugin}`, 'yarn nx g @clearlydev/nx-archweave:init --preset=solo --frontend=generic --dryRun']],
    ['bun', { packageManager: 'bun' }, [`bunx ${nx} init`, `bun add -d ${plugin}`, 'bun nx g @clearlydev/nx-archweave:init --preset=solo --frontend=generic --dryRun']],
  ])('%s', (_name, overrides, expected) => {
    expect(existingRepositoryCommands(repo(overrides))).toEqual(expected);
  });
});

describe('existingRepositoryCommands init options', () => {
  it('passes on the preset, frontend, backend and locale given to create-nx-archweave', () => {
    const [, , init] = existingRepositoryCommands(repo({ packageManager: 'pnpm' }), { preset: 'team', frontend: 'react-vite', backend: 'none', locale: 'ko' });
    expect(init).toBe('pnpm nx g @clearlydev/nx-archweave:init --preset=team --frontend=react-vite --backend=none --locale=ko --dryRun');
  });

  it('leaves out the backend and locale when they were not given', () => {
    const [, , init] = existingRepositoryCommands(repo({ packageManager: 'pnpm' }), { preset: 'quick-start', frontend: 'next' });
    expect(init).toBe('pnpm nx g @clearlydev/nx-archweave:init --preset=quick-start --frontend=next --dryRun');
  });

  it('drops the "change --preset and --frontend" line once both were given', () => {
    const text = renderLocationRefusal({ ok: false, reason: 'git', at: '/repo' }, repo(), { preset: 'solo', frontend: 'react-vite' });
    expect(text).not.toContain('Change --preset and --frontend');
  });
});

describe('renderLocationRefusal', () => {
  it('names the repository, the manager and why, the three commands, and the flag that overrides', () => {
    const text = renderLocationRefusal({ ok: false, reason: 'git', at: '/repo' }, repo({ packageManager: 'pnpm', source: 'from pnpm-lock.yaml' }));
    expect(text).toContain('/repo is a git repository');
    expect(text).toContain('run these in /repo (pnpm, from pnpm-lock.yaml):');
    expect(text).toContain(`  pnpm dlx nx@${VALIDATED_CREATE_NX_WORKSPACE_VERSION} init`);
    expect(text).toContain(`  pnpm add -D ${DEFAULT_PLUGIN_SOURCE}`);
    expect(text).toContain('  pnpm nx g @clearlydev/nx-archweave:init --preset=solo --frontend=generic --dryRun');
    expect(text).toContain('Change --preset and --frontend to fit the repository');
    expect(text).toContain('commit what the first two commands changed (init needs a clean working tree), then run it again without --dryRun');
    expect(text).toContain('--allow-nested');
    expect(text).not.toContain('nx@latest');
  });

  it('a folder with a package.json says so', () => {
    expect(renderLocationRefusal({ ok: false, reason: 'package', at: '/proj' }, repo())).toContain('/proj has a package.json');
  });
});
