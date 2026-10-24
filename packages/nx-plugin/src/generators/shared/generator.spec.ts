import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import sharedGenerator from './generator.ts';

/** A standalone workspace: the root project is the frontend app, so layers live in src/. */
function appTree(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'src' }));
  tree.write('jest.config.ts', 'export default {};\n'); // a test runner, as Nx workspaces have
  return tree;
}

describe('sharedGenerator', () => {
  let tree: Tree;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    tree = appTree();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('delegates to the shared slice core fixed to the shared layer', async () => {
    tree.write('src/shared/index.ts', 'export {};');
    await sharedGenerator(tree, { name: 'date-format' });
    expect(tree.exists('src/shared/date-format/index.ts')).toBe(true);
    expect(tree.exists('src/shared/date-format/date-format.spec.ts')).toBe(true);
    expect(tree.exists('src/features/date-format')).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  });
});
