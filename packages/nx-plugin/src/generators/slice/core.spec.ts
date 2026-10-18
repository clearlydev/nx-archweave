import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { resolveSlicePublicApiName } from '@nx-archweave/template-engine';
import { composeSlice, runFsdSlice } from './core.ts';

/** A standalone workspace: the root project is the frontend app, so layers live in src/. */
function appTree(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('project.json', JSON.stringify({ name: 'web', projectType: 'application', sourceRoot: 'src' }));
  return tree;
}

function expectedFiles(name: string, publicApiName?: string, locale: 'ko' | 'en' = 'en') {
  return composeSlice({
    layer: 'features',
    name,
    publicApiName: resolveSlicePublicApiName(name, publicApiName),
    locale,
    sourceRoot: 'src',
    layerDirName: 'features',
    segments: [],
  }).files;
}

describe('runFsdSlice — the layer directory appears with its first slice', () => {
  it('creates the slice, and the layer directory with it, when nothing exists yet', () => {
    const tree = appTree();
    const report = runFsdSlice(tree, 'features', { name: 'checkout' });
    expect(report.refused).toBe(false);
    expect(report.action).toBe('created');
    expect(report.layerDir).toBe('src/features');
    expect(tree.exists('src/features/checkout/index.ts')).toBe(true);
    expect(tree.exists('src/features/checkout/model/checkout.ts')).toBe(true);
    expect(tree.exists('src/features/checkout/model/checkout.spec.ts')).toBe(true);
    expect(tree.exists('src/features/index.ts')).toBe(false); // no layer barrel, ever
  });
});

describe('runFsdSlice — kebab-case name validation', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
    tree.write('src/features/index.ts', 'export {};');
  });

  it.each(['AddToCart', 'add_to_cart', 'add to cart', '-add-to-cart', 'add-to-cart-', 'add--to--cart', '1-invalid', ''])(
    'refuses the invalid name %p and writes nothing',
    (invalidName) => {
      const before = tree.listChanges().length;
      const report = runFsdSlice(tree, 'features', { name: invalidName });
      expect(report.refused).toBe(true);
      expect(report.refusalReason).toBe('invalid-name');
      expect(tree.listChanges().length).toBe(before);
    },
  );

  it.each(['add-to-cart', 'checkout', 'a', 'user2'])('accepts the valid kebab-case name %p', (validName) => {
    const report = runFsdSlice(tree, 'features', { name: validName });
    expect(report.refused).toBe(false);
  });

  it.each(['class', 'delete', 'new', 'import'])(
    'refuses the reserved-word-deriving name %p (its camelCase default would break the generated export)',
    (reservedName) => {
      const before = tree.listChanges().length;
      const report = runFsdSlice(tree, 'features', { name: reservedName });
      expect(report.refused).toBe(true);
      expect(report.refusalReason).toBe('invalid-public-api-name');
      expect(tree.listChanges().length).toBe(before);
    },
  );

  it.each(['1bad', 'has space', 'has-hyphen', ''])(
    'refuses the explicit non-identifier publicApiName %p',
    (badApiName) => {
      const report = runFsdSlice(tree, 'features', { name: 'add-to-cart', publicApiName: badApiName });
      expect(report.refused).toBe(true);
      expect(report.refusalReason).toBe('invalid-public-api-name');
    },
  );

  it('accepts a reserved-word slice name when an explicit valid publicApiName overrides the default', () => {
    const report = runFsdSlice(tree, 'features', { name: 'class', publicApiName: 'classFeature' });
    expect(report.refused).toBe(false);
    expect(report.publicApiName).toBe('classFeature');
  });
});

describe('runFsdSlice — fresh create', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
    tree.write('src/features/index.ts', 'export {};');
  });

  it('creates index.ts and the spec stub with content equal to the engine output', () => {
    const report = runFsdSlice(tree, 'features', { name: 'add-to-cart' });
    expect(report.refused).toBe(false);
    expect(report.action).toBe('created');
    expect(report.directory).toBe('src/features/add-to-cart');
    expect(report.publicApiName).toBe('addToCart');

    const expected = expectedFiles('add-to-cart');
    for (const file of expected) {
      expect(tree.read(file.filePath, 'utf-8')).toBe(file.content);
    }
    expect(report.files).toEqual(expected);
  });
});

