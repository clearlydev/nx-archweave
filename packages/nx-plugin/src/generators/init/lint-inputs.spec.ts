import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { initGenerator, runInit, type InitDeps } from './generator.ts';
import { renderInitReport } from './render.ts';
import { leftForYou } from './left-for-you.ts';

const CLEAN: InitDeps = { workingTreeChanges: () => [] };
const TOOLKIT = '{workspaceRoot}/toolkit.config.json';

/** A workspace whose lint targets @nx/eslint/plugin infers, with one frontend app. */
function inferredTree(targetName = 'lint'): Tree {
  const tree = createTreeWithEmptyWorkspace();
  const nxJson = JSON.parse(tree.read('nx.json', 'utf-8') as string);
  nxJson.plugins = [{ plugin: '@nx/eslint/plugin', options: { targetName } }];
  tree.write('nx.json', JSON.stringify(nxJson, null, 2));
  tree.write('apps/web/package.json', JSON.stringify({ name: 'web', private: true, nx: { projectType: 'application' } }, null, 2));
  return tree;
}

const nxJson = (tree: Tree) => JSON.parse(tree.read('nx.json', 'utf-8') as string);

describe('runInit — lint inputs in nx.json on a workspace init sets up for the first time', () => {
  it('adds toolkit.config.json after "..." and keeps the other targetDefaults', () => {
    const tree = inferredTree();
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    expect(report.lintInputs).toMatchObject({ action: 'added', target: 'lint' });
    expect(nxJson(tree).targetDefaults).toEqual({ build: { cache: true }, lint: { cache: true, inputs: ['...', TOOLKIT] } });
    expect(report.written?.modified).toContain('nx.json');
  });

  it("follows @nx/eslint/plugin's targetName", () => {
    const tree = inferredTree('eslint');
    runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    expect(nxJson(tree).targetDefaults.eslint).toEqual({ inputs: ['...', TOOLKIT] });
  });

  it('keeps comments in nx.json', () => {
    const tree = inferredTree();
    tree.write('nx.json', tree.read('nx.json', 'utf-8')!.replace('{', '{\n  // the team\'s settings'));
    runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    expect(tree.read('nx.json', 'utf-8')).toContain("// the team's settings");
  });

  it('a dry run reports it and writes nothing', () => {
    const tree = inferredTree();
    const before = tree.read('nx.json', 'utf-8');
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite', dryRun: true }, CLEAN);
    expect(report.lintInputs?.action).toBe('added');
    expect(tree.read('nx.json', 'utf-8')).toBe(before);
    expect(renderInitReport(report)).toContain('would add');
  });

  it('a rerun finds it there and changes nothing', () => {
    const tree = inferredTree();
    runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    const after = tree.read('nx.json', 'utf-8');
    const rerun = runInit(tree, {}, CLEAN);
    expect(rerun.lintInputs?.action).toBe('present');
    expect(tree.read('nx.json', 'utf-8')).toBe(after);
  });
});

