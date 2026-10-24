import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { renderAddBackendReport } from './render.ts';
import { runAddBackend } from './generator.ts';

const FIXTURES = join(__dirname, '../../../../../tools/fixtures/eslint-configs');
const NX_DEFAULT_ESLINT = readFileSync(join(FIXTURES, 'nx-default.config.mjs'), 'utf-8');

function addProject(tree: Tree, name: string, projectType: 'application' | 'library', tags: string[] = []): void {
  tree.write(`apps/${name}/project.json`, `${JSON.stringify({ name, projectType, tags }, null, 2)}\n`);
}

function fullstackTree(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  addProject(tree, 'web', 'application');
  addProject(tree, 'web-e2e', 'application');
  addProject(tree, 'api', 'application');
  tree.write('package.json', `${JSON.stringify({ name: 'my-app', private: true }, null, 2)}\n`);
  // classic setup: baseUrl present, so the tsconfig-paths extra applies
  tree.write('tsconfig.base.json', `${JSON.stringify({ compilerOptions: { baseUrl: '.', paths: {} } }, null, 2)}\n`);
  tree.write('eslint.config.mjs', NX_DEFAULT_ESLINT);
  return tree;
}

describe('runAddBackend — refusals', () => {
  it('refuses with copy-paste official commands when the api project is missing', () => {
    const tree = createTreeWithEmptyWorkspace();
    addProject(tree, 'web', 'application');
    const before = tree.listChanges().length;

    const report = runAddBackend(tree, { backend: 'nest' });

    expect(report.refused).toBe('missing-api-project');
    expect(report.frontendProject).toBe('web');
    expect(report.commands).toEqual([
      'pnpm add -D -w @nx/nest',
      'pnpm nx g @nx/nest:application apps/api --frontendProject=web',
    ]);
    expect(tree.listChanges().length).toBe(before); // refusal writes nothing
  });

  it('refuses listing candidates when two frontend apps exist', () => {
    const tree = createTreeWithEmptyWorkspace();
    addProject(tree, 'web', 'application');
    addProject(tree, 'admin', 'application');
    const before = tree.listChanges().length;

    const report = runAddBackend(tree, { backend: 'express' });

    expect(report.refused).toBe('ambiguous-frontend');
    expect(report.frontendCandidates).toEqual(['admin', 'web']);
    expect(tree.listChanges().length).toBe(before);
  });

  it('refuses when no frontend application exists at all', () => {
    const tree = createTreeWithEmptyWorkspace();
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.refused).toBe('no-frontend');
  });

  it('ignores e2e apps and the api project itself when detecting the frontend', () => {
    const tree = fullstackTree();
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.refused).toBeUndefined();
    expect(report.frontendProject).toBe('web');
  });
});

