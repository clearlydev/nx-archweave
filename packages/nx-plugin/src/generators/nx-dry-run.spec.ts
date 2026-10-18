import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { initGenerator } from './init/generator.ts';
import { addFsdLiteGenerator } from './add-fsd-lite/generator.ts';
import { addAgentRulesGenerator } from './add-agent-rules/generator.ts';
import { addGithubTemplatesGenerator } from './add-github-templates/generator.ts';
import { addReviewGenerator } from './add-review/generator.ts';
import { addBackendGenerator } from './add-backend/generator.ts';
import { pageGenerator } from './page/generator.ts';
import { widgetGenerator } from './widget/generator.ts';
import { featureGenerator } from './feature/generator.ts';
import { entityGenerator } from './entity/generator.ts';
import { sharedGenerator } from './shared/generator.ts';
import { allowBuildsGenerator } from './allow-builds/generator.ts';

/**
 * `nx g` deletes a generator's `dryRun` / `dry-run` option before the generator runs
 * (Nx 23.1 generate.js) and refills the schema default, then signals its own --dry-run
 * only through NX_DRY_RUN=true. Every Nx entry point below must therefore read the env:
 * otherwise `nx g … --dry-run` prints "created" instead of the preview (and init's
 * clean-tree check runs against a tree Nx will never flush).
 */
// slice generators need their layer root to get past the refusal and onto the preview path
// a standalone workspace: the root project is the frontend app the FSD generators target
const withApp = (tree: Tree) => tree.write('project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'src' }));
const withLayer = (layer: string) => (tree: Tree) => {
  withApp(tree);
  tree.write(`src/${layer}/index.ts`, 'export {};\n');
};

// allow-builds needs a pnpm workspace that lists the package to get onto the preview path
const withPnpm = (tree: Tree) => {
  tree.write('pnpm-workspace.yaml', 'allowBuilds:\n  sharp: false\n');
  tree.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n\npackages:\n\n  sharp@0.34.5:\n    resolution: {}\n");
};

// every row has four cells: a shorter row would make jest read the 4th parameter as a `done` callback
const noop = () => undefined;
const ENTRIES: [string, (tree: Tree) => Promise<unknown>, RegExp, (tree: Tree) => void][] = [
  ['init', (tree) => initGenerator(tree, { preset: 'solo', frontend: 'react-vite' }), /— dry run/, noop],
  ['add-fsd-lite', (tree) => addFsdLiteGenerator(tree, { frontend: 'react-vite' }), /add-fsd-lite dry-run/, withApp],
  ['add-agent-rules', (tree) => addAgentRulesGenerator(tree, {}), /add-agent-rules dry-run/, noop],
  ['add-github-templates', (tree) => addGithubTemplatesGenerator(tree, {}), /add-github-templates dry-run/, noop],
  ['add-review', (tree) => addReviewGenerator(tree, {}), /add-review dry-run/, noop],
  ['add-backend', (tree) => addBackendGenerator(tree, { backend: 'express' }), /add-backend \(express\) — dry run/, noop],
  ['page', (tree) => pageGenerator(tree, { name: 'home' }), /dry-run — no files were written/, withApp],
  ['widget', (tree) => widgetGenerator(tree, { name: 'header' }), /dry-run — no files were written/, withApp],
  ['feature', (tree) => featureGenerator(tree, { name: 'cart' }), /dry-run — no files were written/, withLayer('features')],
  ['entity', (tree) => entityGenerator(tree, { name: 'user' }), /dry-run — no files were written/, withLayer('entities')],
  ['shared', (tree) => sharedGenerator(tree, { name: 'ui' }), /dry-run — no files were written/, withLayer('shared')],
  // approves with --apply rather than dryRun, so this row passes --apply: Nx's --dry-run must still win
  ['allow-builds', (tree) => allowBuildsGenerator(tree, { packages: ['sharp'], apply: true }), /allow-builds — preview/, withPnpm],
];

/** Registered generators that are deliberately NOT in ENTRIES: they write nothing through
 * the Tree, or approve a real run with `--apply` and carry their own NX_DRY_RUN override
 * (pinned by integration-approval-flag.spec.ts). Any other generator added to
 * generators.json must join ENTRIES, or the guard below fails. */
const NOT_TREE_WRITERS = ['doctor', 'add-integration', 'install-integration', 'record-integration'];

describe("Nx entry points honour Nx's --dry-run (NX_DRY_RUN=true) even though nx g strips the dryRun option", () => {
  const saved = process.env['NX_DRY_RUN'];
  let tree: Tree;
  let logs: string[];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    process.env['NX_DRY_RUN'] = 'true';
    tree = createTreeWithEmptyWorkspace();
    logs = [];
    spy = jest.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(String(msg));
    });
  });
  afterEach(() => {
    spy.mockRestore();
    if (saved === undefined) delete process.env['NX_DRY_RUN'];
    else process.env['NX_DRY_RUN'] = saved;
  });

  it.each(ENTRIES)('%s: prints its dry-run report and writes nothing, with the option stripped', async (_name, run, marker, prepare) => {
    prepare(tree);
    const before = tree.listChanges().length;
    // what the generator actually receives from nx g: no dryRun key at all (or the schema default false)
    await run(tree);
    expect(logs.join('\n')).toMatch(marker);
    expect(tree.listChanges().length).toBe(before);
  });

  it('init: the dry run never invokes the clean-tree check (a tree Nx will not flush has nothing to protect)', async () => {
    // would refuse the run if it were consulted — so "not refused" below is the check being skipped, not passing
    const isWorkingTreeClean = jest.fn<boolean, [string]>().mockReturnValue(false);
    await initGenerator(tree, { preset: 'solo', frontend: 'react-vite' }, { isWorkingTreeClean });
    expect(isWorkingTreeClean).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/— dry run/);
    expect(logs.join('\n')).not.toMatch(/Refused/);
  });

  it('covers every Tree-writing generator registered in generators.json', () => {
    const registered = Object.keys(
      JSON.parse(readFileSync(join(__dirname, '../../generators.json'), 'utf-8')).generators as Record<string, unknown>,
    );
    const expected = registered.filter((name) => !NOT_TREE_WRITERS.includes(name)).sort();
    expect(ENTRIES.map(([name]) => name).sort()).toEqual(expected);
    for (const name of NOT_TREE_WRITERS) expect(registered).toContain(name);
  });
});