describe('runInit — lint inputs: only the snippet, with the reason', () => {
  it('on a workspace init set up before (toolkit.config.json already there)', () => {
    const tree = inferredTree();
    tree.write('toolkit.config.json', JSON.stringify({ preset: 'solo', frontend: 'react-vite' }));
    const before = tree.read('nx.json', 'utf-8');
    const report = runInit(tree, {}, CLEAN);
    expect(report.lintInputs).toMatchObject({ action: 'snippet', reason: 'not-first-run' });
    expect(tree.read('nx.json', 'utf-8')).toBe(before);
    const output = renderInitReport(report);
    expect(output).toContain('"targetDefaults": { "lint": { "inputs": ["...", "{workspaceRoot}/toolkit.config.json"] } }');
    expect(output).toMatch(/Keep "\.\.\."/);
  });

  it('when @nx/eslint/plugin is not registered', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/web/package.json', JSON.stringify({ name: 'web', nx: { projectType: 'application' } }));
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    expect(report.lintInputs).toMatchObject({ action: 'snippet', reason: 'no-plugin' });
    expect(nxJson(tree).targetDefaults.lint.inputs).toBeUndefined();
    // targetDefaults would leave lint targets without the plugin with toolkit.config.json alone
    expect(renderInitReport(report)).not.toContain('"targetDefaults": {');
  });

  it.each([
    ['project.json', 'apps/api/project.json', JSON.stringify({ name: 'api', targets: { lint: { executor: '@nx/eslint:lint' } } })],
    ['package.json nx.targets', 'libs/shared/package.json', JSON.stringify({ name: 'shared', nx: { targets: { lint: { executor: '@nx/eslint:lint' } } } })],
    ['a package.json lint script', 'libs/shared/package.json', JSON.stringify({ name: 'shared', scripts: { lint: 'eslint .' }, nx: {} })],
  ])('when any project writes its own lint target, even a backend or a lib (%s)', (_where, file, content) => {
    const tree = inferredTree();
    tree.write(file, content);
    const before = tree.read('nx.json', 'utf-8');
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    expect(report.lintInputs).toMatchObject({ action: 'snippet', reason: 'own-targets' });
    expect(tree.read('nx.json', 'utf-8')).toBe(before);
    const output = renderInitReport(report);
    expect(output).not.toContain('"targetDefaults": {');
    expect(output).toContain('apps/web/package.json');
    expect(output).toContain('"default", "^default"');
    expect(output).toContain('--skip-nx-cache');
  });

  it.each(['lint', '@nx/eslint:lint'])('when targetDefaults["%s"] already has inputs', (key) => {
    const tree = inferredTree();
    const config = nxJson(tree);
    config.targetDefaults[key] = { inputs: ['default', '^default'] };
    tree.write('nx.json', JSON.stringify(config, null, 2));
    const before = tree.read('nx.json', 'utf-8');
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    expect(report.lintInputs).toMatchObject({ action: 'snippet', reason: 'existing-inputs' });
    expect(tree.read('nx.json', 'utf-8')).toBe(before);
  });

  it('the snippet is a note, not something left for you: --strict still passes', async () => {
    const tree = inferredTree();
    tree.write('apps/api/project.json', JSON.stringify({ name: 'api', targets: { lint: { executor: '@nx/eslint:lint' } } }));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const callback = await initGenerator(tree, { preset: 'solo', frontend: 'react-vite', strict: true }, CLEAN);
    log.mockRestore();
    expect(() => (callback as () => void)()).not.toThrow();
  });
});

describe('runInit — lint inputs only follow the FSD section', () => {
  it('nothing when FSD is off', () => {
    const tree = inferredTree();
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite', fsd: false }, CLEAN);
    expect(report.lintInputs).toBeUndefined();
    expect(nxJson(tree).targetDefaults.lint.inputs).toBeUndefined();
  });

  it('nothing when the FSD section aborted', () => {
    const tree = inferredTree();
    tree.write('apps/admin/package.json', JSON.stringify({ name: 'admin', nx: { projectType: 'application' } }));
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    expect(report.lintInputs).toBeUndefined();
    expect(nxJson(tree).targetDefaults.lint.inputs).toBeUndefined();
  });

  it('nothing in a backend-only workspace', () => {
    const tree = inferredTree();
    tree.delete('apps/web/package.json');
    tree.write('apps/api/package.json', JSON.stringify({ name: 'api', nx: { projectType: 'application' } }));
    const report = runInit(tree, { preset: 'solo', frontend: 'none', backend: 'express' }, CLEAN);
    expect(report.lintInputs).toBeUndefined();
  });

  it('never lists it among what init left for you', () => {
    const tree = inferredTree();
    tree.write('toolkit.config.json', JSON.stringify({ preset: 'solo', frontend: 'react-vite' }));
    const report = runInit(tree, {}, CLEAN);
    expect(leftForYou(report)).toEqual({ kept: [], manual: [] });
  });
});