describe('runAddBackend — wiring', () => {
  it('wires shared-types, tags, tsconfig paths, and (opt-in) eslint', () => {
    const tree = fullstackTree();
    const report = runAddBackend(tree, { backend: 'express', applyEslint: true });

    expect(report.refused).toBeUndefined();
    expect(report.sharedTypes).toBe('created');
    expect(tree.exists('libs/shared-types/src/lib/api-types.ts')).toBe(true);
    expect(JSON.parse(tree.read('apps/web/project.json', 'utf-8')!).tags).toContain('scope:frontend');
    expect(JSON.parse(tree.read('apps/api/project.json', 'utf-8')!).tags).toContain('scope:backend');
    expect(report.tsconfigPaths).toBe('added');
    expect(JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!).compilerOptions.paths['@my-app/shared-types']).toEqual([
      'libs/shared-types/src/index.ts',
    ]);
    expect(report.eslint).toBe('applied');
    expect(tree.read('eslint.config.mjs', 'utf-8')).toContain("sourceTag: 'scope:frontend'");
  });

  it('defaults to snippet-only when applyEslint is absent', () => {
    const tree = fullstackTree();
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.eslint).toBe('snippet-only');
    expect(report.snippet).toContain('scope:backend');
    expect(tree.read('eslint.config.mjs', 'utf-8')).toBe(NX_DEFAULT_ESLINT); // untouched
  });

  it('is idempotent on a second run', () => {
    const tree = fullstackTree();
    runAddBackend(tree, { backend: 'express', applyEslint: true });
    const second = runAddBackend(tree, { backend: 'express', applyEslint: true });

    expect(second.sharedTypes).toBe('skipped');
    expect(second.eslint).toBe('already-applied');
    expect(second.tsconfigPaths).toBe('present');
    expect(second.tags.every((t) => t.action === 'present')).toBe(true);
  });

  it('degrades without touching an unrecognized eslint config', () => {
    const tree = fullstackTree();
    tree.write('eslint.config.mjs', 'export default [/* custom */];');
    const before = tree.read('eslint.config.mjs', 'utf-8');

    const report = runAddBackend(tree, { backend: 'express', applyEslint: true });

    expect(report.eslint).toBe('degraded-unrecognized');
    expect(report.snippet).toContain('scope:frontend');
    expect(tree.read('eslint.config.mjs', 'utf-8')).toBe(before);
  });

  it('reports workspace-link when tsconfig.base.json is absent — the package link is the wiring', () => {
    const tree = fullstackTree();
    tree.delete('tsconfig.base.json');

    const report = runAddBackend(tree, { backend: 'express' });

    expect(report.tsconfigPaths).toBe('workspace-link');
    expect(report.sharedTypes).toBe('created');
  });

  it("integrated layout (paths without baseUrl, Nx 23's nest preset): a relative path alias is the wiring", () => {
    const tree = fullstackTree();
    tree.write('tsconfig.base.json', `${JSON.stringify({ compilerOptions: { rootDir: '.', paths: {} } }, null, 2)}\n`);

    const report = runAddBackend(tree, { backend: 'nest' });

    expect(report.tsconfigPaths).toBe('added');
    const paths = JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!).compilerOptions.paths;
    expect(Object.values(paths)).toEqual([['./libs/shared-types/src/index.ts']]);
  });

  it('modern TS setup (no paths key, no baseUrl): no alias — the workspace link is the wiring', () => {
    const tree = fullstackTree();
    tree.write('tsconfig.base.json', `${JSON.stringify({ compilerOptions: { composite: true } }, null, 2)}\n`);
    expect(runAddBackend(tree, { backend: 'express' }).tsconfigPaths).toBe('workspace-link');
  });

  it('dryRun writes nothing and reports everything', () => {
    const tree = fullstackTree();
    const before = tree.listChanges().length;

    const report = runAddBackend(tree, { backend: 'nest', dryRun: true, applyEslint: true });

    expect(tree.listChanges().length).toBe(before);
    expect(report.sharedTypes).toBe('created'); // "would create"
    expect(report.eslint).toBe('applied'); // "would apply"
    expect(report.tsconfigPaths).toBe('added');
  });
});

describe('runAddBackend — refusal and frontend-selection edge cases', () => {
  it('refuses before any write when a target project.json is unparseable', () => {
    const tree = fullstackTree();
    tree.write('apps/api/project.json', '{ not json');
    const before = tree.listChanges().length;

    const report = runAddBackend(tree, { backend: 'express', applyEslint: true });

    expect(report.refused).toBe('invalid-project-json');
    expect(report.invalidProjects).toEqual(['apps/api/project.json']);
    expect(tree.listChanges().length).toBe(before);
    expect(tree.exists('libs/shared-types/package.json')).toBe(false);
  });

  it('honors an explicit frontendProject when several apps exist', () => {
    const tree = fullstackTree();
    addProject(tree, 'admin', 'application');

    const report = runAddBackend(tree, { backend: 'express', frontendProject: 'admin' });

    expect(report.refused).toBeUndefined();
    expect(report.frontendProject).toBe('admin');
    expect(JSON.parse(tree.read('apps/admin/project.json', 'utf-8')!).tags).toContain('scope:frontend');
  });

  it('refuses a frontendProject that does not exist', () => {
    const tree = fullstackTree();
    const report = runAddBackend(tree, { backend: 'express', frontendProject: 'ghost' });
    expect(report.refused).toBe('frontend-not-found');
  });

  it('mentions --frontendProject in the ambiguous refusal', () => {
    const tree = createTreeWithEmptyWorkspace();
    addProject(tree, 'web', 'application');
    addProject(tree, 'admin', 'application');
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.refused).toBe('ambiguous-frontend');
  });

  it("excludes a project literally named 'e2e' from frontend candidates", () => {
    const tree = fullstackTree();
    addProject(tree, 'e2e', 'application');
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.refused).toBeUndefined();
    expect(report.frontendProject).toBe('web');
  });
});

