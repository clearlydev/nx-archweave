import { Linter } from 'eslint';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { archweavePlugin, fsdBoundaries } from './index.ts';
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
    expect(entry.rules['archweave/fsd-boundaries']).toEqual(['warn', { root: 'src', aliases: { '@/': 'src' } }]);
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
      expect(entry.rules['archweave/fsd-boundaries'][1]).toEqual({ root: 'src', aliases: { '@/': 'src' } });
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
