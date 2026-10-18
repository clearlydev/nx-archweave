import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { allowBuildsGenerator, runAllowBuilds, type RebuildExec } from './generator.ts';

const WORKSPACE_YAML = ["packages:", "  - 'apps/*'", '', 'autoInstallPeers: true', 'allowBuilds:', '  nx: true', '  sharp: false', ''].join('\n');
const LOCKFILE = ["lockfileVersion: '9.0'", '', 'packages:', '', "  '@swc/core@1.15.8':", '    resolution: {}', '', '  nx@23.2.0:', '    resolution: {}', '', '  sharp@0.34.5:', '    resolution: {}', ''].join('\n');

function pnpmWorkspace(yaml: string | null = WORKSPACE_YAML, lockfile: string | null = LOCKFILE): Tree {
  const tree = createTreeWithEmptyWorkspace();
  if (yaml !== null) tree.write('pnpm-workspace.yaml', yaml);
  if (lockfile !== null) tree.write('pnpm-lock.yaml', lockfile);
  return tree;
}

function recordingExec(status: number | null = 0, error?: Error) {
  const calls: { args: string[]; cwd: string }[] = [];
  const exec: RebuildExec = (args, cwd) => {
    calls.push({ args, cwd });
    return { status, error };
  };
  return { exec, calls };
}

