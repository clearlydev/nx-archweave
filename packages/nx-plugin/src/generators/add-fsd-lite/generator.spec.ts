import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAddFsdLite } from './generator.ts';

const FIXTURES = join(__dirname, '../../../../../tools/fixtures/eslint-configs');
const REACT_APP_CONFIG = readFileSync(join(FIXTURES, 'nx-react-app.config.mjs'), 'utf-8');
const ESLINT = 'apps/web/eslint.config.mjs';

/** The frontend app the rule goes into — a package.json project like Nx's own templates. */
function appTree(withEslint = true): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('apps/web/package.json', JSON.stringify({ name: 'web', private: true, nx: { projectType: 'application' } }, null, 2));
  if (withEslint) tree.write(ESLINT, REACT_APP_CONFIG);
  return tree;
}

describe('runAddFsdLite — no folders, a rule', () => {
  it('creates no layer directories or barrels; the guide names where the layers go', () => {
    const tree = appTree();
    const before = tree.listChanges().length;
    const report = runAddFsdLite(tree, { frontend: 'react-vite' });
    expect(report.aborted).toBe(false);
    expect(report.project).toBe('web');
    expect(report.sourceRoot).toBe('apps/web/src');
    expect(tree.exists('apps/web/src')).toBe(false);
    expect(tree.exists('src')).toBe(false);
    expect(tree.listChanges().length).toBe(before); // report-only without --applyEslint
    expect(report.layerGuide).toContain('apps/web/src/features');
    expect(report.layerGuide).toContain('nx g @clearlydev/nx-archweave:feature');
  });

  it('without --applyEslint it is report-only: the snippet carries the import and the entry', () => {
    const tree = appTree();
    const report = runAddFsdLite(tree, { frontend: 'react-vite' });
    expect(report.eslint).toBe('snippet-only');
    expect(report.eslintPath).toBe(ESLINT);
    expect(report.snippet).toContain("import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';");
    expect(report.snippet).toContain("...fsdBoundaries({ severity: 'warn' }),");
    expect(tree.read(ESLINT, 'utf-8')).toBe(REACT_APP_CONFIG);
  });

  it("--applyEslint writes the rule into the app's config, idempotently", () => {
    const tree = appTree();
    const first = runAddFsdLite(tree, { frontend: 'react-vite', applyEslint: true, enforcement: 'error' });
    expect(first.eslint).toBe('applied');
    expect(first.snippet).toBeNull();
    const written = tree.read(ESLINT, 'utf-8') as string;
    expect(written).toContain("import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';");
    expect(written).toContain("  ...fsdBoundaries({ severity: 'error' }),\n];");
    const second = runAddFsdLite(tree, { frontend: 'react-vite', applyEslint: true, enforcement: 'error' });
    expect(second.eslint).toBe('already-applied');
    expect(tree.read(ESLINT, 'utf-8')).toBe(written);
    // and a later report-only run sees it too
    expect(runAddFsdLite(tree, { frontend: 'react-vite' }).eslint).toBe('already-applied');
  });

  it('never touches a config shape it does not own, and says so with the snippet', () => {
    const tree = appTree();
    tree.write(ESLINT, "const config = [];\nexport default config;\n");
    const report = runAddFsdLite(tree, { frontend: 'react-vite', applyEslint: true });
    expect(report.eslint).toBe('degraded-unrecognized');
    expect(report.snippet).toContain('fsdBoundaries');
    expect(tree.read(ESLINT, 'utf-8')).toBe("const config = [];\nexport default config;\n");
  });

  it('an app without an ESLint config degrades to the snippet', () => {
    const report = runAddFsdLite(appTree(false), { frontend: 'react-vite', applyEslint: true });
    expect(report.eslint).toBe('degraded-unrecognized');
    expect(report.eslintPath).toBeNull();
  });

  it('dryRun previews the apply without writing', () => {
    const tree = appTree();
    const report = runAddFsdLite(tree, { frontend: 'react-vite', applyEslint: true, dryRun: true });
    expect(report.eslint).toBe('applied');
    expect(tree.read(ESLINT, 'utf-8')).toBe(REACT_APP_CONFIG);
  });

  it('next: the guide names _pages and no app layer', () => {
    const report = runAddFsdLite(appTree(), { frontend: 'next' });
    expect(report.layerGuide).toContain('apps/web/src/_pages');
    expect(report.layerGuide).not.toMatch(/apps\/web\/src\/app\b/);
  });
});

