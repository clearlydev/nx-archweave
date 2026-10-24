import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fsdBoundariesRule, type FsdBoundariesOptions, type FsdEnforcementSeverity } from './fsd-boundaries.ts';
import { aliasesFromTsconfig } from './tsconfig-aliases.ts';
import { readRecordedFsd, resolveFsdPolicy, type FsdPolicy } from './fsd-policy.ts';

export { fsdBoundariesRule, type FsdBoundariesOptions, type FsdEnforcementSeverity } from './fsd-boundaries.ts';
export { aliasesFromTsconfig } from './tsconfig-aliases.ts';
export { resolveFsdPolicy, type FsdPolicy, type FsdPreset } from './fsd-policy.ts';

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

export interface FsdBoundariesConfigOptions extends Partial<FsdPolicy> {
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
  /** The directory `root`, `aliases` and `tsconfig` are relative to: the config file's own
   * directory (`import.meta.dirname`), so the rule checks the same files whether ESLint runs
   * from the project (`nx lint`), the workspace root or an editor. Default `process.cwd()`. */
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
/** Build and tool output an app-root source root would otherwise sweep into the rule. */
const OUTPUT_DIRS = ['.next/**', '.expo/**', 'dist/**', 'out/**', 'build/**', 'coverage/**'];

export function fsdBoundaries(options: FsdBoundariesConfigOptions = {}): object[] {
  const root = options.root ?? 'src';
  const cwd = options.cwd ?? process.cwd();
  const fromTsconfig = options.aliases === undefined && options.tsconfig !== false ? aliasesFromTsconfig({ cwd, tsconfig: options.tsconfig }) : {};
  const aliases = options.aliases ?? { '@/': root, ...fromTsconfig };
  // With an explicit cwd the paths become absolute, so the rule never resolves them against the
  // cwd ESLint happened to start in. Without one they stay relative to ESLint's cwd, as before.
  const anchor = (dir: string): string => (options.cwd === undefined ? dir : resolve(options.cwd, dir));
  // toolkit.config.json's `fsd` (its preset, then its keys) — so editing that file changes what
  // the rule reports — then what this call passes.
  const { sliceGroups, sharedPublicApi, testFiles, segments, platformSuffixes, routerDirs } = options;
  const policy = resolveFsdPolicy(readRecordedFsd(cwd), { sliceGroups, sharedPublicApi, testFiles, segments, platformSuffixes, routerDirs });
  const ruleOptions: FsdBoundariesOptions = {
    root: anchor(root),
    aliases: Object.fromEntries(Object.entries(aliases).map(([prefix, dir]) => [prefix, anchor(dir)])),
    policy,
  };
  const rootGlob = posix.normalize(root.split(sep).join('/'));
  const atAppRoot = rootGlob === '.' || rootGlob === './';
  return [
    {
      name: 'nx-archweave/fsd-boundaries',
      files: options.files ?? [`${atAppRoot ? '' : `${rootGlob.replace(/\/$/, '')}/`}**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}`],
      ...(atAppRoot ? { ignores: OUTPUT_DIRS } : {}),
      plugins: { archweave: archweavePlugin },
      rules: { 'archweave/fsd-boundaries': [options.severity ?? 'error', ruleOptions] },
    },
  ];
}
