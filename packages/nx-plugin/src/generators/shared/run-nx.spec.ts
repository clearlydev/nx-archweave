import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diskRunNx } from './run-nx.ts';

describe('diskRunNx', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'run-nx-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    ['pnpm-lock.yaml', 'pnpm nx'],
    ['package-lock.json', 'npm exec nx --'],
    ['yarn.lock', 'yarn nx'],
    ['bun.lock', 'bun nx'],
  ])('%s → %s', (lockfile, runNx) => {
    writeFileSync(join(dir, lockfile), '');
    expect(diskRunNx(dir)).toBe(runNx);
  });

  it('no lockfile: the package manager init recorded, else pnpm', () => {
    writeFileSync(join(dir, 'toolkit.config.json'), '{ "packageManager": "yarn" }');
    expect(diskRunNx(dir)).toBe('yarn nx');
    writeFileSync(join(dir, 'package-lock.json'), '');
    expect(diskRunNx(dir)).toBe('npm exec nx --'); // a lockfile wins over the record
  });

  it('no lockfile and nothing recorded: pnpm, like the other generators', () => {
    expect(diskRunNx(dir)).toBe('pnpm nx');
  });
});