describe('runAddBackend — toolkit.config.json persistence and the nx version pin', () => {
  it("persists the backend axis into toolkit.config.json so doctor's backend checks can run", () => {
    const tree = fullstackTree();
    const report = runAddBackend(tree, { backend: 'express' });
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8')!).backend).toBe('express');
    expect(report.config).toBe('created');
  });

  it('merges backend into an existing toolkit.config.json without clobbering other keys', () => {
    const tree = fullstackTree();
    tree.write('toolkit.config.json', '{\n  "review": { "mode": "full" }\n}\n');
    const report = runAddBackend(tree, { backend: 'nest' });
    const parsed = JSON.parse(tree.read('toolkit.config.json', 'utf-8')!);
    expect(parsed.review).toEqual({ mode: 'full' });
    expect(parsed.backend).toBe('nest');
    expect(report.config).toBe('updated');
    expect(runAddBackend(tree, { backend: 'nest' }).config).toBe('unchanged');
  });

  it('leaves a non-object toolkit.config.json untouched instead of throwing', () => {
    for (const weird of ['null\n', '[]\n']) {
      const tree = fullstackTree();
      tree.write('toolkit.config.json', weird);
      const report = runAddBackend(tree, { backend: 'express' });
      expect(report.config).toBe('unchanged');
      expect(tree.read('toolkit.config.json', 'utf-8')).toBe(weird);
    }
  });

  it('does not pin the refusal command to a non-version nx entry (catalog:, workspace:*)', () => {
    for (const value of ['catalog:', 'workspace:*', 'latest']) {
      const tree = createTreeWithEmptyWorkspace();
      addProject(tree, 'web', 'application');
      tree.write('package.json', `${JSON.stringify({ name: 'my-app', devDependencies: { nx: value } }, null, 2)}\n`);
      const report = runAddBackend(tree, { backend: 'nest' });
      expect(report.commands?.[0]).toBe('pnpm add -D -w @nx/nest');
    }
  });

  it('pins the refusal install command to the workspace nx version when it is known', () => {
    const tree = createTreeWithEmptyWorkspace();
    addProject(tree, 'web', 'application');
    tree.write('package.json', `${JSON.stringify({ name: 'my-app', devDependencies: { nx: '23.2.0' } }, null, 2)}\n`);
    const report = runAddBackend(tree, { backend: 'nest' });
    expect(report.refused).toBe('missing-api-project');
    expect(report.commands?.[0]).toBe('pnpm add -D -w @nx/nest@23.2.0');
  });
});

describe('runAddBackend — project detection edge cases', () => {
  it('does not mistake a library rooted at libs/api for the api app', () => {
    const tree = createTreeWithEmptyWorkspace();
    addProject(tree, 'web', 'application');
    tree.write('libs/api/project.json', `${JSON.stringify({ name: 'api-lib', projectType: 'library', tags: [] }, null, 2)}\n`);

    const report = runAddBackend(tree, { backend: 'express' });

    expect(report.refused).toBe('missing-api-project');
    expect(tree.read('libs/api/project.json', 'utf-8')).not.toContain('scope:backend');
  });

  it('treats a legacy project.json shared-types lib as existing — never writes a second package.json', () => {
    const tree = fullstackTree();
    tree.write(
      'libs/shared-types/project.json',
      `${JSON.stringify({ name: 'shared-types', projectType: 'library', tags: ['scope:shared'], targets: {} }, null, 2)}\n`,
    );

    const report = runAddBackend(tree, { backend: 'express' });

    expect(report.sharedTypes).toBe('skipped');
    expect(tree.exists('libs/shared-types/package.json')).toBe(false);
  });
});

describe('runAddBackend — Nx fullstack template reality (scoped names, package.json projects)', () => {
  // Mirrors the real nrwl template (E2E-probed 2026-10-05): apps carry NO
  // project.json — they are package.json projects with nx.projectType and
  // their own nx.tags (scope:shop / scope:api), and names are npm-scoped.
  function templateTree(): Tree {
    const tree = createTreeWithEmptyWorkspace();
    const app = (name: string, tags: string[]) =>
      `${JSON.stringify({ name, private: true, nx: { projectType: 'application', tags } }, null, 2)}\n`;
    tree.write('apps/shop/package.json', app('@org/shop', ['scope:shop']));
    tree.write('apps/shop-e2e/package.json', app('@org/shop-e2e', []));
    tree.write('apps/api/package.json', app('@org/api', ['scope:api']));
    tree.write('package.json', `${JSON.stringify({ name: '@org/source', private: true }, null, 2)}\n`);
    tree.write('tsconfig.base.json', `${JSON.stringify({ compilerOptions: { paths: {} } }, null, 2)}\n`);
    tree.write('eslint.config.mjs', NX_DEFAULT_ESLINT);
    return tree;
  }

  it('recognizes api/frontend by root basename and merges tags into package.json nx.tags', () => {
    const tree = templateTree();
    const report = runAddBackend(tree, { backend: 'express', applyEslint: true });
    expect(report.refused).toBeUndefined();
    expect(report.frontendProject).toBe('@org/shop');
    const api = JSON.parse(tree.read('apps/api/package.json', 'utf-8')!);
    const shop = JSON.parse(tree.read('apps/shop/package.json', 'utf-8')!);
    expect(api.nx.tags).toEqual(['scope:api', 'scope:backend']); // existing tags preserved
    expect(shop.nx.tags).toEqual(['scope:shop', 'scope:frontend']);
    expect(report.tags.map((t) => t.project)).toContain('@org/shared-types'); // report names the real package
    expect(report.eslint).toBe('applied');
  });

  it('is idempotent on the template shape too', () => {
    const tree = templateTree();
    runAddBackend(tree, { backend: 'express', applyEslint: true });
    const second = runAddBackend(tree, { backend: 'express', applyEslint: true });
    expect(second.tags.every((t) => t.action === 'present')).toBe(true);
    expect(second.eslint).toBe('already-applied');
    const api = JSON.parse(tree.read('apps/api/package.json', 'utf-8')!);
    expect(api.nx.tags).toEqual(['scope:api', 'scope:backend']); // no duplicates
  });
});

