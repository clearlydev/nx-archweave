import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { resolveFrontendApp } from './frontend-app.ts';

/** A plain Next.js repository after `nx init`: the root package.json gained `"nx": {}`. */
function nxInitNext(layout: 'app-at-root' | 'src-app'): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('package.json', JSON.stringify({ name: 'my-next-app', private: true, nx: {}, dependencies: { next: '15.0.0', react: '19.0.0' } }, null, 2));
  tree.write('next.config.mjs', 'export default {};\n');
  tree.write(layout === 'app-at-root' ? 'app/page.tsx' : 'src/app/page.tsx', 'export default function Page() { return null; }\n');
  return tree;
}

describe('resolveFrontendApp — a root project', () => {
  it('finds the app nx init made of a Next.js repository (routes at the root: layers go in src/)', () => {
    expect(resolveFrontendApp(nxInitNext('app-at-root'), undefined)).toMatchObject({ kind: 'found', project: 'my-next-app', root: '.', sourceRoot: 'src', framework: 'next' });
  });

  it('finds it with src/app too', () => {
    expect(resolveFrontendApp(nxInitNext('src-app'), undefined)).toMatchObject({ kind: 'found', project: 'my-next-app', sourceRoot: 'src' });
  });

  it('a root package.json Nx does not list as a project still counts when it is a recognised app', () => {
    const tree = nxInitNext('src-app');
    tree.write('package.json', JSON.stringify({ name: 'my-next-app', private: true, dependencies: { next: '15.0.0' } }));
    expect(resolveFrontendApp(tree, undefined)).toMatchObject({ kind: 'found', project: 'my-next-app', root: '.', inferredRoot: true });
  });

  it('a root package.json without a recognised framework is still not a frontend', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('package.json', JSON.stringify({ name: 'tooling', private: true, nx: {} }));
    expect(resolveFrontendApp(tree, undefined).kind).toBe('none');
  });
});

describe('resolveFrontendApp — where the layers go', () => {
  it('a sourceRoot equal to the project root uses its src/ when the app has one', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('web/project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'web' }));
    tree.write('web/src/app/page.tsx', '');
    expect(resolveFrontendApp(tree, undefined)).toMatchObject({ kind: 'found', sourceRoot: 'web/src' });
  });

  it('…and the project root itself when it has none', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('web/project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'web' }));
    tree.write('web/features/a/index.ts', '');
    expect(resolveFrontendApp(tree, undefined)).toMatchObject({ kind: 'found', sourceRoot: 'web' });
  });
});

describe('resolveFrontendApp — refusals name what to pass', () => {
  it('lists the projects that were not taken for a frontend, so the user can pick one', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('libs/ui/project.json', JSON.stringify({ name: 'ui', projectType: 'library' }));
    tree.write('tools/scripts/project.json', JSON.stringify({ name: 'scripts', projectType: 'library' }));
    expect(resolveFrontendApp(tree, undefined)).toEqual({ kind: 'none', otherProjects: ['scripts', 'ui'] });
  });

  it('an empty workspace has nothing to list', () => {
    expect(resolveFrontendApp(createTreeWithEmptyWorkspace(), undefined)).toEqual({ kind: 'none', otherProjects: [] });
  });
});