describe('runFsdSlice — same-name slice conflict is skipped, not merged', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
    tree.write('src/features/index.ts', 'export {};');
  });

  it('skips and writes nothing when the slice directory exists with unrelated content', () => {
    tree.write('src/features/checkout/index.ts', 'export const notOurs = true;');
    const before = tree.listChanges().length;
    const report = runFsdSlice(tree, 'features', { name: 'checkout' });
    expect(report.refused).toBe(false);
    expect(report.action).toBe('skipped');
    expect(tree.listChanges().length).toBe(before);
    expect(tree.read('src/features/checkout/index.ts', 'utf-8')).toBe('export const notOurs = true;');
  });

  it('skips when the slice directory has our expected files but with extra unrelated content', () => {
    const expected = expectedFiles('checkout');
    for (const file of expected) tree.write(file.filePath, file.content);
    tree.write('src/features/checkout/extra.ts', 'export const extra = 1;');
    const report = runFsdSlice(tree, 'features', { name: 'checkout' });
    expect(report.action).toBe('skipped');
  });
});

describe('runFsdSlice — exact-content match is unchanged', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
    tree.write('src/features/index.ts', 'export {};');
  });

  it('reports unchanged and writes nothing new when content already matches exactly', () => {
    const expected = expectedFiles('checkout');
    for (const file of expected) tree.write(file.filePath, file.content);
    const before = tree.listChanges().length;
    const report = runFsdSlice(tree, 'features', { name: 'checkout' });
    expect(report.action).toBe('unchanged');
    expect(tree.listChanges().length).toBe(before);
  });
});

describe('runFsdSlice — dryRun', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
    tree.write('src/features/index.ts', 'export {};');
  });

  it('previews the create without writing anything', () => {
    const before = tree.listChanges().length;
    const report = runFsdSlice(tree, 'features', { name: 'checkout', dryRun: true });
    expect(report.action).toBe('created');
    expect(tree.listChanges().length).toBe(before);
    expect(tree.exists('src/features/checkout')).toBe(false);
    expect(report.files).toEqual(expectedFiles('checkout'));
  });
});

describe('runFsdSlice — locale resolution', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
    tree.write('src/features/index.ts', 'export {};');
  });

  it('inherits locale from toolkit.config.json', () => {
    tree.write('toolkit.config.json', JSON.stringify({ locale: 'ko' }));
    runFsdSlice(tree, 'features', { name: 'checkout' });
    expect(tree.read('src/features/checkout/index.ts', 'utf-8')).toBe(expectedFiles('checkout', undefined, 'ko')[0].content);
  });

  it('explicit locale option beats config', () => {
    tree.write('toolkit.config.json', JSON.stringify({ locale: 'ko' }));
    runFsdSlice(tree, 'features', { name: 'checkout', locale: 'en' });
    expect(tree.read('src/features/checkout/index.ts', 'utf-8')).toBe(expectedFiles('checkout', undefined, 'en')[0].content);
  });

  it('falls back to en with no config at all', () => {
    runFsdSlice(tree, 'features', { name: 'checkout' });
    expect(tree.read('src/features/checkout/index.ts', 'utf-8')).toBe(expectedFiles('checkout', undefined, 'en')[0].content);
  });
});

describe('runFsdSlice — publicApiName', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
    tree.write('src/features/index.ts', 'export {};');
  });

  it('defaults to the camelCase form of name', () => {
    const report = runFsdSlice(tree, 'features', { name: 'add-to-cart' });
    expect(report.publicApiName).toBe('addToCart');
    expect(tree.read('src/features/add-to-cart/model/add-to-cart.ts', 'utf-8')).toContain('export function addToCart(): void {');
  });

  it('uses an explicit override instead of the camelCase default', () => {
    const report = runFsdSlice(tree, 'features', { name: 'add-to-cart', publicApiName: 'addItemToCart' });
    expect(report.publicApiName).toBe('addItemToCart');
    expect(tree.read('src/features/add-to-cart/model/add-to-cart.ts', 'utf-8')).toContain('export function addItemToCart(): void {');
  });
});