describe('runAddBackend — npm workspaces', () => {
  function npmTree(): Tree {
    const tree = fullstackTree();
    tree.write('package-lock.json', '{}\n');
    tree.write('package.json', `${JSON.stringify({ name: 'my-app', workspaces: ['apps/*'] }, null, 2)}\n`);
    return tree;
  }

  it('registers libs/shared-types in package.json workspaces when npm is detected', () => {
    const tree = npmTree();
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.workspaceGlob).toBe('added');
    expect(JSON.parse(tree.read('package.json', 'utf-8')!).workspaces).toContain('libs/shared-types');
    expect(report.packageManager).toBe('npm');
  });

  it('a pnpm-workspace.yaml outranks a stray package-lock (detection priority)', () => {
    const tree = npmTree();
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.packageManager).toBe('pnpm');
    expect(JSON.parse(tree.read('package.json', 'utf-8')!).workspaces).not.toContain('libs/shared-types');
  });

  it('renders npm commands in the missing-api refusal on an npm workspace', () => {
    const tree = createTreeWithEmptyWorkspace();
    addProject(tree, 'web', 'application');
    tree.write('package-lock.json', '{}\n');
    tree.write('package.json', `${JSON.stringify({ name: 'x', devDependencies: { nx: '23.2.0' } }, null, 2)}\n`);
    const report = runAddBackend(tree, { backend: 'nest' });
    expect(report.commands?.[0]).toBe('npm install -D @nx/nest@23.2.0');
    expect(report.commands?.[1]).toBe('npm exec nx -- g @nx/nest:application apps/api --frontendProject=web');
  });
});

describe('runAddBackend — yarn workspaces', () => {
  function yarnTree(flavor: 'classic' | 'berry'): Tree {
    const tree = fullstackTree();
    tree.write('package.json', `${JSON.stringify({ name: 'my-app', private: true, workspaces: ['apps/*'] }, null, 2)}\n`);
    if (flavor === 'berry') {
      tree.write('yarn.lock', '__metadata:\n  version: 8\n');
      tree.write('.yarnrc.yml', 'nodeLinker: node-modules\n');
    } else {
      tree.write('yarn.lock', '# yarn lockfile v1\n');
    }
    return tree;
  }

  it.each(['classic', 'berry'] as const)('%s: registers libs/shared-types in package.json workspaces', (flavor) => {
    const tree = yarnTree(flavor);
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.packageManager).toBe('yarn');
    expect(report.workspaceGlob).toBe('added');
    expect(JSON.parse(tree.read('package.json', 'utf-8')!).workspaces).toContain('libs/shared-types');
    expect(renderAddBackendReport(report, false)).toContain("package.json workspaces: 'libs/shared-types' registered — run `yarn install` once to link it");
  });

  it('a yarn root without "private": true is reported, never written (yarn 1 refuses workspaces there)', () => {
    const tree = yarnTree('classic');
    tree.write('package.json', `${JSON.stringify({ name: 'my-app', workspaces: ['apps/*'] }, null, 2)}\n`);
    const before = tree.read('package.json', 'utf-8');
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.workspaceGlob).toBe('unrecognized');
    expect(tree.read('package.json', 'utf-8')).toBe(before);
  });

  it('an npm repo with a stray yarn.lock stays npm (packageManager absent)', () => {
    const tree = yarnTree('classic');
    tree.write('package-lock.json', '{}\n');
    expect(runAddBackend(tree, { backend: 'express' }).packageManager).toBe('npm');
  });

  it.each([
    ['classic', 'yarn add -D -W @nx/nest@23.2.0'],
    ['berry', 'yarn add -D @nx/nest@23.2.0'],
  ] as const)('%s: the missing-api refusal prints yarn commands for that flavor', (flavor, install) => {
    const tree = createTreeWithEmptyWorkspace();
    addProject(tree, 'web', 'application');
    tree.write('package.json', `${JSON.stringify({ name: 'x', devDependencies: { nx: '23.2.0' } }, null, 2)}\n`);
    tree.write('yarn.lock', flavor === 'berry' ? '__metadata:\n  version: 8\n' : '# yarn lockfile v1\n');
    const report = runAddBackend(tree, { backend: 'nest' });
    expect(report.commands).toEqual([install, 'yarn nx g @nx/nest:application apps/api --frontendProject=web']);
  });
});

