import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import pageGenerator from './generator.ts';

/** A standalone workspace: the root project is the frontend app, so layers live in src/. */
function appTree(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'src' }));
  tree.write('jest.config.ts', 'export default {};\n'); // a test runner, as Nx workspaces have
  return tree;
}

describe('pageGenerator', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('delegates to the shared slice core fixed to the pages layer', async () => {
    const tree = appTree();
    await pageGenerator(tree, { name: 'home', segments: ['ui'] });
    expect(tree.exists('src/pages/home/index.ts')).toBe(true);
    expect(tree.exists('src/pages/home/model/home.spec.ts')).toBe(true);
    expect(tree.exists('src/pages/home/ui/index.ts')).toBe(true);
    expect(tree.exists('src/features/home')).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  });

  it('puts the slice in _pages when the app is Next.js (recorded frontend, or a next.config file)', async () => {
    const recorded = appTree();
    recorded.write('toolkit.config.json', JSON.stringify({ frontend: 'next' }));
    await pageGenerator(recorded, { name: 'home' });
    expect(recorded.exists('src/_pages/home/index.ts')).toBe(true);
    expect(recorded.exists('src/pages')).toBe(false);

    const detected = appTree();
    detected.write('next.config.mjs', 'export default {};\n');
    await pageGenerator(detected, { name: 'home' });
    expect(detected.exists('src/_pages/home/index.ts')).toBe(true);

    const explicit = appTree();
    explicit.write('toolkit.config.json', JSON.stringify({ frontend: 'next' }));
    await pageGenerator(explicit, { name: 'home', frontend: 'react-vite' });
    expect(explicit.exists('src/pages/home/index.ts')).toBe(true);
  });
});
