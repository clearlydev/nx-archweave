import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import entityGenerator from './generator.ts';

/** A standalone workspace: the root project is the frontend app, so layers live in src/. */
function appTree(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'src' }));
  return tree;
}

describe('entityGenerator', () => {
  let tree: Tree;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    tree = appTree();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('delegates to the shared slice core fixed to the entities layer', async () => {
    tree.write('src/entities/index.ts', 'export {};');
    await entityGenerator(tree, { name: 'user' });
    expect(tree.exists('src/entities/user/index.ts')).toBe(true);
    expect(tree.exists('src/entities/user/model/user.spec.ts')).toBe(true);
    expect(tree.exists('src/features/user')).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  });
});