describe('runAddBackend — bun workspaces', () => {
  it('registers libs/shared-types in package.json workspaces and tells to run bun install', () => {
    const tree = fullstackTree();
    tree.write('package.json', `${JSON.stringify({ name: 'my-app', private: true, workspaces: ['apps/*'] }, null, 2)}\n`);
    tree.write('bun.lock', '{}\n');
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.packageManager).toBe('bun');
    expect(report.workspaceGlob).toBe('added');
    expect(JSON.parse(tree.read('package.json', 'utf-8')!).workspaces).toContain('libs/shared-types');
    expect(renderAddBackendReport(report, false)).toContain("package.json workspaces: 'libs/shared-types' registered — run `bun install` once to link it");
  });

  it('the missing-api refusal prints bun commands', () => {
    const tree = createTreeWithEmptyWorkspace();
    addProject(tree, 'web', 'application');
    tree.write('package.json', `${JSON.stringify({ name: 'x', devDependencies: { nx: '23.2.0' } }, null, 2)}\n`);
    tree.write('bun.lock', '{}\n');
    const report = runAddBackend(tree, { backend: 'nest' });
    expect(report.commands).toEqual(['bun add -d @nx/nest@23.2.0', 'bun nx g @nx/nest:application apps/api --frontendProject=web']);
  });
});

it('a blind pnpm fallback on an undetectable tree carries a report note', () => {
  const tree = fullstackTree(); // no lockfiles, no pnpm-workspace.yaml
  const report = runAddBackend(tree, { backend: 'express' });
  expect(report.packageManagerNote).toContain('pnpm');
  const text = renderAddBackendReport(report, false);
  expect(text).toContain('could not be detected');
});