describe('runFsdSlice — entities layer (smoke)', () => {
  it('creates a slice under src/entities when the layer root exists', () => {
    const tree = appTree();
    tree.write('src/entities/index.ts', 'export {};');
    const report = runFsdSlice(tree, 'entities', { name: 'user' });
    expect(report.refused).toBe(false);
    expect(report.action).toBe('created');
    expect(report.directory).toBe('src/entities/user');
    expect(tree.exists('src/entities/user/index.ts')).toBe(true);
    expect(tree.exists('src/entities/user/model/user.spec.ts')).toBe(true);
  });

  it('creates the entities directory on the way when it does not exist yet', () => {
    const tree = appTree();
    const report = runFsdSlice(tree, 'entities', { name: 'user' });
    expect(report.refused).toBe(false);
    expect(tree.exists('src/entities/user/model/user.ts')).toBe(true);
  });
});

describe('runFsdSlice — shared layer (smoke)', () => {
  it('creates a slice under src/shared when the layer root exists', () => {
    const tree = appTree();
    tree.write('src/shared/index.ts', 'export {};');
    const report = runFsdSlice(tree, 'shared', { name: 'date-format' });
    expect(report.refused).toBe(false);
    expect(report.action).toBe('created');
    expect(report.directory).toBe('src/shared/date-format');
    expect(tree.exists('src/shared/date-format/index.ts')).toBe(true);
    expect(tree.exists('src/shared/date-format/date-format.spec.ts')).toBe(true);
  });

  it('a shared segment holds its stub next to the index — no model/ inside a segment', () => {
    const tree = appTree();
    runFsdSlice(tree, 'shared', { name: 'date-format' });
    expect(tree.exists('src/shared/date-format/date-format.ts')).toBe(true);
    expect(tree.exists('src/shared/date-format/model')).toBe(false);
  });

  it('refuses a segment named by essence (components, hooks, utils, types …) and suggests purpose names', () => {
    const tree = appTree();
    const report = runFsdSlice(tree, 'shared', { name: 'utils' });
    expect(report.refused).toBe(true);
    expect(report.refusalReason).toBe('segment-by-essence');
    expect(tree.exists('src/shared/utils')).toBe(false);
    expect(runFsdSlice(tree, 'shared', { name: 'ui' }).refused).toBe(false);
    // only shared is a segment layer — a feature may be called anything kebab-case
    expect(runFsdSlice(tree, 'features', { name: 'hooks' }).refused).toBe(false);
  });
});

describe('runFsdSlice — the frontend app holds the layers', () => {
  const app = (tree: Tree, dir: string) =>
    tree.write(`${dir}/package.json`, JSON.stringify({ name: dir.split('/').pop(), nx: { projectType: 'application' } }));

  it("creates the slice in the app's source root, never in the workspace root src/", () => {
    const tree = createTreeWithEmptyWorkspace();
    app(tree, 'apps/web');
    app(tree, 'apps/web-e2e');
    tree.write('apps/web/src/features/index.ts', 'export {};');
    const report = runFsdSlice(tree, 'features', { name: 'checkout' });
    expect(report.project).toBe('web');
    expect(report.directory).toBe('apps/web/src/features/checkout');
    expect(tree.exists('apps/web/src/features/checkout/index.ts')).toBe(true);
    expect(tree.exists('src')).toBe(false);
  });

  it('refuses an ambiguous workspace with the candidates, and --project picks one', () => {
    const tree = createTreeWithEmptyWorkspace();
    app(tree, 'apps/web');
    app(tree, 'apps/admin');
    tree.write('apps/admin/src/entities/index.ts', 'export {};');
    const refused = runFsdSlice(tree, 'entities', { name: 'user' });
    expect(refused.refusalReason).toBe('ambiguous-frontend');
    expect(refused.candidates).toEqual(['admin', 'web']);
    expect(runFsdSlice(tree, 'entities', { name: 'user', project: 'admin' }).action).toBe('created');
  });

  it('refuses an unknown --project and a workspace without a frontend app', () => {
    const tree = createTreeWithEmptyWorkspace();
    expect(runFsdSlice(tree, 'shared', { name: 'ui' }).refusalReason).toBe('no-frontend-app');
    expect(runFsdSlice(tree, 'shared', { name: 'ui', project: 'nope' }).refusalReason).toBe('project-not-found');
  });
});

