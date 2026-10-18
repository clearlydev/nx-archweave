import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import featureGenerator from './generator.ts';

/** A standalone workspace: the root project is the frontend app, so layers live in src/. */
function appTree(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'src' }));
  return tree;
}

describe('featureGenerator', () => {
  let tree: Tree;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    tree = appTree();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('delegates to the shared slice core fixed to the features layer', async () => {
    tree.write('src/features/index.ts', 'export {};');
    await featureGenerator(tree, { name: 'checkout' });
    expect(tree.exists('src/features/checkout/index.ts')).toBe(true);
    expect(tree.exists('src/features/checkout/model/checkout.spec.ts')).toBe(true);
    expect(tree.exists('src/entities/checkout')).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  });
});