describe('runAddBackend — classic-preset Nx 23 layout (package.json-only projects, no projectType)', () => {
  // Measured 2026-10-14 on create-nx-workspace@23.2.0 --preset=react-monorepo from a
  // plain terminal: apps carry only a package.json (no nx field), the app has a
  // tsconfig.app.json, and Nx infers projectType from those files.
  function classicTree(pm: 'pnpm' | 'npm' = 'pnpm'): Tree {
    const tree = createTreeWithEmptyWorkspace();
    const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    tree.write('apps/web/package.json', json({ name: '@cls/web', version: '0.0.1', private: true }));
    tree.write('apps/web/tsconfig.app.json', '{}\n');
    tree.write('apps/web-e2e/package.json', json({ name: '@cls/web-e2e', private: true, nx: { implicitDependencies: ['@cls/web'] } }));
    tree.write('libs/ui/package.json', json({ name: '@cls/ui', exports: { '.': './src/index.ts' } }));
    tree.write('libs/ui/tsconfig.lib.json', '{}\n');
    tree.write('node_modules/@nx/react/package.json', json({ name: '@nx/react', peerDependencies: { express: '^4.21.2' } }));
    tree.write('tsconfig.base.json', json({ compilerOptions: { composite: true } }));
    tree.write('eslint.config.mjs', NX_DEFAULT_ESLINT);
    if (pm === 'pnpm') {
      tree.write('package.json', json({ name: '@cls/source', private: true, devDependencies: { nx: '23.2.0' } }));
      tree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'libs/*'\n");
    } else {
      tree.write('package.json', json({ name: '@cls/source', private: true, workspaces: ['apps/*', 'libs/*'], devDependencies: { nx: '23.2.0' } }));
      tree.write('package-lock.json', '{}\n');
    }
    return tree;
  }

  it('detects the frontend from its files and refuses with apps/api plus the express alignment (pnpm)', () => {
    const tree = classicTree('pnpm');
    const before = tree.listChanges().length;

    const report = runAddBackend(tree, { backend: 'express' });

    expect(report.refused).toBe('missing-api-project');
    expect(report.frontendProject).toBe('@cls/web');
    expect(report.commands).toEqual([
      'pnpm add -D -w @nx/express@23.2.0',
      'pnpm add -w "express@^4.21.2"',
      'pnpm nx g @nx/express:application apps/api --frontendProject=@cls/web',
    ]);
    expect(tree.listChanges().length).toBe(before);
  });

  it('the rendered refusal explains the express line in one note, and only when it is there', () => {
    const withLine = renderAddBackendReport(runAddBackend(classicTree(), { backend: 'express' }), false);
    expect(withLine).toContain('pnpm add -w "express@^4.21.2"');
    expect(withLine).toContain("express@^4.21.2, the range this workspace's @nx/react supports");
    const nest = renderAddBackendReport(runAddBackend(classicTree(), { backend: 'nest' }), false);
    expect(nest).not.toContain('@nx/react supports');
  });

  it('renders the npm forms of the same three commands', () => {
    const report = runAddBackend(classicTree('npm'), { backend: 'express' });
    expect(report.commands).toEqual([
      'npm install -D @nx/express@23.2.0',
      'npm install "express@^4.21.2"',
      'npm exec nx -- g @nx/express:application apps/api --frontendProject=@cls/web',
    ]);
  });

  it('adds no express line when express is already declared, when @nx/react is absent or has no express peer, or for nest', () => {
    const declared = classicTree();
    declared.write(
      'package.json',
      `${JSON.stringify({ name: '@cls/source', devDependencies: { nx: '23.2.0' }, dependencies: { express: '^5.1.0' } }, null, 2)}\n`,
    );
    expect(runAddBackend(declared, { backend: 'express' }).commands).toHaveLength(2);

    const noReact = classicTree();
    noReact.delete('node_modules/@nx/react/package.json');
    expect(runAddBackend(noReact, { backend: 'express' }).commands).toHaveLength(2);

    const noPeer = classicTree();
    noPeer.write('node_modules/@nx/react/package.json', '{"name":"@nx/react","peerDependencies":{}}');
    expect(runAddBackend(noPeer, { backend: 'express' }).commands).toHaveLength(2);

    const nest = runAddBackend(classicTree(), { backend: 'nest' });
    expect(nest.commands).toEqual([
      'pnpm add -D -w @nx/nest@23.2.0',
      'pnpm nx g @nx/nest:application apps/api --frontendProject=@cls/web',
    ]);
  });

  it('wires the generated api once it exists — tags land in each package.json nx field', () => {
    const tree = classicTree();
    tree.write('apps/api/package.json', `${JSON.stringify({ name: '@cls/api', version: '0.0.1', private: true, nx: { targets: {} } }, null, 2)}\n`);
    tree.write('apps/api/tsconfig.app.json', '{}\n');
    tree.write('apps/api-e2e/package.json', `${JSON.stringify({ name: '@cls/api-e2e', private: true }, null, 2)}\n`);

    const report = runAddBackend(tree, { backend: 'express', applyEslint: true });

    expect(report.refused).toBeUndefined();
    expect(report.frontendProject).toBe('@cls/web');
    const web = JSON.parse(tree.read('apps/web/package.json', 'utf-8')!);
    const api = JSON.parse(tree.read('apps/api/package.json', 'utf-8')!);
    expect(web.nx.tags).toEqual(['scope:frontend']);
    expect(api.nx.tags).toEqual(['scope:backend']);
    expect(api.nx.targets).toEqual({}); // the rest of the nx field is preserved
    expect(JSON.parse(tree.read('apps/api-e2e/package.json', 'utf-8')!).nx).toBeUndefined(); // e2e untouched
    expect(JSON.parse(tree.read('libs/ui/package.json', 'utf-8')!).nx).toBeUndefined(); // library untouched
    expect(report.eslint).toBe('applied');
  });

  it('never takes a library (tsconfig.lib.json / entry points) for the frontend or the api', () => {
    const tree = classicTree();
    tree.write('libs/api/package.json', `${JSON.stringify({ name: '@cls/api-lib', main: './index.js' }, null, 2)}\n`);
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.refused).toBe('missing-api-project'); // libs/api is a library, not the api app
    expect(report.frontendProject).toBe('@cls/web'); // libs/ui is not a second frontend candidate
  });

  it('places the api beside a frontend outside apps/ (packages/web → packages/api)', () => {
    const tree = classicTree();
    tree.rename('apps/web/package.json', 'packages/web/package.json');
    tree.rename('apps/web/tsconfig.app.json', 'packages/web/tsconfig.app.json');
    tree.delete('apps/web-e2e/package.json');
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'libs/*'\n  - 'packages/*'\n"); // package.json projects must match a workspace glob
    const report = runAddBackend(tree, { backend: 'nest' });
    expect(report.commands?.[1]).toBe('pnpm nx g @nx/nest:application packages/api --frontendProject=@cls/web');
  });
});