describe('runFsdSlice — pages / widgets / --segments', () => {
  it('pages: the directory follows the frontend — pages/ on react-vite, _pages/ on next', () => {
    const vite = appTree();
    expect(runFsdSlice(vite, 'pages', { name: 'home' }).directory).toBe('src/pages/home');
    expect(vite.exists('src/pages/home/model/home.ts')).toBe(true);
    const next = appTree();
    next.write('toolkit.config.json', JSON.stringify({ frontend: 'next' }));
    const report = runFsdSlice(next, 'pages', { name: 'home' });
    expect(report.layerDir).toBe('src/_pages');
    expect(next.exists('src/_pages/home/index.ts')).toBe(true);
    expect(next.exists('src/pages')).toBe(false);
  });

  it('pages: without a recorded frontend, a next.config file in the app means next; --frontend overrides both', () => {
    const detected = appTree();
    detected.write('next.config.js', 'module.exports = {};\n');
    expect(runFsdSlice(detected, 'pages', { name: 'home' }).directory).toBe('src/_pages/home');
    expect(runFsdSlice(detected, 'pages', { name: 'about', frontend: 'react-vite' }).directory).toBe('src/pages/about');
    // a recorded backend-only axis says nothing about this app — detection decides
    const none = appTree();
    none.write('toolkit.config.json', JSON.stringify({ frontend: 'none' }));
    expect(runFsdSlice(none, 'pages', { name: 'home' }).directory).toBe('src/pages/home');
  });

  it('widgets: a plain layer directory (opt-in to the layer the Lite default leaves out)', () => {
    const tree = appTree();
    const report = runFsdSlice(tree, 'widgets', { name: 'header' });
    expect(report.action).toBe('created');
    expect(tree.exists('src/widgets/header/model/header.ts')).toBe(true);
  });

  it('--segments adds an index per extra segment and keeps the model stub; reruns stay unchanged', () => {
    const tree = appTree();
    const report = runFsdSlice(tree, 'features', { name: 'checkout', segments: ['ui', 'api'] });
    expect(report.action).toBe('created');
    expect(tree.exists('src/features/checkout/ui/index.ts')).toBe(true);
    expect(tree.exists('src/features/checkout/api/index.ts')).toBe(true);
    expect(tree.exists('src/features/checkout/model/checkout.ts')).toBe(true);
    expect(runFsdSlice(tree, 'features', { name: 'checkout', segments: ['ui', 'api'] }).action).toBe('unchanged');
    // a different segment set is a different slice: skipped, never merged
    expect(runFsdSlice(tree, 'features', { name: 'checkout', segments: ['ui'] }).action).toBe('skipped');
  });

  it('--segments is validated like segment names everywhere: shape, purpose, and not on shared', () => {
    const tree = appTree();
    const bad = runFsdSlice(tree, 'features', { name: 'checkout', segments: ['UI'] });
    expect(bad.refusalReason).toBe('invalid-segment');
    expect(bad.detail).toBe('UI');
    const essence = runFsdSlice(tree, 'entities', { name: 'user', segments: ['ui', 'hooks'] });
    expect(essence.refusalReason).toBe('segment-by-essence');
    expect(essence.detail).toBe('hooks');
    expect(runFsdSlice(tree, 'shared', { name: 'ui', segments: ['lib'] }).refusalReason).toBe('segments-on-shared');
    expect(tree.exists('src/features')).toBe(false);
    expect(tree.exists('src/shared')).toBe(false);
  });
});
