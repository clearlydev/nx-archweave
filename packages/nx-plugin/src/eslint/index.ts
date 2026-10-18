import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fsdBoundariesRule, type FsdBoundariesOptions, type FsdEnforcementSeverity } from './fsd-boundaries.ts';
import { aliasesFromTsconfig } from './tsconfig-aliases.ts';

export { fsdBoundariesRule, type FsdBoundariesOptions, type FsdEnforcementSeverity } from './fsd-boundaries.ts';
export { aliasesFromTsconfig } from './tsconfig-aliases.ts';

/** The plugin's own version, from the nearest package.json up from this file that is ours —
 * from source and from wherever the bundle inlines this module. */
function ownVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf-8')) as { name?: string; version?: string };
      if (pkg.name === '@clearlydev/nx-archweave' && pkg.version) return pkg.version;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('@clearlydev/nx-archweave: its own package.json was not found');
    dir = parent;
  }
}

/** The ESLint plugin object — `plugins: { archweave: archweavePlugin }`. */
export const archweavePlugin = {
  meta: { name: '@clearlydev/nx-archweave', version: ownVersion() },
  rules: { 'fsd-boundaries': fsdBoundariesRule },
};

export interface FsdBoundariesConfigOptions {
  /** `error` (Team preset) or `warn` (Solo / Quick Start). Default `error`. */
  severity?: FsdEnforcementSeverity;
  /** The app's source root, relative to the config file's directory. Default `src`. */
  root?: string;
  /** Import-prefix aliases → directories relative to the config file's directory. Default:
   * `{ '@/': <root> }` (the alias Nx's Next.js template ships) plus whatever the app's
   * tsconfig `paths` declare (see `tsconfig`). Passing this replaces both. */
  aliases?: Record<string, string>;
  /** The tsconfig whose `compilerOptions.paths` (and its `extends` chain) add to the default
   * aliases, relative to `cwd`. Default `tsconfig.json`; `false` turns the lookup off. */
  tsconfig?: string | false;
  /** The directory the config is evaluated from — Nx lints from the project root. Default
   * `process.cwd()`. */
  cwd?: string;
  /** Override the files the rule applies to. Default: everything under `root`. */
  files?: string[];
}

/**
 * The one flat-config entry add-fsd-lite adds to a frontend app's eslint.config.mjs:
 *
 *   import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';
 *   export default [...baseConfig, ...fsdBoundaries({ severity: 'error' })];
 */
export function fsdBoundaries(options: FsdBoundariesConfigOptions = {}): object[] {
  const root = options.root ?? 'src';
  const cwd = options.cwd ?? process.cwd();
  const fromTsconfig = options.aliases === undefined && options.tsconfig !== false ? aliasesFromTsconfig({ cwd, tsconfig: options.tsconfig }) : {};
  const ruleOptions: FsdBoundariesOptions = { root, aliases: options.aliases ?? { '@/': root, ...fromTsconfig } };
  return [
    {
      name: 'nx-archweave/fsd-boundaries',
      files: options.files ?? [`${root}/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}`],
      plugins: { archweave: archweavePlugin },
      rules: { 'archweave/fsd-boundaries': [options.severity ?? 'error', ruleOptions] },
    },
  ];
}