describe('runAddFsdLite — enforcement resolution', () => {
  it('defaults to warn; toolkit.config.json fsd.enforcement decides; the option wins', () => {
    const tree = appTree();
    expect(runAddFsdLite(tree, { frontend: 'react-vite' }).enforcement).toBe('warn');
    tree.write('toolkit.config.json', JSON.stringify({ fsd: { enforcement: 'error' } }));
    expect(runAddFsdLite(tree, { frontend: 'react-vite' }).enforcement).toBe('error');
    expect(runAddFsdLite(tree, { frontend: 'react-vite', enforcement: 'warn' }).enforcement).toBe('warn');
  });

  it('an unrecognized or unusable value falls back without aborting', () => {
    const tree = appTree();
    tree.write('toolkit.config.json', JSON.stringify({ fsd: { enforcement: 'off' } }));
    expect(runAddFsdLite(tree, { frontend: 'react-vite', enforcement: 'loose' as never }).enforcement).toBe('warn');
    tree.write('toolkit.config.json', '{ not json');
    expect(runAddFsdLite(tree, { frontend: 'react-vite' }).aborted).toBe(false);
  });

  it('inherits locale from toolkit.config.json for the snippet and the guide', () => {
    const tree = appTree();
    tree.write('toolkit.config.json', JSON.stringify({ locale: 'ko' }));
    const report = runAddFsdLite(tree, { frontend: 'react-vite' });
    expect(report.snippet).toContain('직접 넣으세요');
    expect(report.layerGuide).toContain('세그먼트');
  });
});

describe('runAddFsdLite — which app', () => {
  const app = (tree: Tree, dir: string, extra: Record<string, unknown> = {}) =>
    tree.write(`${dir}/package.json`, JSON.stringify({ name: dir.split('/').pop(), nx: { projectType: 'application', ...extra } }));

  it('skips e2e projects and the backend api when looking for the frontend', () => {
    const tree = createTreeWithEmptyWorkspace();
    app(tree, 'apps/shop');
    app(tree, 'apps/shop-e2e');
    app(tree, 'apps/api');
    app(tree, 'apps/server', { tags: ['scope:backend'] });
    expect(runAddFsdLite(tree, { frontend: 'react-vite' }).project).toBe('shop');
  });

  it('a standalone workspace (a declared root application) uses the root config and src/', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('project.json', JSON.stringify({ name: 'solo', projectType: 'application', sourceRoot: 'src' }));
    tree.write('eslint.config.mjs', REACT_APP_CONFIG);
    const report = runAddFsdLite(tree, { frontend: 'react-vite', applyEslint: true });
    expect(report.project).toBe('solo');
    expect(report.eslintPath).toBe('eslint.config.mjs');
    expect(report.eslint).toBe('applied');
    expect(report.layerGuide).toContain('src/features');
  });

  it('refuses, writing nothing, with more than one frontend app — and --project picks one', () => {
    const tree = createTreeWithEmptyWorkspace();
    app(tree, 'apps/web');
    app(tree, 'apps/admin');
    tree.write('apps/admin/eslint.config.mjs', REACT_APP_CONFIG);
    const refused = runAddFsdLite(tree, { frontend: 'react-vite', applyEslint: true });
    expect(refused.aborted).toBe(true);
    expect(refused.appRefusal).toEqual({ reason: 'ambiguous-frontend', candidates: ['admin', 'web'] });
    expect(tree.read('apps/admin/eslint.config.mjs', 'utf-8')).toBe(REACT_APP_CONFIG);
    const picked = runAddFsdLite(tree, { frontend: 'react-vite', applyEslint: true, project: 'admin' });
    expect(picked.project).toBe('admin');
    expect(picked.eslint).toBe('applied');
  });

  it('refuses an unknown --project and a workspace without a frontend app', () => {
    const tree = createTreeWithEmptyWorkspace();
    expect(runAddFsdLite(tree, { frontend: 'react-vite' }).appRefusal).toEqual({ reason: 'no-frontend-app' });
    app(tree, 'apps/web');
    expect(runAddFsdLite(tree, { frontend: 'react-vite', project: 'nope' }).appRefusal).toEqual({ reason: 'project-not-found', project: 'nope' });
  });
});