describe('runAddBackend — inference never overrides what worked before', () => {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

  function templateWithRootNx(): Tree {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/shop/package.json', json({ name: '@org/shop', nx: { projectType: 'application' } }));
    tree.write('apps/api/package.json', json({ name: '@org/api', nx: { projectType: 'application' } }));
    tree.write('packages/tsconfig/package.json', json({ name: '@org/tsconfig', files: ['base.json'] }));
    tree.write('package.json', json({ name: '@org/source', private: true, workspaces: ['apps/*', 'packages/*'], nx: {} }));
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    return tree;
  }

  it('the root package.json (nx field) and an entry-point-less tooling package do not join declared apps as candidates', () => {
    const report = runAddBackend(templateWithRootNx(), { backend: 'express' });
    expect(report.refused).toBeUndefined();
    expect(report.frontendProject).toBe('@org/shop');
  });

  it('a backend-only workspace (api app, no frontend) is wired without a frontend tag — the root is never tagged scope:frontend', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/api/package.json', json({ name: '@org/api', nx: { projectType: 'application' } }));
    tree.write('apps/api-e2e/package.json', json({ name: '@org/api-e2e', nx: { projectType: 'application' } }));
    tree.write('package.json', json({ name: '@org/source', private: true, nx: { includedScripts: [] } }));
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");

    const report = runAddBackend(tree, { backend: 'express' });

    expect(report.refused).toBeUndefined();
    expect(report.frontendProject).toBeUndefined();
    expect(report.tags.map((t) => t.project)).toEqual(['@org/api', '@org/shared-types']);
    expect(JSON.parse(tree.read('apps/api/package.json', 'utf-8')!).nx.tags).toEqual(['scope:backend']);
    expect(JSON.parse(tree.read('package.json', 'utf-8')!).nx.tags).toBeUndefined();
    expect(tree.exists('libs/shared-types/package.json')).toBe(true);
    expect(renderAddBackendReport(report, false)).toContain('frontend project: none (backend-only workspace)');
  });

  it('no frontend and no api app → refused no-frontend, nothing written', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('package.json', json({ name: '@org/source', private: true }));
    const before = tree.listChanges().length;
    const report = runAddBackend(tree, { backend: 'nest' });
    expect(report.refused).toBe('no-frontend');
    expect(tree.listChanges().length).toBe(before);
    expect(renderAddBackendReport(report, false)).toContain('--preset=nest --appName=api');
  });

  it('an undeclared types-only package named api is not the api app — inferred api matches need tsconfig.app.json', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/web/package.json', json({ name: '@cls/web', private: true }));
    tree.write('apps/web/tsconfig.app.json', '{}\n');
    tree.write('libs/api/package.json', json({ name: '@cls/api-types', types: './index.d.ts' }));
    tree.write('package.json', json({ name: '@cls/source', private: true, devDependencies: { nx: '23.2.0' } }));
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'libs/*'\n");

    const report = runAddBackend(tree, { backend: 'express' });

    expect(report.refused).toBe('missing-api-project');
    expect(JSON.parse(tree.read('libs/api/package.json', 'utf-8')!).nx).toBeUndefined();
  });

  it('an inferred frontend without tsconfig.app.json still counts (Nx 23 Next apps ship none)', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/site/package.json', json({ name: '@nx/site', private: true }));
    tree.write('apps/site/tsconfig.json', '{}\n');
    tree.write('package.json', json({ name: '@nx/source', private: true, devDependencies: { nx: '23.2.0' } }));
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    const report = runAddBackend(tree, { backend: 'nest' });
    expect(report.refused).toBe('missing-api-project');
    expect(report.frontendProject).toBe('@nx/site');
  });

  it('with no declared apps, an entry-point-less tooling package joins the inferred tier — a safe ambiguous refusal, nothing written', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/web/package.json', json({ name: '@cls/web', private: true }));
    tree.write('apps/web/tsconfig.app.json', '{}\n');
    tree.write('packages/tsconfig/package.json', json({ name: '@cls/tsconfig', files: ['base.json'] }));
    tree.write('package.json', json({ name: '@cls/source', private: true }));
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    const before = tree.listChanges().length;

    const report = runAddBackend(tree, { backend: 'express' });

    expect(report.refused).toBe('ambiguous-frontend');
    expect(report.frontendCandidates).toEqual(['@cls/tsconfig', '@cls/web']);
    expect(tree.listChanges().length).toBe(before);
    expect(renderAddBackendReport(report, false)).toContain('--frontendProject');
  });

  it('a declared application at the workspace root puts the api under apps/', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('project.json', json({ name: 'standalone', projectType: 'application', root: '.' }));
    const report = runAddBackend(tree, { backend: 'nest' });
    expect(report.frontendProject).toBe('standalone');
    expect(report.commands?.[1]).toBe('pnpm nx g @nx/nest:application apps/api --frontendProject=standalone');
  });
});

