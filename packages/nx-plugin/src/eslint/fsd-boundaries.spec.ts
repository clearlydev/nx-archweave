import { Linter } from 'eslint';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { archweavePlugin, fsdBoundaries, resolveFsdPolicy } from './index.ts';
import { judge, locate } from './fsd-boundaries.ts';
import { aliasesFromTsconfig } from './tsconfig-aliases.ts';

// A frontend app the way Nx lays it out: ESLint runs from the project root (cwd) and the
// layers live under src/. Paths are absolute, as ESLint hands them to a rule.
const APP = '/ws/apps/web';

function lint(file: string, code: string, options: Parameters<typeof fsdBoundaries>[0] = {}): string[] {
  const linter = new Linter({ cwd: APP, configType: 'flat' });
  const config = [
    { languageOptions: { ecmaVersion: 2022 as const, sourceType: 'module' as const } },
    ...fsdBoundaries(options),
  ] as Linter.Config[];
  return linter.verify(code, config, { filename: `${APP}/${file}` }).map((m) => `${m.ruleId}: ${m.message}`);
}

describe('archweave/fsd-boundaries — the three findings', () => {
  it('upward: a layer may not import a layer above it', () => {
    const messages = lint('src/entities/product/model/product.js', "import { addToCart } from '../../../features/add-to-cart';");
    expect(messages).toEqual(['archweave/fsd-boundaries: FSD: "entities/product" may not import from "features/add-to-cart" (a higher layer).']);
    expect(lint('src/shared/ui/button.js', "import { product } from '../../entities/product';")).toHaveLength(1);
    expect(lint('src/pages/home/ui/home.js', "import { App } from '../../../app/app';")[0]).toMatch(/higher layer/);
  });

  it('cross-slice: slices on one sliced layer never import each other — the case plain ESLint rules miss', () => {
    const messages = lint('src/features/add-to-cart/model/cart.js', "import { signIn } from '../../sign-in';");
    expect(messages).toEqual([
      'archweave/fsd-boundaries: FSD: "features/add-to-cart" may not import a sibling slice "features/sign-in" — move the shared part down a layer, or expose it through "features/sign-in/@x/add-to-cart".',
    ]);
    expect(lint('src/entities/order/index.js', "export * from '../user';")).toHaveLength(1);
  });

  it('sidestep: another slice is imported through its index, never its internals', () => {
    const messages = lint('src/pages/home/ui/home.js', "import { secret } from '../../../features/sign-in/model/internal';");
    expect(messages).toEqual(['archweave/fsd-boundaries: FSD: import "features/sign-in" through its public API (index.ts), not its internal file "features/sign-in/model/internal".']);
    // shared segments carry a public API too
    expect(lint('src/features/sign-in/ui/form.js', "import { Button } from '../../../shared/ui/button';")[0]).toMatch(/public API/);
  });
});

