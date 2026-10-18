import { resolveSlicePublicApiName, type FsdSliceLayer } from '@nx-archweave/template-engine';
import { composeSlice } from './core.ts';

function plan(o: {
  layer: FsdSliceLayer;
  name: string;
  locale?: 'en' | 'ko';
  sourceRoot?: string;
  layerDirName?: string;
  publicApiName?: string;
  segments?: string[];
}) {
  return composeSlice({
    layer: o.layer,
    name: o.name,
    locale: o.locale ?? 'en',
    sourceRoot: o.sourceRoot ?? 'src',
    layerDirName: o.layerDirName ?? o.layer,
    publicApiName: resolveSlicePublicApiName(o.name, o.publicApiName),
    segments: o.segments ?? [],
  });
}

const content = (p: ReturnType<typeof plan>, suffix: string) => p.files.find((f) => f.filePath.endsWith(suffix))!.content;

describe('composeSlice — a slice on a sliced layer', () => {
  it('derives the directory from layer and name and puts the stub in a model/ segment', () => {
    const p = plan({ layer: 'features', name: 'add-to-cart' });
    expect(p.directory).toBe('src/features/add-to-cart');
    expect(p.files.map((f) => f.filePath)).toEqual([
      'src/features/add-to-cart/index.ts',
      'src/features/add-to-cart/model/add-to-cart.ts',
      'src/features/add-to-cart/model/add-to-cart.spec.ts',
    ]);
  });

  it('places the slice under the given app source root', () => {
    const p = plan({ layer: 'entities', name: 'user', sourceRoot: 'apps/web/src' });
    expect(p.directory).toBe('apps/web/src/entities/user');
    expect(p.files[1].filePath).toBe('apps/web/src/entities/user/model/user.ts');
  });

  it('the index re-exports exactly what the model module defines, so the stub lints clean by construction', () => {
    const p = plan({ layer: 'features', name: 'add-to-cart' });
    expect(p.files[0].content).toContain("export { addToCart } from './model/add-to-cart';");
    expect(p.files[0].content).not.toContain('export function');
    expect(p.files[1].content).toContain('export function addToCart(): void {');
    expect(p.files[1].content).toMatch(/TODO/);
    expect(p.files[1].content).not.toMatch(/^import /m);
    expect(p.files[2].content).toContain("import { addToCart } from './add-to-cart.js';");
    expect(p.files[2].content).toContain("describe('add-to-cart'");
    expect(p.files[2].content).toContain('addToCart()');
  });

  it('uses the given public API name verbatim, even when it differs from the slice name', () => {
    const p = plan({ layer: 'features', name: 'class', publicApiName: 'classSlice' });
    expect(p.files[0].content).toContain("export { classSlice } from './model/class';");
    expect(p.files[1].content).toContain('export function classSlice(');
  });

  it('is deterministic and localised', () => {
    const en = plan({ layer: 'entities', name: 'user' });
    const ko = plan({ layer: 'entities', name: 'user', locale: 'ko' });
    expect(plan({ layer: 'entities', name: 'user' })).toEqual(en);
    for (const i of [0, 1, 2]) expect(ko.files[i].content).not.toBe(en.files[i].content);
    expect(ko.files[0].content).toContain('"user"의 공개 API ("entities" 레이어, FSD).');
    expect(ko.files[2].content).toContain("import { user } from './user.js';");
  });
});

describe('composeSlice — layer directory name and extra segments', () => {
  it('a pages slice lands in the directory it is given — _pages on Next.js', () => {
    expect(plan({ layer: 'pages', name: 'home', layerDirName: '_pages' }).directory).toBe('src/_pages/home');
    expect(plan({ layer: 'pages', name: 'home' }).directory).toBe('src/pages/home');
    expect(plan({ layer: 'widgets', name: 'header' }).directory).toBe('src/widgets/header');
  });

  it('extra segments get an index each, after the model files; model and duplicates are not doubled', () => {
    const p = plan({ layer: 'features', name: 'checkout', segments: ['ui', 'api', 'model', 'ui'] });
    expect(p.files.map((f) => f.filePath)).toEqual([
      'src/features/checkout/index.ts',
      'src/features/checkout/model/checkout.ts',
      'src/features/checkout/model/checkout.spec.ts',
      'src/features/checkout/ui/index.ts',
      'src/features/checkout/api/index.ts',
    ]);
    expect(p.files[0].content).toContain("export { checkout } from './model/checkout';");
  });

  it('a segment index names the segment and slice, states a known purpose, and exports nothing', () => {
    const p = plan({ layer: 'features', name: 'home', segments: ['ui', 'i18n'] });
    expect(content(p, 'ui/index.ts')).toContain('"ui" segment of the "home" slice — components, views and styles of this slice.');
    expect(content(p, 'ui/index.ts').trim().endsWith('export {};')).toBe(true);
    expect(content(p, 'i18n/index.ts')).toContain('"i18n" segment of the "home" slice.');
    const ko = plan({ layer: 'features', name: 'home', segments: ['api', 'i18n'], locale: 'ko' });
    expect(content(ko, 'api/index.ts')).toContain('요청과 데이터 매퍼');
    expect(content(ko, 'i18n/index.ts')).toContain('"i18n" 세그먼트.');
  });

  it('shared ignores segments — a segment holds no segments', () => {
    expect(plan({ layer: 'shared', name: 'api', segments: ['ui'] }).files).toHaveLength(3);
  });
});

describe('composeSlice — a shared segment', () => {
  it('holds no segments of its own: the stub sits next to the index', () => {
    const p = plan({ layer: 'shared', name: 'api' });
    expect(p.files.map((f) => f.filePath)).toEqual(['src/shared/api/index.ts', 'src/shared/api/api.ts', 'src/shared/api/api.spec.ts']);
    expect(p.files[0].content).toContain("export { api } from './api';");
    expect(p.files[0].content).toContain('"shared" layer');
  });
});