describe('runAllowBuilds', () => {
  const saved = process.env['NX_DRY_RUN'];
  afterEach(() => {
    if (saved === undefined) delete process.env['NX_DRY_RUN'];
    else process.env['NX_DRY_RUN'] = saved;
  });

  it('previews by default: reports the change and the command, writes nothing, returns no callback', () => {
    const tree = pnpmWorkspace();
    const before = tree.read('pnpm-workspace.yaml', 'utf-8');
    const { report, callback } = runAllowBuilds(tree, { packages: ['sharp'] });
    expect(report).toEqual({
      packages: ['sharp'],
      target: 'allowBuilds',
      changes: [{ name: 'sharp', previous: 'denied' }],
      applied: false,
    });
    expect(callback).toBeUndefined();
    expect(tree.read('pnpm-workspace.yaml', 'utf-8')).toBe(before);
  });

  it('with --apply writes the file and returns a callback that runs pnpm rebuild in the workspace root', () => {
    const tree = pnpmWorkspace();
    const { exec, calls } = recordingExec();
    const { report, callback } = runAllowBuilds(tree, { packages: ['sharp', '@swc/core'], apply: true }, { exec });
    expect(report).toMatchObject({ applied: true, changes: [{ previous: 'denied' }, { previous: 'absent' }] });
    expect(tree.read('pnpm-workspace.yaml', 'utf-8')).toBe(WORKSPACE_YAML.replace('  sharp: false\n', "  sharp: true\n  '@swc/core': true\n"));
    // the rebuild runs only once Nx has flushed the file — i.e. in the callback, not before
    expect(calls).toEqual([]);
    callback?.();
    expect(calls).toEqual([{ args: ['rebuild', 'sharp', '@swc/core'], cwd: tree.root }]);
  });

  it('still rebuilds with --apply when every package is already allowed (the file can say true while the build never ran)', () => {
    const tree = pnpmWorkspace();
    const { exec, calls } = recordingExec();
    const { report, callback } = runAllowBuilds(tree, { packages: ['nx'], apply: true }, { exec });
    expect(report).toMatchObject({ applied: true, changes: [{ name: 'nx', previous: 'allowed' }] });
    expect(tree.read('pnpm-workspace.yaml', 'utf-8')).toBe(WORKSPACE_YAML);
    callback?.();
    expect(calls).toEqual([{ args: ['rebuild', 'nx'], cwd: tree.root }]);
  });

  it("Nx's own --dry-run (NX_DRY_RUN=true) beats --apply", () => {
    process.env['NX_DRY_RUN'] = 'true';
    const tree = pnpmWorkspace();
    const before = tree.read('pnpm-workspace.yaml', 'utf-8');
    const { report, callback } = runAllowBuilds(tree, { packages: ['sharp'], apply: true });
    expect(report).toMatchObject({ applied: false });
    expect(callback).toBeUndefined();
    expect(tree.read('pnpm-workspace.yaml', 'utf-8')).toBe(before);
  });

  it('appends to the pnpm 10 onlyBuiltDependencies list create-nx-workspace writes', () => {
    const tree = pnpmWorkspace("packages:\n  - 'apps/*'\nonlyBuiltDependencies:\n  - nx\n");
    const { report } = runAllowBuilds(tree, { packages: ['sharp'], apply: true }, { exec: recordingExec().exec });
    expect(report).toMatchObject({ target: 'onlyBuiltDependencies', changes: [{ name: 'sharp', previous: 'absent' }] });
    expect(tree.read('pnpm-workspace.yaml', 'utf-8')).toBe("packages:\n  - 'apps/*'\nonlyBuiltDependencies:\n  - nx\n  - sharp\n");
  });

  it('adds an allowBuilds block, not a list item, when node_modules says pnpm 11 installed it', () => {
    const tree = pnpmWorkspace("packages:\n  - 'apps/*'\nonlyBuiltDependencies:\n  - nx\n");
    tree.write('node_modules/.modules.yaml', '{\n  "packageManager": "pnpm@11.9.0"\n}\n');
    const { report } = runAllowBuilds(tree, { packages: ['sharp'], apply: true }, { exec: recordingExec().exec });
    expect(report).toMatchObject({ target: 'allowBuilds', changes: [{ name: 'sharp', previous: 'absent' }] });
    expect(tree.read('pnpm-workspace.yaml', 'utf-8')).toBe("packages:\n  - 'apps/*'\nonlyBuiltDependencies:\n  - nx\nallowBuilds:\n  sharp: true\n");
  });

  it('proceeds without a lockfile, and says the names went unchecked', () => {
    const { report } = runAllowBuilds(pnpmWorkspace(WORKSPACE_YAML, null), { packages: ['sharp'] });
    expect(report).toMatchObject({ changes: [{ name: 'sharp', previous: 'denied' }], namesUnchecked: true });
  });

  it('a rebuild that fails throws with the command to run by hand', () => {
    const tree = pnpmWorkspace();
    const { callback } = runAllowBuilds(tree, { packages: ['sharp'], apply: true }, { exec: recordingExec(1).exec });
    expect(() => callback?.()).toThrow(/"pnpm rebuild sharp" exited with 1.*run "pnpm rebuild sharp" yourself/s);
  });

  it('a rebuild that cannot start (pnpm not found) throws with the reason', () => {
    const tree = pnpmWorkspace();
    const { callback } = runAllowBuilds(tree, { packages: ['sharp'], apply: true }, { exec: recordingExec(null, new Error('spawnSync pnpm ENOENT')).exec });
    expect(() => callback?.()).toThrow(/could not start: spawnSync pnpm ENOENT/);
  });

  describe('refusals write nothing and return no callback', () => {
    it.each([
      ['an npm workspace', () => {
        const tree = createTreeWithEmptyWorkspace();
        tree.write('package-lock.json', '{}');
        return tree;
      }, { refused: 'npm' }],
      ['a yarn workspace', () => {
        const tree = createTreeWithEmptyWorkspace();
        tree.write('yarn.lock', '# yarn lockfile v1\n');
        return tree;
      }, { refused: 'yarn' }],
      ['a bun workspace', () => {
        const tree = createTreeWithEmptyWorkspace();
        tree.write('bun.lock', '{}\n');
        return tree;
      }, { refused: 'bun' }],
      ['no package manager detected', () => createTreeWithEmptyWorkspace(), { refused: 'no-package-manager' }],
      ['pnpm without pnpm-workspace.yaml', () => pnpmWorkspace(null), { refused: 'no-workspace-yaml' }],
      ['a name pnpm-lock.yaml does not list', () => pnpmWorkspace(), { refused: 'unknown-packages', unknown: ['sharpp'] }],
      ['a file shape the transform does not recognise', () => pnpmWorkspace('allowBuilds:\n  sharp@0.34.5: false\n'), { refused: 'unrecognized' }],
    ] as const)('%s', (_label, makeTree, expected) => {
      const tree = makeTree();
      const before = tree.listChanges().map((change) => [change.path, change.content?.toString()]);
      const packages = 'unknown' in expected ? ['sharp', 'sharpp'] : ['sharp'];
      const { report, callback } = runAllowBuilds(tree, { packages, apply: true }, { exec: recordingExec().exec });
      expect(report).toMatchObject(expected);
      expect(callback).toBeUndefined();
      expect(tree.listChanges().map((change) => [change.path, change.content?.toString()])).toEqual(before);
    });
  });

  it.each([[[]], [['sharp@0.34.5']], [['foo@file:../foo']], [['x\nallowBuilds:']]])('rejects %j before reading anything', (packages) => {
    const tree = pnpmWorkspace();
    const read = jest.spyOn(tree, 'read');
    const exists = jest.spyOn(tree, 'exists');
    expect(() => runAllowBuilds(tree, { packages })).toThrow(/package name/);
    expect(read).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it('trims and de-duplicates the names', () => {
    const { report } = runAllowBuilds(pnpmWorkspace(), { packages: [' sharp', 'sharp '] });
    expect(report).toMatchObject({ packages: ['sharp'], changes: [{ name: 'sharp' }] });
  });
});

describe('allowBuildsGenerator', () => {
  let logs: string[];
  let spy: jest.SpyInstance;
  beforeEach(() => {
    logs = [];
    spy = jest.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(String(msg));
    });
  });
  afterEach(() => spy.mockRestore());

  it('prints the report and hands Nx the rebuild callback only with --apply', async () => {
    const tree = pnpmWorkspace();
    expect(await allowBuildsGenerator(tree, { packages: ['sharp'] })).toBeUndefined();
    expect(logs.join('\n')).toMatch(/allow-builds — preview/);
    const callback = await allowBuildsGenerator(tree, { packages: ['sharp'], apply: true }, { exec: recordingExec().exec });
    expect(typeof callback).toBe('function');
    expect(logs.join('\n')).toMatch(/allow-builds — applied/);
  });
});