describe('runAddBackend — edits leave the rest of a JSON file alone', () => {
  it('adds a tag to a Prettier-style project.json as a one-line change', () => {
    const tree = fullstackTree();
    const web = '{\n  "name": "web",\n  "projectType": "application",\n  "tags": ["type:app"],\n  "targets": { "build": { "executor": "@nx/next:build", "options": { "outputPath": "dist/web" } } }\n}\n';
    tree.write('apps/web/project.json', web);
    runAddBackend(tree, { backend: 'express' });
    const after = (tree.read('apps/web/project.json', 'utf-8') as string).split('\n');
    const before = web.split('\n');
    expect(after.length).toBe(before.length);
    expect(after.filter((line, index) => line !== before[index])).toEqual(['  "tags": ["type:app", "scope:frontend"],']);
  });

  it('adds the shared-types path to tsconfig.base.json without reformatting it', () => {
    const tree = fullstackTree();
    const tsconfig = '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "lib": ["es2022", "dom"],\n    "paths": {}\n  }\n}\n';
    tree.write('tsconfig.base.json', tsconfig);
    runAddBackend(tree, { backend: 'express' });
    const after = tree.read('tsconfig.base.json', 'utf-8') as string;
    expect(after).toContain('    "lib": ["es2022", "dom"],\n');
    expect(after).toMatch(/"paths": \{\n {6}"[^"]+": \["libs\/shared-types\/src\/index\.ts"\]\n {4}\}/);
  });
});

describe('runAddBackend — tags and the shared-types lib come from toolkit.config.json', () => {
  it('uses the configured role tags, in the projects and in the ESLint constraints', () => {
    const tree = fullstackTree();
    tree.write('toolkit.config.json', JSON.stringify({ boundaries: { tags: { frontend: 'type:web', backend: 'type:api', shared: 'type:shared' } } }));
    const report = runAddBackend(tree, { backend: 'express', applyEslint: true });
    expect(JSON.parse(tree.read('apps/web/project.json', 'utf-8')!).tags).toEqual(['type:web']);
    expect(JSON.parse(tree.read('apps/api/project.json', 'utf-8')!).tags).toEqual(['type:api']);
    // the lib add-backend creates carries the configured shared tag, not the default
    expect(JSON.parse(tree.read('libs/shared-types/package.json', 'utf-8')!).nx.tags).toEqual(['type:shared']);
    expect(report.eslint).toBe('applied');
    const eslint = tree.read('eslint.config.mjs', 'utf-8')!;
    expect(eslint).toContain("sourceTag: 'type:web'");
    expect(eslint).toContain("notDependOnLibsWithTags: ['type:api']");
    expect(eslint).not.toContain('scope:frontend');
  });

  it('puts the shared-types lib where sharedTypes says, under its import path', () => {
    const tree = fullstackTree();
    tree.write('toolkit.config.json', JSON.stringify({ sharedTypes: { path: 'packages/types', importPath: '@acme/types' } }));
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.sharedTypesPackage).toBe('@acme/types');
    expect(JSON.parse(tree.read('packages/types/package.json', 'utf-8')!).name).toBe('@acme/types');
    expect(tree.exists('libs/shared-types')).toBe(false);
    expect(JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!).compilerOptions.paths['@acme/types']).toEqual(['packages/types/src/index.ts']);
  });

  it('sharedTypes: false wires the backend without a shared-types lib', () => {
    const tree = fullstackTree();
    tree.write('toolkit.config.json', JSON.stringify({ sharedTypes: false }));
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.sharedTypes).toBe('disabled');
    expect(tree.exists('libs/shared-types')).toBe(false);
    expect(JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!).compilerOptions.paths).toEqual({});
    expect(report.tags.map((t) => t.project)).toEqual(['web', 'api']);
  });
});

describe('runAddBackend — the api app goes next to a root-level frontend', () => {
  it('suggests api/ beside web/, not apps/api', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('web/project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'web/src' }));
    const report = runAddBackend(tree, { backend: 'express' });
    expect(report.refused).toBe('missing-api-project');
    expect(report.commands?.at(-1)).toBe('pnpm nx g @nx/express:application api --frontendProject=web');
  });
});
