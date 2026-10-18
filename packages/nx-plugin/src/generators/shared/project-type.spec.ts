import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { resolveProjectType } from './project-type.ts';

/** Mirrors Nx 23's project-graph inference (nx core normalize-project-nodes
 * getProjectType) for projects that declare no projectType. */
describe('resolveProjectType', () => {
  it('a declared projectType always wins over the files', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/web/tsconfig.app.json', '{}');
    expect(resolveProjectType(tree, 'apps/web', 'library')).toBe('library');
    tree.write('libs/ui/tsconfig.lib.json', '{}');
    expect(resolveProjectType(tree, 'libs/ui', 'application')).toBe('application');
  });

  it('tsconfig.lib.json means library, even next to a tsconfig.app.json', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('libs/ui/tsconfig.lib.json', '{}');
    tree.write('libs/ui/tsconfig.app.json', '{}');
    expect(resolveProjectType(tree, 'libs/ui', undefined)).toBe('library');
  });

  it('tsconfig.app.json means application, even when package.json has entry points', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/web/tsconfig.app.json', '{}');
    tree.write('apps/web/package.json', JSON.stringify({ name: '@org/web', main: './index.js' }));
    expect(resolveProjectType(tree, 'apps/web', undefined)).toBe('application');
  });

  it('a package.json without exports/main/module/bin means application; with any of them, library', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/e2e/package.json', JSON.stringify({ name: '@org/e2e', private: true }));
    expect(resolveProjectType(tree, 'apps/e2e', undefined)).toBe('application');
    for (const key of ['exports', 'main', 'module', 'bin']) {
      tree.write(`packages/${key}/package.json`, JSON.stringify({ name: key, [key]: './x.js' }));
      expect(resolveProjectType(tree, `packages/${key}`, undefined)).toBe('library');
    }
  });

  it('a falsy entry point does not count (truthiness, like Nx)', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/web/package.json', JSON.stringify({ name: 'web', main: '' }));
    expect(resolveProjectType(tree, 'apps/web', undefined)).toBe('application');
  });

  it('no tsconfig and no package.json, or an unparseable one, means library (the graph falls through)', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/bare/project.json', '{}');
    expect(resolveProjectType(tree, 'apps/bare', undefined)).toBe('library');
    tree.write('apps/broken/package.json', '{ nope');
    expect(resolveProjectType(tree, 'apps/broken', undefined)).toBe('library');
  });

  it('any declared value other than library counts as application, as in Nx', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('libs/x/tsconfig.lib.json', '{}');
    expect(resolveProjectType(tree, 'libs/x', 'app')).toBe('application');
  });

  it('reads package.json the way Nx does — comments and trailing commas are fine', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/web/package.json', '{\n  // generated\n  "name": "web",\n}\n');
    expect(resolveProjectType(tree, 'apps/web', undefined)).toBe('application');
  });

  it("resolves the workspace root's files for root '' and '.'", () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('tsconfig.app.json', '{}');
    expect(resolveProjectType(tree, '.', undefined)).toBe('application');
    expect(resolveProjectType(tree, '', undefined)).toBe('application');
  });
});
