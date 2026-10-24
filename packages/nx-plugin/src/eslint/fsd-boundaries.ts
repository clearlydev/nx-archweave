import { posix, relative, resolve, sep } from 'node:path';
import { globToRegExp, resolveFsdPolicy, type FsdPolicy } from './fsd-policy.ts';
import { createGroupDetector } from './slice-groups.ts';

/**
 * `archweave/fsd-boundaries` — canonical FSD import rules inside one frontend app.
 * Three findings:
 *
 * - upward:      a layer imports a layer above it (app > pages > widgets > features > entities > shared)
 * - cross-slice: two slices on the same sliced layer import each other — unless through the
 *                target slice's `@x/<importer-slice>` public API (FSD's cross-import notation)
 * - sidestep:    a slice's (or a shared segment's) internal file is imported past its index
 *                (or a folder that only groups slices is imported as if it were one)
 *
 * Only relative specifiers and the configured aliases are judged; package specifiers
 * (`react`, `firebase/app`) are never touched — string-matching layer names in them was the
 * measured source of false positives. Locations come from path strings, plus one look at the
 * file system for slice groups (`slice-groups.ts`); everything else follows the policy
 * (`fsd-policy.ts`).
 *
 * Self-contained on purpose: no `eslint` import, so the plugin's only runtime dependency stays
 * @nx/devkit. The handful of ESLint shapes it touches are typed structurally below.
 */

export type FsdEnforcementSeverity = 'error' | 'warn';

export interface FsdBoundariesOptions {
  /** The app's source root: absolute (what `fsdBoundaries` passes), or relative to ESLint's cwd. */
  root: string;
  /** Import-prefix aliases → directories, absolute or relative to ESLint's cwd, e.g. `{ '@/': 'src' }`. */
  aliases: Record<string, string>;
  /** How the tree is read; omitted keys take the `basic` preset's values. */
  policy?: Partial<FsdPolicy>;
}

const LAYER_ORDER = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'] as const;
type FsdLayer = (typeof LAYER_ORDER)[number];

/** Directory name → layer. `_app`/`_pages` are FSD's own Next.js naming (its routers own
 * `app/` and `pages/`). */
const LAYER_BY_DIR: Record<string, FsdLayer> = {
  app: 'app',
  _app: 'app',
  pages: 'pages',
  _pages: 'pages',
  widgets: 'widgets',
  features: 'features',
  entities: 'entities',
  shared: 'shared',
};

const SLICED_LAYERS: ReadonlySet<FsdLayer> = new Set(['pages', 'widgets', 'features', 'entities']);

/** Where a file sits inside the FSD tree. `unit` is the slice on a sliced layer (`<group>/<slice>`
 * inside a slice group), the public-API unit on `shared` (its segments carry a public API too),
 * null on `app`. `rest` is the path below the unit, with a trailing `index[.ext]` dropped.
 * `group` marks a path that stops at a slice-group folder. */
interface Location {
  layer: FsdLayer;
  unit: string | null;
  rest: string[];
  group?: true;
}

export function indexFilePattern(platformSuffixes: string[]): RegExp {
  const platforms = platformSuffixes.length === 0 ? '' : `(\\.(${platformSuffixes.map((suffix) => suffix.replace(/[^a-z0-9-]/gi, '')).join('|')}))?`;
  return new RegExp(`^index${platforms}(\\.[cm]?[jt]sx?)?$`);
}

const DEFAULT_POLICY = resolveFsdPolicy(undefined);
const NO_GROUPS = (): boolean => false;

/** `isGroup(layerDir, name)` says whether a folder on a sliced layer only groups slices. */
export function locate(
  rootRelativePath: string,
  policy: FsdPolicy = DEFAULT_POLICY,
  isGroup: (layerDir: string, name: string) => boolean = NO_GROUPS,
): Location | null {
  const segments = rootRelativePath.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.length === 0) return null;
  const layer = policy.routerDirs.includes(segments[0]) ? 'app' : LAYER_BY_DIR[segments[0]];
  if (layer === undefined) return null;

  let unit: string | null;
  let rest: string[];
  if (layer === 'app') {
    unit = null;
    rest = segments.slice(1);
  } else if (layer === 'shared') {
    const component = policy.sharedPublicApi === 'component' && segments.length > 2;
    unit = segments[1] === undefined ? null : component ? `${segments[1]}/${segments[2]}` : segments[1];
    rest = policy.sharedPublicApi === 'file' ? [] : segments.slice(component ? 3 : 2);
  } else if (segments[1] !== undefined && isGroup(segments[0], segments[1])) {
    if (segments[2] === undefined) return { layer, unit: segments[1], rest: [], group: true };
    unit = `${segments[1]}/${segments[2]}`;
    rest = segments.slice(3);
  } else {
    unit = segments[1] ?? null;
    rest = segments.slice(2);
  }
  if (rest.length > 0 && indexFilePattern(policy.platformSuffixes).test(rest[rest.length - 1])) rest.pop();
  return { layer, unit, rest };
}

export type FsdViolation =
  | { kind: 'upward'; from: Location; to: Location }
  | { kind: 'cross-slice'; from: Location; to: Location }
  | { kind: 'sidestep'; from: Location; to: Location }
  | { kind: 'group'; from: Location; to: Location };