describe('archweave/fsd-boundaries — what is allowed', () => {
  it('downward imports through a slice index, in every form the index can take', () => {
    expect(lint('src/features/add-to-cart/model/cart.js', "import { product } from '../../../entities/product';")).toEqual([]);
    expect(lint('src/features/add-to-cart/model/cart.js', "import { product } from '../../../entities/product/index';")).toEqual([]);
    expect(lint('src/features/add-to-cart/model/cart.js', "import { product } from '../../../entities/product/index.ts';")).toEqual([]);
    expect(lint('src/pages/home/index.js', "export { HomePage } from './ui/home'; import('../../features/add-to-cart');")).toEqual([]);
  });

  it("a slice's own internals, by relative path — the distinction that needs path resolution", () => {
    expect(lint('src/features/sign-in/ui/form.js', "import { secret } from '../model/internal';")).toEqual([]);
    expect(lint('src/features/sign-in/model/use.js', "import { signIn } from '../index';")).toEqual([]);
  });

  it("FSD's @x cross-import public API, for the named consumer only", () => {
    expect(lint('src/entities/order/model/order.js', "import { userForOrder } from '../../user/@x/order';")).toEqual([]);
    expect(lint('src/entities/cart/model/cart.js', "import { userForOrder } from '../../user/@x/order';")).toHaveLength(1);
  });

  it('app and shared are segment layers: segments import each other, shared ones through their index', () => {
    expect(lint('src/app/providers/router.js', "import { App } from '../app'; import { theme } from '../styles/theme';")).toEqual([]);
    expect(lint('src/shared/api/client.js', "import { config } from '../config'; import { log } from '../lib';")).toEqual([]);
    expect(lint('src/shared/api/client.js', "import { log } from '../lib/log/logger';")[0]).toMatch(/public API/);
  });

  it('package specifiers are never judged, even when they end in a layer name', () => {
    expect(lint('src/entities/product/model/api.js', "import { initializeApp } from 'firebase/app'; import React from 'react';")).toEqual([]);
  });

  it('files outside the layers (entry points, assets, tests setup) are ignored both ways', () => {
    expect(lint('src/main.js', "import { App } from './app/app'; import { Home } from './pages/home';")).toEqual([]);
    expect(lint('src/entities/product/model/product.js', "import { setup } from '../../../test-setup';")).toEqual([]);
    expect(lint('vite.config.js', "import { defineConfig } from 'vite';")).toEqual([]);
  });

  it('a segment folder inside a slice may be called "pages" without becoming the pages layer', () => {
    expect(lint('src/features/onboarding/index.js', "export { step } from './pages/step1';")).toEqual([]);
  });
});

describe('archweave/fsd-boundaries — Next.js', () => {
  it("resolves the template's @/ alias to src and names _pages as the pages layer", () => {
    expect(lint('src/entities/product/model/bad.js', "import { addToCart } from '@/features/add-to-cart';")[0]).toMatch(/higher layer/);
    expect(lint('src/_pages/home/ui/bad.js', "import Page from '@/app/page';")[0]).toMatch(/"pages\/home" may not import from "app"/);
    expect(lint('src/_pages/home/ui/bad.js', "import { secret } from '@/features/sign-in/model/internal';")[0]).toMatch(/public API/);
    expect(lint('src/_pages/home/index.js', "export { HomePage } from './ui/home'; import { addToCart } from '@/features/add-to-cart';")).toEqual([]);
  });

  it('a custom alias map and a custom root are honoured', () => {
    const options = { root: 'source', aliases: { '~/': 'source' } };
    const linter = new Linter({ cwd: APP, configType: 'flat' });
    const config = [{ languageOptions: { ecmaVersion: 2022 as const, sourceType: 'module' as const } }, ...fsdBoundaries(options)] as Linter.Config[];
    const messages = linter.verify("import { x } from '~/features/x';", config, { filename: `${APP}/source/entities/y/model/y.js` });
    expect(messages).toHaveLength(1);
    // under the custom root, the default src/ tree is outside the rule
    expect(linter.verify("import { x } from '../../../features/x';", config, { filename: `${APP}/src/entities/y/model/y.js` })).toEqual([]);
  });
});

describe('fsdBoundaries() flat-config entry', () => {
  it('carries the severity the preset chose and defaults to src with the @/ alias', () => {
    const [entry] = fsdBoundaries({ severity: 'warn' }) as { files: string[]; rules: Record<string, unknown[]> }[];
    expect(entry.files).toEqual(['src/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}']);
    expect(entry.rules['archweave/fsd-boundaries']).toEqual(['warn', { root: 'src', aliases: { '@/': 'src' }, policy: resolveFsdPolicy(undefined) }]);
  });
});

