import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { detectEnvironment } from './detect-environment.ts';
import { join } from 'node:path';

const FIXTURES = join(__dirname, '../../../../tools/fixtures/doctor');

describe('detectEnvironment', () => {
  it('detects an Nx workspace with its nx version and package manager', () => {
    const result = detectEnvironment(join(FIXTURES, 'empty-nx-workspace'));
    expect(result.hasNxWorkspace).toBe(true);
    expect(result.nxVersion).toBe('23.1.0');
    expect(result.packageManager).toBe('pnpm');
  });

  it('reports no Nx workspace for a plain repo', () => {
    const result = detectEnvironment(join(FIXTURES, 'non-nx-repo'));
    expect(result.hasNxWorkspace).toBe(false);
    expect(result.nxVersion).toBeUndefined();
  });

  it('does not throw when root package.json is malformed, and reports the parse error', () => {
    expect(() => detectEnvironment(join(FIXTURES, 'malformed-package-json'))).not.toThrow();
    const result = detectEnvironment(join(FIXTURES, 'malformed-package-json'));
    expect(result.hasNxWorkspace).toBe(true);
    expect(result.nxVersion).toBeUndefined();
    expect(result.rootPackageJsonError).toBeDefined();
  });
});

it('pnpm-workspace.yaml outranks package-lock.json — doctor agrees with the generators in a migration tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'env-mig-'));
  try {
    writeFileSync(join(root, 'nx.json'), '{}\n');
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    writeFileSync(join(root, 'package-lock.json'), '{}\n');
    expect(detectEnvironment(root).packageManager).toBe('pnpm');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([['bun.lock'], ['bun.lockb']])('%s marks bun — doctor uses the generators rule, bun included', (lockfile) => {
  const root = mkdtempSync(join(tmpdir(), 'env-bun-'));
  try {
    writeFileSync(join(root, 'nx.json'), '{}\n');
    writeFileSync(join(root, lockfile), '');
    expect(detectEnvironment(root).packageManager).toBe('bun');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