describe('runAddFsdLite — frontend resolution', () => {
  it("without --frontend, toolkit.config.json's frontend (init records it) decides; none recorded asks for the flag", () => {
    const tree = appTree();
    expect(() => runAddFsdLite(tree, {})).toThrow('add-fsd-lite: pass --frontend=react-vite|next');
    tree.write('toolkit.config.json', '{ "frontend": "next" }\n');
    expect(runAddFsdLite(tree, {}).layerGuide).toContain('_pages');
  });

  it('a backend-only workspace (frontend none recorded) is refused — there is no frontend to structure', () => {
    const tree = appTree();
    tree.write('toolkit.config.json', '{ "frontend": "none", "backend": "nest" }\n');
    expect(() => runAddFsdLite(tree, {})).toThrow('backend-only workspace');
  });
});

describe('runAddFsdLite — --steiger', () => {
  function workspace(): Tree {
    const tree = appTree();
    tree.write('package.json', JSON.stringify({ name: 'ws', private: true, devDependencies: { nx: '23.1.0' } }, null, 2) + '\n');
    tree.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    return tree;
  }

  it('writes the config, the fsd-check target (package.json nx.targets here) and the devDependencies, and names the install command', () => {
    const tree = workspace();
    const report = runAddFsdLite(tree, { frontend: 'react-vite', steiger: true });
    expect(report.steiger).toMatchObject({ config: 'created', target: 'added', targetPath: 'apps/web/package.json', dependencies: 'added', installCommand: 'pnpm install' });
    expect(tree.read('apps/web/steiger.config.mjs', 'utf-8')).toContain('fsd.configs.recommended');
    const app = JSON.parse(tree.read('apps/web/package.json', 'utf-8') as string);
    expect(app.nx.targets['fsd-check']).toEqual({ command: 'steiger src', options: { cwd: '{projectRoot}' } });
    expect(app.nx.projectType).toBe('application'); // the rest of the nx field survives
    const root = JSON.parse(tree.read('package.json', 'utf-8') as string);
    expect(root.devDependencies).toEqual({ nx: '23.1.0', steiger: '^0.7.0', '@feature-sliced/steiger-plugin': '^0.8.0' });
    expect(tree.read('package.json', 'utf-8')).toMatch(/^ {2}"devDependencies"/m);
  });

  it('is idempotent, keeps a config with other content, and goes into project.json when there is one', () => {
    const tree = workspace();
    tree.write('apps/web/project.json', JSON.stringify({ name: 'web', projectType: 'application', targets: { build: { command: 'vite build' } } }, null, 2) + '\n');
    runAddFsdLite(tree, { frontend: 'react-vite', steiger: true });
    const second = runAddFsdLite(tree, { frontend: 'react-vite', steiger: true });
    expect(second.steiger).toMatchObject({ config: 'unchanged', target: 'present', targetPath: 'apps/web/project.json', dependencies: 'present' });
    const project = JSON.parse(tree.read('apps/web/project.json', 'utf-8') as string);
    expect(Object.keys(project.targets)).toEqual(['build', 'fsd-check']);
    tree.write('apps/web/steiger.config.mjs', 'export default [];\n');
    expect(runAddFsdLite(tree, { frontend: 'react-vite', steiger: true }).steiger?.config).toBe('kept');
    expect(tree.read('apps/web/steiger.config.mjs', 'utf-8')).toBe('export default [];\n');
  });

  it('next: the config turns the _pages typo rule off; dryRun writes nothing; without the flag nothing steiger happens', () => {
    const tree = workspace();
    tree.write('toolkit.config.json', JSON.stringify({ frontend: 'next' }));
    const dry = runAddFsdLite(tree, { steiger: true, dryRun: true });
    expect(dry.steiger?.config).toBe('created');
    expect(tree.exists('apps/web/steiger.config.mjs')).toBe(false);
    runAddFsdLite(tree, { steiger: true });
    expect(tree.read('apps/web/steiger.config.mjs', 'utf-8')).toContain("'fsd/typo-in-layer-name': 'off'");
    expect(runAddFsdLite(workspace(), { frontend: 'react-vite' }).steiger).toBeNull();
  });

  it('an unparseable root package.json leaves the dependencies unrecognized without touching anything else', () => {
    const tree = workspace();
    tree.write('package.json', '{ not json');
    const report = runAddFsdLite(tree, { frontend: 'react-vite', steiger: true });
    expect(report.steiger?.dependencies).toBe('unrecognized');
    expect(report.steiger?.target).toBe('added');
    expect(tree.read('package.json', 'utf-8')).toBe('{ not json');
  });
});