/** Pure core: the violation (if any) of `from` importing `to`. */
export function judge(from: Location, to: Location): FsdViolation | null {
  if (LAYER_ORDER.indexOf(to.layer) < LAYER_ORDER.indexOf(from.layer)) return { kind: 'upward', from, to };
  if (to.unit === null) return null; // the app layer, or a bare layer directory — nothing finer to guard
  if (to.group) return { kind: 'group', from, to }; // a group has no public API of its own
  const sameUnit = from.layer === to.layer && from.unit === to.unit;
  if (sameUnit) return null; // inside one slice/segment anything goes
  // `@x/<importer>`: the importer's slice name, which inside a group is the last part of its unit
  const importerSlice = from.unit?.split('/').pop();
  const viaCrossImportApi = to.rest[0] === '@x' && to.rest[1] === importerSlice && from.layer === to.layer;
  if (viaCrossImportApi) return null;
  if (from.layer === to.layer && SLICED_LAYERS.has(to.layer)) return { kind: 'cross-slice', from, to };
  if (to.rest.length > 0) return { kind: 'sidestep', from, to };
  return null;
}

export function describeLocation(location: Location): string {
  return location.unit === null ? location.layer : `${location.layer}/${location.unit}`;
}

/** Resolves an import specifier to a path relative to the source root, or null when it is
 * a package specifier or lands outside the root. */
export function resolveSpecifier(
  specifier: string,
  importerRootRelative: string,
  options: { rootAbsolute: string; cwd: string; aliases: Record<string, string> },
): string | null {
  let rootRelative: string | null = null;
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..') {
    rootRelative = posix.normalize(posix.join(posix.dirname(importerRootRelative), specifier));
  } else {
    for (const [prefix, target] of Object.entries(options.aliases)) {
      if (!specifier.startsWith(prefix)) continue;
      // Resolved as a path first: an alias may point above the source root (`@/*` → `./*`
      // with the layers in `src/`), and only the full path says whether it lands inside.
      const absolute = resolve(resolve(options.cwd, target), specifier.slice(prefix.length));
      rootRelative = toPosix(relative(options.rootAbsolute, absolute)) || '.';
      break;
    }
  }
  if (rootRelative === null) return null;
  if (rootRelative === '..' || rootRelative.startsWith('../')) return null;
  return rootRelative;
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

// --- ESLint surface, typed structurally (no `eslint` import) ---

export interface SourceNode {
  type: string;
  value?: unknown;
}
export interface AstNode {
  type: string;
  source?: SourceNode | null;
  arguments?: AstNode[];
}
export interface RuleContext {
  filename: string;
  cwd: string;
  options: unknown[];
  report(descriptor: { node: AstNode; messageId: string; data?: Record<string, string> }): void;
}

export const fsdBoundariesRule = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Enforce canonical Feature-Sliced Design import rules inside a frontend app',
      url: 'https://github.com/clearlydev/nx-archweave#fsd-lite',
    },
    schema: [
      {
        type: 'object',
        properties: {
          root: { type: 'string' },
          aliases: { type: 'object', additionalProperties: { type: 'string' } },
          policy: { type: 'object' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      upward: 'FSD: "{{from}}" may not import from "{{to}}" (a higher layer).',
      crossSlice: 'FSD: "{{from}}" may not import a sibling slice "{{to}}" — move the shared part down a layer, or expose it through "{{to}}/@x/{{fromUnit}}".',
      sidestep: 'FSD: import "{{to}}" through its public API (index.ts), not its internal file "{{path}}".',
      group: 'FSD: "{{to}}" is a group of slices, not a slice — import one of its slices through its index.ts.',
    },
  },
  create(context: RuleContext) {
    const options = (context.options[0] ?? {}) as Partial<FsdBoundariesOptions>;
    const root = options.root ?? 'src';
    const aliases = options.aliases ?? { '@/': root };
    const cwd = context.cwd;
    const rootAbsolute = resolve(cwd, root);
    const importerRootRelative = toPosix(relative(rootAbsolute, context.filename));
    if (importerRootRelative === '' || importerRootRelative.startsWith('..')) return {};
    const policy = resolveFsdPolicy(undefined, options.policy ?? {});
    const isIndexFile = (name: string): boolean => indexFilePattern(policy.platformSuffixes).test(name);
    const isGroup = createGroupDetector(rootAbsolute, policy, isIndexFile);
    const from = locate(importerRootRelative, policy, isGroup);
    if (from === null) return {};
    // A test file may reach into another slice's internals; it still may not import upward.
    const isTestFile = policy.testFiles !== false && policy.testFiles.some((glob) => globToRegExp(glob).test(importerRootRelative));

    const check = (node: AstNode, specifier: unknown): void => {
      if (typeof specifier !== 'string') return;
      const target = resolveSpecifier(specifier, importerRootRelative, { rootAbsolute, cwd, aliases });
      if (target === null) return;
      const to = locate(target, policy, isGroup);
      if (to === null) return;
      const violation = judge(from, to);
      if (violation === null || (isTestFile && violation.kind !== 'upward')) return;
      const data = { from: describeLocation(from), to: describeLocation(to), fromUnit: from.unit?.split('/').pop() ?? '', path: target };
      context.report({
        node,
        messageId: violation.kind === 'cross-slice' ? 'crossSlice' : violation.kind,
        data,
      });
    };

    const fromSource = (node: AstNode): void => check(node, node.source?.value);
    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression: (node: AstNode) => {
        const argument = node.source as SourceNode | undefined;
        if (argument && argument.type === 'Literal') check(node, argument.value);
      },
    };
  },
};