describe('locate / judge — pure core', () => {
  it('reads layer, unit and rest, dropping a trailing index file', () => {
    expect(locate('features/sign-in/model/internal.ts')).toEqual({ layer: 'features', unit: 'sign-in', rest: ['model', 'internal.ts'] });
    expect(locate('features/sign-in/index.ts')).toEqual({ layer: 'features', unit: 'sign-in', rest: [] });
    expect(locate('_pages/home')).toEqual({ layer: 'pages', unit: 'home', rest: [] });
    expect(locate('app/providers/router.tsx')).toEqual({ layer: 'app', unit: null, rest: ['providers', 'router.tsx'] });
    expect(locate('shared/ui/button.tsx')).toEqual({ layer: 'shared', unit: 'ui', rest: ['button.tsx'] });
    expect(locate('main.tsx')).toBeNull();
    expect(locate('components/x.ts')).toBeNull();
  });

  it('a bare layer directory as the target is only an upward check', () => {
    const from = locate('entities/user/index.ts')!;
    expect(judge(from, locate('features')!)?.kind).toBe('upward');
    expect(judge(from, locate('shared')!)).toBeNull();
  });
});

describe('aliases from tsconfig paths', () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
  const { tmpdir } = jest.requireActual<typeof import('node:os')>('node:os');
  const { join } = jest.requireActual<typeof import('node:path')>('node:path');

  function app(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'fsd-aliases-'));
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    return root;
  }

  function lintIn(cwd: string, file: string, code: string, options: Parameters<typeof fsdBoundaries>[0] = {}): string[] {
    const linter = new Linter({ cwd, configType: 'flat' });
    const config = [{ languageOptions: { ecmaVersion: 2022 as const, sourceType: 'module' as const } }, ...fsdBoundaries({ cwd, ...options })] as Linter.Config[];
    return linter.verify(code, config, { filename: join(cwd, file) }).map((m) => m.ruleId ?? '');
  }

  it("reads the app's paths (with comments and trailing commas), on top of the default @/ alias", () => {
    const cwd = app({
      'tsconfig.json': '{\n  // app aliases\n  "compilerOptions": {\n    "paths": {\n      "~/*": ["./src/*"],\n    },\n  },\n}\n',
    });
    try {
      expect(lintIn(cwd, 'src/entities/user/model/user.js', "import { x } from '~/features/x';")).toEqual(['archweave/fsd-boundaries']);
      expect(lintIn(cwd, 'src/entities/user/model/user.js', "import { x } from '@/features/x';")).toEqual(['archweave/fsd-boundaries']);
      expect(lintIn(cwd, 'src/entities/user/model/user.js', "import { x } from '~/shared/ui';")).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('follows extends, the nearer config winning, and resolves targets against that config\'s baseUrl', () => {
    const cwd = app({
      'base/tsconfig.base.json': '{ "compilerOptions": { "baseUrl": "..", "paths": { "#app/*": ["src/*"], "#lib/*": ["libs/*"] } } }\n',
      'tsconfig.json': '{ "extends": "./base/tsconfig.base.json", "compilerOptions": { "paths": { "#lib/*": ["./src/shared/*"] } } }\n',
    });
    try {
      expect(aliasesFromTsconfig({ cwd })).toEqual({ '#lib/': 'src/shared', '#app/': 'src' });
      // #lib now points inside shared: an upward import through it is caught…
      expect(lintIn(cwd, 'src/shared/ui/button.js', "import { x } from '#app/entities/x';")).toEqual(['archweave/fsd-boundaries']);
      // …and a sidestep through the override too
      expect(lintIn(cwd, 'src/features/f/model/f.js', "import { x } from '#lib/ui/button';")).toEqual(['archweave/fsd-boundaries']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('a missing or broken tsconfig, a package preset in extends, or tsconfig: false leave only the default alias', () => {
    const broken = app({ 'tsconfig.json': '{ not json' });
    const preset = app({ 'tsconfig.json': '{ "extends": "@tsconfig/node22/tsconfig.json", "compilerOptions": { "paths": { "@app/*": ["./src/*"] } } }\n' });
    try {
      expect(aliasesFromTsconfig({ cwd: broken })).toEqual({});
      expect(aliasesFromTsconfig({ cwd: '/nonexistent/dir' })).toEqual({});
      expect(aliasesFromTsconfig({ cwd: preset })).toEqual({ '@app/': 'src' });
      const [entry] = fsdBoundaries({ cwd: preset, tsconfig: false }) as { rules: Record<string, unknown[]> }[];
      // an explicit cwd anchors both, so the rule never depends on where ESLint was started
      expect(entry.rules['archweave/fsd-boundaries'][1]).toEqual({ root: join(preset, 'src'), aliases: { '@/': join(preset, 'src') }, policy: resolveFsdPolicy(undefined) });
    } finally {
      rmSync(broken, { recursive: true, force: true });
      rmSync(preset, { recursive: true, force: true });
    }
  });
});

it('the ESLint plugin meta.version matches package.json', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string };
  expect(archweavePlugin.meta.version).toBe(pkg.version);
});

describe('archweave/fsd-boundaries — paths resolve from the config directory, not the lint cwd', () => {
  const WS = '/ws';
  const WEB = '/ws/web';
  const CROSS = 'archweave/fsd-boundaries: FSD: "features/a" may not import a sibling slice "features/b" — move the shared part down a layer, or expose it through "features/b/@x/a".';

  /** ESLint started from `lintCwd` (the workspace root, as an editor or a root-level `eslint .`
   * does) with the app's config, which passes its own directory as `cwd`. */
  function lintFrom(lintCwd: string, file: string, code: string, options: Parameters<typeof fsdBoundaries>[0]): string[] {
    const linter = new Linter({ cwd: lintCwd, configType: 'flat' });
    const config = [
      { languageOptions: { ecmaVersion: 2022 as const, sourceType: 'module' as const } },
      // Linter matches `files` against its own cwd; a real run matches them against the config's directory.
      ...fsdBoundaries({ tsconfig: false, files: ['**/*.ts'], ...options }),
    ] as Linter.Config[];
    return linter.verify(code, config, { filename: file }).map((m) => `${m.ruleId}: ${m.message}`);
  }

  it('reports the same finding from the workspace root as from the app directory (source root = app root)', () => {
    const options = { cwd: WEB, root: '.' };
    const file = `${WEB}/features/a/model/a.ts`;
    const code = "import { b } from '../../b/model/b';";
    expect(lintFrom(WEB, file, code, options)).toEqual([CROSS]);
    expect(lintFrom(WS, file, code, options)).toEqual([CROSS]);
  });

  it('reports the same finding from the workspace root with a src/ source root', () => {
    const options = { cwd: WEB, root: 'src' };
    const file = `${WEB}/src/features/a/model/a.ts`;
    expect(lintFrom(WS, file, "import { b } from '../../b';", options)).toEqual([CROSS]);
  });

  it('resolves an alias that points above the source root (`@/*` → `./*`)', () => {
    const options = { cwd: WEB, root: 'src', aliases: { '@/': '.' } };
    const file = `${WEB}/src/features/a/model/a.ts`;
    expect(lintFrom(WS, file, "import { b } from '@/src/features/b';", options)).toEqual([CROSS]);
    expect(lintFrom(WS, file, "import { x } from '@/scripts/x';", options)).toEqual([]);
  });

  it('keeps build output out of a config whose source root is the app root', () => {
    const [entry] = fsdBoundaries({ cwd: WEB, root: '.' }) as { files: string[]; ignores?: string[] }[];
    expect(entry.files).toEqual(['**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}']);
    expect(entry.ignores).toEqual(expect.arrayContaining(['.next/**', 'dist/**', 'out/**', 'coverage/**']));
  });
});

describe('archweave/fsd-boundaries — policy: slice groups, shared public API, test files', () => {
  const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
  const os = jest.requireActual<typeof import('node:os')>('node:os');
  const RULE = 'archweave/fsd-boundaries';

  /** An app directory on disk (group detection reads it), with `files` under src/. */
  function appOnDisk(files: string[], toolkitConfig?: object): string {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'fsd-policy-'));
    for (const file of files) {
      fs.mkdirSync(join(dir, 'src', file, '..'), { recursive: true });
      fs.writeFileSync(join(dir, 'src', file), '');
    }
    if (toolkitConfig) fs.writeFileSync(join(dir, 'toolkit.config.json'), JSON.stringify(toolkitConfig));
    return dir;
  }

  function lintAt(dir: string, file: string, code: string, options: Parameters<typeof fsdBoundaries>[0] = {}): string[] {
    const linter = new Linter({ cwd: dir, configType: 'flat' });
    const config = [
      { languageOptions: { ecmaVersion: 2022 as const, sourceType: 'module' as const } },
      ...fsdBoundaries({ cwd: dir, tsconfig: false, ...options }),
    ] as Linter.Config[];
    return linter.verify(code, config, { filename: join(dir, 'src', file) }).map((m) => `${m.ruleId}: ${m.message}`);
  }

  const GROUPED = ['features/mypage/order/index.ts', 'features/mypage/order/model/order.ts', 'features/mypage/claims/index.ts', 'features/login/index.ts'];

  it('a group folder (no index, no files, slices with an index under it) holds separate slices', () => {
    const dir = appOnDisk(GROUPED);
    try {
      expect(lintAt(dir, 'features/mypage/order/model/order.ts', "import { c } from '../../claims';")).toEqual([
        `${RULE}: FSD: "features/mypage/order" may not import a sibling slice "features/mypage/claims" — move the shared part down a layer, or expose it through "features/mypage/claims/@x/order".`,
      ]);
      expect(lintAt(dir, 'pages/home/ui/home.ts', "import { o } from '../../../features/mypage/order';")).toEqual([]);
      expect(lintAt(dir, 'pages/home/ui/home.ts', "import { m } from '../../../features/mypage';")).toEqual([
        `${RULE}: FSD: "features/mypage" is a group of slices, not a slice — import one of its slices through its index.ts.`,
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a slice with only segment indexes is never mistaken for a group', () => {
    const dir = appOnDisk(['features/auth/ui/index.ts', 'features/auth/model/index.ts', 'features/auth/model/session.ts']);
    try {
      expect(lintAt(dir, 'features/auth/ui/form.ts', "import { s } from '../model';")).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sliceGroups: false turns groups off; include/exclude override the detection', () => {
    const dir = appOnDisk(GROUPED);
    try {
      const inside = (options: Parameters<typeof fsdBoundaries>[0]) =>
        lintAt(dir, 'features/mypage/order/model/order.ts', "import { c } from '../../claims';", options);
      expect(inside({ sliceGroups: false })).toEqual([]);
      expect(inside({ sliceGroups: { auto: true, include: [], exclude: ['features/mypage'] } })).toEqual([]);
      expect(inside({ sliceGroups: { auto: false, include: ['features/mypage'], exclude: [] } })).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('notices a group appearing while the process lives (an editor ESLint server)', () => {
    const dir = appOnDisk(['features/mypage/order/model/order.ts', 'features/mypage/claims/model/claims.ts']);
    try {
      const run = () => lintAt(dir, 'features/mypage/order/model/order.ts', "import { c } from '../../claims';");
      expect(run()).toEqual([]); // no slice has an index yet: mypage is a slice
      fs.writeFileSync(join(dir, 'src/features/mypage/claims/index.ts'), '');
      expect(run()).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['segment', "import { b } from '../../../shared/ui/button';", 1],
    ['component', "import { b } from '../../../shared/ui/button';", 0],
    ['component', "import { b } from '../../../shared/ui/button/ui/button';", 1],
    ['file', "import { f } from '../../../shared/lib/format/currency';", 0],
  ] as const)('sharedPublicApi: %s — %s', (sharedPublicApi, code, expected) => {
    const dir = appOnDisk([]);
    try {
      expect(lintAt(dir, 'features/a/model/a.ts', code, { sharedPublicApi })).toHaveLength(expected);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('testFiles: a spec may reach into another slice, but never upward', () => {
    const dir = appOnDisk([]);
    try {
      const options = { testFiles: ['**/*.spec.ts'] };
      expect(lintAt(dir, 'features/a/model/a.spec.ts', "import { b } from '../../b/model/b';", options)).toEqual([]);
      expect(lintAt(dir, 'entities/e/model/e.spec.ts', "import { f } from '../../../features/f';", options)).toHaveLength(1);
      expect(lintAt(dir, 'features/a/model/a.ts', "import { b } from '../../b/model/b';", options)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('platform index files (index.ios.tsx) are a public API', () => {
    const dir = appOnDisk([]);
    try {
      expect(lintAt(dir, 'pages/home/ui/home.ts', "import { b } from '../../../features/b/index.ios';", { platformSuffixes: ['ios'] })).toEqual([]);
      expect(lintAt(dir, 'pages/home/ui/home.ts', "import { b } from '../../../features/b/index.ios';")).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the policy from toolkit.config.json next to (or above) the config, presets first", () => {
    const dir = appOnDisk([], { fsd: { preset: 'practical' } });
    try {
      // practical: shared files are importable, spec files may cross slices
      expect(lintAt(dir, 'features/a/model/a.ts', "import { f } from '../../../shared/lib/format/currency';")).toEqual([]);
      expect(lintAt(dir, 'features/a/model/a.spec.ts', "import { b } from '../../b/model/b';")).toEqual([]);
      // an explicit option still wins
      expect(lintAt(dir, 'features/a/model/a.ts', "import { f } from '../../../shared/lib/format/currency';", { sharedPublicApi: 'segment' })).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('archweave/fsd-boundaries — group detection on existing layouts', () => {
  const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
  const os = jest.requireActual<typeof import('node:os')>('node:os');

  function lintOnDisk(files: string[], file: string, code: string): string[] {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'fsd-groups-'));
    try {
      for (const path of files) {
        fs.mkdirSync(join(dir, 'src', path, '..'), { recursive: true });
        fs.writeFileSync(join(dir, 'src', path), '');
      }
      const linter = new Linter({ cwd: dir, configType: 'flat' });
      const config = [{ languageOptions: { ecmaVersion: 2022 as const, sourceType: 'module' as const } }, ...fsdBoundaries({ cwd: dir, tsconfig: false })] as Linter.Config[];
      return linter.verify(code, config, { filename: join(dir, 'src', file) }).map((m) => m.message);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('a slice organised as components/ and hooks/ (each with an index) stays one slice', () => {
    const files = ['features/auth/components/index.ts', 'features/auth/components/login.tsx', 'features/auth/hooks/index.ts'];
    expect(lintOnDisk(files, 'features/auth/components/login.tsx', "import { useAuth } from '../hooks';")).toEqual([]);
  });

  it('a .DS_Store (or another dotfile) in a group folder does not undo the group', () => {
    const files = ['features/mypage/.DS_Store', 'features/mypage/order/index.ts', 'features/mypage/order/model/order.ts', 'features/mypage/claims/index.ts'];
    expect(lintOnDisk(files, 'features/mypage/order/model/order.ts', "import { c } from '../../claims';")).toHaveLength(1);
    expect(lintOnDisk(files, 'pages/home/ui/home.ts', "import { o } from '../../../features/mypage/order';")).toEqual([]);
  });
});

describe('archweave/fsd-boundaries — framework router folders', () => {
  it("a Next.js Pages Router's pages/ is the composition root, re-exporting _pages", () => {
    const options = { routerDirs: ['pages'] };
    expect(lint('src/pages/index.tsx', "export { HomePage as default } from '../_pages/home';", options)).toEqual([]);
    expect(lint('src/_pages/home/ui/home.tsx', "import x from '../../../pages/index';", options)).toHaveLength(1);
  });
});
