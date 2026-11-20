import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInit, type InitDeps } from './generator.ts';
import { runAddGithubTemplates } from '../add-github-templates/generator.ts';
import { doctorGenerator } from '../doctor/generator.ts';

// A workspace set up by 0.4.x as solo — whose default was review on — and given the full
// template set as well, then rerun with the current init. doctor reads the workspace from
// disk, so every file the tree holds is written to a temporary directory before it runs.

const CLEAN: InitDeps = { isWorkingTreeClean: () => true };

function writeTreeTo(tree: Tree, dir: string): void {
  for (const change of tree.listChanges()) {
    if (change.type === 'DELETE' || change.content === null) continue;
    const path = join(dir, change.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, change.content);
  }
}

async function doctorJson(tree: Tree): Promise<{ overallStatus: string; checks: unknown[] }> {
  const lines: string[] = [];
  const spy = jest.spyOn(console, 'log').mockImplementation((message: string) => void lines.push(String(message)));
  try {
    await doctorGenerator(tree, { json: true });
  } finally {
    spy.mockRestore();
  }
  const report = JSON.parse(lines.join('\n')) as { overallStatus: string; checks: unknown[] };
  return { overallStatus: report.overallStatus, checks: report.checks };
}

describe('init rerun on a workspace an earlier version set up as solo', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'archweave-solo-rerun-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the review setup and every template byte for byte, and doctor reports the same before and after', async () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/web/package.json', JSON.stringify({ name: 'web', private: true, nx: { projectType: 'application' } }, null, 2));
    runInit(tree, { preset: 'solo', frontend: 'react-vite', review: true }, CLEAN);
    runAddGithubTemplates(tree, { issue: true, pr: true, codeowners: true });
    (tree as unknown as { root: string }).root = dir;
    writeTreeTo(tree, dir);

    const kept = [
      '.github/workflows/claude-code-review.yml',
      '.github/dependabot.yml',
      'toolkit.config.json',
      '.github/PULL_REQUEST_TEMPLATE.md',
      '.github/ISSUE_TEMPLATE/bug-report.yml',
      '.github/ISSUE_TEMPLATE/feature-request.yml',
      '.github/CODEOWNERS',
    ];
    const before = Object.fromEntries(kept.map((path) => [path, tree.read(path, 'utf-8')]));
    for (const path of kept) expect(before[path]).not.toBeNull();
    const doctorBefore = await doctorJson(tree);

    runInit(tree, {}, CLEAN);
    writeTreeTo(tree, dir);

    for (const path of kept) expect(tree.read(path, 'utf-8')).toBe(before[path]);
    expect(await doctorJson(tree)).toEqual(doctorBefore);
  });
});
