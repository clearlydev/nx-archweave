import { detectWorkspacePackageManager, detectYarnFlavor, packageManagerCommands } from './package-manager.ts';

const existsIn = (files: string[]) => (p: string) => files.includes(p);

describe('detectWorkspacePackageManager', () => {
  it('pnpm-lock.yaml wins, even when package-lock.json coexists (migration in progress)', () => {
    expect(detectWorkspacePackageManager(existsIn(['pnpm-lock.yaml', 'package-lock.json']))).toBe('pnpm');
  });

  it('pnpm-workspace.yaml marks pnpm on a fresh tree without a lockfile', () => {
    expect(detectWorkspacePackageManager(existsIn(['pnpm-workspace.yaml']))).toBe('pnpm');
  });

  it('package-lock.json alone marks npm', () => {
    expect(detectWorkspacePackageManager(existsIn(['package-lock.json']))).toBe('npm');
  });

  it('yarn.lock alone marks yarn', () => {
    expect(detectWorkspacePackageManager(existsIn(['yarn.lock']))).toBe('yarn');
  });

  it('yarn.lock and package-lock.json together: packageManager decides, else npm (a stray yarn.lock never flips an npm repo)', () => {
    const both = existsIn(['yarn.lock', 'package-lock.json']);
    expect(detectWorkspacePackageManager(both)).toBe('npm');
    expect(detectWorkspacePackageManager(both, () => '{ "name": "x" }')).toBe('npm');
    expect(detectWorkspacePackageManager(both, (p) => (p === 'package.json' ? '{ "packageManager": "yarn@4.18.1" }' : undefined))).toBe('yarn');
    expect(detectWorkspacePackageManager(both, (p) => (p === 'package.json' ? '{ "packageManager": "npm@11.6.2" }' : undefined))).toBe('npm');
  });

  it('pnpm markers still outrank yarn.lock', () => {
    expect(detectWorkspacePackageManager(existsIn(['pnpm-lock.yaml', 'yarn.lock']))).toBe('pnpm');
  });

  it('bun.lock (text, bun 1.2+) or bun.lockb (binary, older bun) alone marks bun', () => {
    expect(detectWorkspacePackageManager(existsIn(['bun.lock']))).toBe('bun');
    expect(detectWorkspacePackageManager(existsIn(['bun.lockb']))).toBe('bun');
  });

  it('bun.lock next to another lockfile: packageManager decides, else npm, else yarn — a stray bun.lock never flips a repo', () => {
    const pkg = (field: string) => (p: string) => (p === 'package.json' ? `{ "packageManager": "${field}" }` : undefined);
    expect(detectWorkspacePackageManager(existsIn(['bun.lock', 'package-lock.json']))).toBe('npm');
    expect(detectWorkspacePackageManager(existsIn(['bun.lock', 'package-lock.json']), pkg('bun@1.4.2'))).toBe('bun');
    expect(detectWorkspacePackageManager(existsIn(['bun.lock', 'yarn.lock']))).toBe('yarn');
    expect(detectWorkspacePackageManager(existsIn(['bun.lockb', 'yarn.lock']), pkg('bun@1.1.0'))).toBe('bun');
    // a packageManager naming a manager whose lockfile is absent decides nothing
    expect(detectWorkspacePackageManager(existsIn(['bun.lock', 'package-lock.json']), pkg('yarn@4.18.1'))).toBe('npm');
  });

  it('pnpm markers outrank bun lockfiles', () => {
    expect(detectWorkspacePackageManager(existsIn(['pnpm-workspace.yaml', 'bun.lock']))).toBe('pnpm');
  });

  it('no marker at all detects as null — callers degrade', () => {
    expect(detectWorkspacePackageManager(existsIn([]))).toBeNull();
  });
});

describe('detectYarnFlavor', () => {
  const read = (files: Record<string, string>) => (p: string) => files[p];

  it('berry when .yarnrc.yml exists (create-nx-workspace writes nodeLinker there)', () => {
    expect(detectYarnFlavor(existsIn(['.yarnrc.yml', 'yarn.lock']), read({}))).toBe('berry');
  });

  it('berry when yarn.lock has the __metadata block, even without .yarnrc.yml', () => {
    expect(detectYarnFlavor(existsIn(['yarn.lock']), read({ 'yarn.lock': '# This file is generated\n\n__metadata:\n  version: 8\n' }))).toBe('berry');
  });

  it('berry from a packageManager field alone (lockfile not generated or gitignored); yarn@1 stays classic', () => {
    const pkg = (version: string) => read({ 'package.json': `{ "packageManager": "yarn@${version}" }` });
    expect(detectYarnFlavor(existsIn([]), pkg('4.18.1'))).toBe('berry');
    expect(detectYarnFlavor(existsIn([]), pkg('1.22.22'))).toBe('classic');
  });

  it('classic for a v1 lockfile, and when there is nothing to read', () => {
    expect(detectYarnFlavor(existsIn(['yarn.lock']), read({ 'yarn.lock': '# yarn lockfile v1\n\n"a@^1":\n  version "1.0.0"\n' }))).toBe('classic');
    expect(detectYarnFlavor(existsIn([]), read({}))).toBe('classic');
  });
});

describe('packageManagerCommands', () => {
  it.each([
    ['npm', undefined, 'npm install -D x', 'npm install x', 'npm exec nx --', 'npm install', 'package.json workspaces'],
    ['pnpm', undefined, 'pnpm add -D -w x', 'pnpm add -w x', 'pnpm nx', 'pnpm install', 'pnpm-workspace.yaml'],
    ['yarn', 'classic', 'yarn add -D -W x', 'yarn add -W x', 'yarn nx', 'yarn install', 'package.json workspaces'],
    ['yarn', 'berry', 'yarn add -D x', 'yarn add x', 'yarn nx', 'yarn install', 'package.json workspaces'],
    ['bun', undefined, 'bun add -d x', 'bun add x', 'bun nx', 'bun install', 'package.json workspaces'],
  ] as const)('%s %s', (pm, flavor, addDev, add, runNx, install, registration) => {
    const commands = packageManagerCommands(pm, flavor);
    expect(commands.addDevAtRoot('x')).toBe(addDev);
    expect(commands.addAtRoot('x')).toBe(add);
    expect(commands.runNx).toBe(runNx);
    expect(commands.install).toBe(install);
    expect(commands.workspaceRegistration).toBe(registration);
  });

  it('yarn with an unknown flavor renders the classic form — berry is only assumed when a .yarnrc.yml or __metadata says so', () => {
    expect(packageManagerCommands('yarn').addDevAtRoot('x')).toBe('yarn add -D -W x');
  });
});
