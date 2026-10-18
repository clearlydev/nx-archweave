import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initGenerator } from './generator.ts';

// These tests point a Tree's `root` at a REAL directory purely so the generator's real
// `isWorkingTreeClean` wiring shells out to real `git` — every file read/write still goes
// through the in-memory Tree (createTreeWithEmptyWorkspace's virtual FS), so nothing is
// ever written to disk. `tree.root` is a plain, reassignable property at runtime despite
// its `readonly` TS type (verified against the actual FsTree implementation).

function makeCleanGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nx-archweave-init-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'placeholder\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  return dir;
}

function pointTreeAt(tree: Tree, root: string): void {
  (tree as unknown as { root: string }).root = root;
}

describe('initGenerator — real git wiring', () => {
  let tree: Tree;
  let cleanRepo: string;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    cleanRepo = makeCleanGitRepo();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(cleanRepo, { recursive: true, force: true });
  });

  it('proceeds and returns a GeneratorCallback when the real tree is clean and writes happen', async () => {
    const before = tree.listChanges().length;
    pointTreeAt(tree, cleanRepo);
    const callback = await initGenerator(tree, { preset: 'solo', frontend: 'react-vite' });
    expect(typeof callback).toBe('function');
    expect(tree.listChanges().length).toBeGreaterThan(before);
  });

  it('refuses and writes nothing when the real tree has an untracked file', async () => {
    const before = tree.listChanges().length;
    writeFileSync(join(cleanRepo, 'dirty.txt'), 'uncommitted\n');
    pointTreeAt(tree, cleanRepo);
    const callback = await initGenerator(tree, { preset: 'solo', frontend: 'react-vite' });
    expect(callback).toBeUndefined();
    expect(tree.listChanges().length).toBe(before);
  });

  it('refuses and writes nothing when the real tree has a staged, uncommitted change', async () => {
    const before = tree.listChanges().length;
    writeFileSync(join(cleanRepo, 'README.md'), 'changed\n');
    execFileSync('git', ['add', '.'], { cwd: cleanRepo });
    pointTreeAt(tree, cleanRepo);
    const callback = await initGenerator(tree, { preset: 'team', frontend: 'next' });
    expect(callback).toBeUndefined();
    expect(tree.listChanges().length).toBe(before);
  });

  it('does not return a callback when every toggle is off and nothing is written, even on a clean tree', async () => {
    const before = tree.listChanges().length;
    pointTreeAt(tree, cleanRepo);
    const callback = await initGenerator(tree, {
      preset: 'quick-start',
      frontend: 'react-vite',
      fsd: false,
      agentRules: false,
      githubTemplates: false,
      review: false,
    });
    expect(callback).toBeUndefined();
    expect(tree.listChanges().length).toBe(before);
  });
});
