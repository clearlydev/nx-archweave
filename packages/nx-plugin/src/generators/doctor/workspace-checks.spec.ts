import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { buildWorkspaceChecks, doctorProjects } from './workspace-checks.ts';

function check(tree: Tree, id: string) {
  return buildWorkspaceChecks(tree).find((c) => c.id === id);
}

function webApp(extra: Record<string, string> = {}): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('web/project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'web/src', tags: ['scope:frontend'] }));
  tree.write('web/next.config.js', 'module.exports = {};\n');
  for (const [path, content] of Object.entries(extra)) tree.write(path, content);
  return tree;
}

describe('doctorProjects', () => {
  it('lists every project with its source root and tags', () => {
    const tree = webApp();
    tree.write('libs/ui/project.json', JSON.stringify({ name: 'ui', projectType: 'library', sourceRoot: 'libs/ui/src', tags: ['scope:shared'] }));
    expect(doctorProjects(tree)).toEqual([
      { name: 'ui', root: 'libs/ui', sourceRoot: 'libs/ui/src', tags: ['scope:shared'] },
      { name: 'web', root: 'web', sourceRoot: 'web/src', tags: ['scope:frontend'] },
    ]);
  });
});

describe('buildWorkspaceChecks', () => {
  it('names the frontend app, its framework and where its layers live', () => {
    const tree = webApp();
    expect(check(tree, 'frontend-resolution')).toMatchObject({ status: 'pass', evidence: ['web'] });
    expect(check(tree, 'frontend-resolution')?.message).toContain('web/src');
    expect(check(tree, 'framework-profile')).toMatchObject({ status: 'pass', message: expect.stringContaining('next') });
  });

  it('two frontends: lists them and how to pick one', () => {
    const tree = webApp();
    tree.write('admin/project.json', JSON.stringify({ name: 'admin', projectType: 'application', sourceRoot: 'admin/src' }));
    expect(check(tree, 'frontend-resolution')).toMatchObject({ status: 'warning', evidence: ['admin', 'web'] });
    expect(check(tree, 'frontend-resolution')?.suggestedAction).toContain('--project');
  });

  it('an unrecognised framework is said out loud', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('web/project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'web/src' }));
    expect(check(tree, 'framework-profile')).toMatchObject({ status: 'warning' });
  });

  it('lists the slice groups it detects', () => {
    const tree = webApp({ 'web/src/features/mypage/order/index.ts': '', 'web/src/features/mypage/claims/index.ts': '', 'web/src/features/login/index.ts': '' });
    expect(check(tree, 'slice-groups')).toMatchObject({ status: 'pass', evidence: ['features/mypage'] });
  });

  it('warns that slice generators skip specs without a test runner', () => {
    expect(check(webApp(), 'test-runner')).toMatchObject({ status: 'warning' });
    expect(check(webApp({ 'jest.config.ts': '' }), 'test-runner')).toMatchObject({ status: 'pass', message: expect.stringContaining('jest') });
  });

  it('suggests sharedPublicApi: file when imports mostly reach inside shared segments', () => {
    const tree = webApp({
      'web/src/features/a/model/a.ts': "import { x } from '@/shared/lib/format/currency';\nimport { y } from '../../../shared/lib/date';\n",
      'web/src/pages/home/ui/home.tsx': "import { b } from '@/shared/ui/button/button';\n",
    });
    expect(check(tree, 'fsd-policy-suggestion')).toMatchObject({ status: 'warning', suggestedAction: expect.stringContaining('"sharedPublicApi": "file"') });
  });

  it('no suggestion when imports go through the segments', () => {
    const tree = webApp({ 'web/src/features/a/model/a.ts': "import { x } from '@/shared/lib';\n" });
    expect(check(tree, 'fsd-policy-suggestion')).toMatchObject({ status: 'pass' });
  });
});

describe('buildWorkspaceChecks — recorded frontends', () => {
  it('two frontends that toolkit.config.json records are no longer a warning', () => {
    const tree = webApp();
    tree.write('admin/project.json', JSON.stringify({ name: 'admin', projectType: 'application', sourceRoot: 'admin/src' }));
    tree.write('toolkit.config.json', JSON.stringify({ frontends: [{ project: 'admin', framework: 'react-vite', sourceRoot: 'admin/src' }, { project: 'web', framework: 'next', sourceRoot: 'web/src' }] }));
    expect(check(tree, 'frontend-resolution')).toMatchObject({ status: 'pass', evidence: ['admin', 'web'] });
  });
});
