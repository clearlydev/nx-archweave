import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import widgetGenerator from './generator.ts';

/** A standalone workspace: the root project is the frontend app, so layers live in src/. */
function appTree(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'src' }));
  tree.write('jest.config.ts', 'export default {};\n'); // a test runner, as Nx workspaces have
  return tree;
}

describe('widgetGenerator', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('delegates to the shared slice core fixed to the widgets layer', async () => {
    const tree = appTree();
    await widgetGenerator(tree, { name: 'header', segments: ['ui'] });
    expect(tree.exists('src/widgets/header/index.ts')).toBe(true);
    expect(tree.exists('src/widgets/header/model/header.spec.ts')).toBe(true);
    expect(tree.exists('src/widgets/header/ui/index.ts')).toBe(true);
    expect(tree.exists('src/features/header')).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  });
});
