import { posix, relative, resolve, sep } from 'node:path';

/**
 * `archweave/fsd-boundaries` — canonical FSD import rules inside one frontend app.
 * Three findings:
 *
 * - upward:      a layer imports a layer above it (app > pages > widgets > features > entities > shared)
 * - cross-slice: two slices on the same sliced layer import each other — unless through the
 *                target slice's `@x/<importer-slice>` public API (FSD's cross-import notation)
 * - sidestep:    a slice's (or a shared segment's) internal file is imported past its index
 *
 * Only relative specifiers and the configured aliases are judged; package specifiers
 * (`react`, `firebase/app`) are never touched — string-matching layer names in them was the
 * measured source of false positives. Locations are computed from path strings alone: the
 * rule never reads the file system.
 *
 * Self-contained on purpose: no `eslint` import, so the plugin's only runtime dependency stays
 * @nx/devkit. The handful of ESLint shapes it touches are typed structurally below.
 */

export type FsdEnforcementSeverity = 'error' | 'warn';

export interface FsdBoundariesOptions {
  /** The app's source root, relative to ESLint's cwd (Nx lints from the project root). */
  root: string;
  /** Import-prefix aliases → directories relative to cwd, e.g. `{ '@/': 'src' }`. */
  aliases: Record<string, string>;
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

/** Where a file sits inside the FSD tree. `unit` is the slice on a sliced layer, the segment
 * on `shared` (its segments carry a public API too), null on `app`. `rest` is the path below
 * the unit, with a trailing `index[.ext]` dropped. */
interface Location {
  layer: FsdLayer;
  unit: string | null;
  rest: string[];
}

const INDEX_FILE = /^index(\.[cm]?[jt]sx?)?$/;

export function locate(rootRelativePath: string): Location | null {
  const segments = rootRelativePath.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.length === 0) return null;
  const layer = LAYER_BY_DIR[segments[0]];
  if (layer === undefined) return null;
  const hasUnit = layer !== 'app';
  const unit = hasUnit ? (segments[1] ?? null) : null;
  const rest = segments.slice(hasUnit ? 2 : 1);
  if (rest.length > 0 && INDEX_FILE.test(rest[rest.length - 1])) rest.pop();
  return { layer, unit, rest };
}

export type FsdViolation =
  | { kind: 'upward'; from: Location; to: Location }
  | { kind: 'cross-slice'; from: Location; to: Location }
  | { kind: 'sidestep'; from: Location; to: Location };

/** Pure core: the violation (if any) of `from` importing `to`. */
export function judge(from: Location, to: Location): FsdViolation | null {
  if (LAYER_ORDER.indexOf(to.layer) < LAYER_ORDER.indexOf(from.layer)) return { kind: 'upward', from, to };
  if (to.unit === null) return null; // the app layer, or a bare layer directory — nothing finer to guard
  const sameUnit = from.layer === to.layer && from.unit === to.unit;
  if (sameUnit) return null; // inside one slice/segment anything goes
  const viaCrossImportApi = to.rest[0] === '@x' && to.rest[1] === from.unit && from.layer === to.layer;
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
      const targetAbsolute = resolve(options.cwd, target);
      const targetRootRelative = toPosix(relative(options.rootAbsolute, targetAbsolute));
      rootRelative = posix.normalize(posix.join(targetRootRelative === '' ? '.' : targetRootRelative, specifier.slice(prefix.length)));
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
        },
        additionalProperties: false,
      },
    ],
    messages: {
      upward: 'FSD: "{{from}}" may not import from "{{to}}" (a higher layer).',
      crossSlice: 'FSD: "{{from}}" may not import a sibling slice "{{to}}" — move the shared part down a layer, or expose it through "{{to}}/@x/{{fromUnit}}".',
      sidestep: 'FSD: import "{{to}}" through its public API (index.ts), not its internal file "{{path}}".',
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
    const from = locate(importerRootRelative);
    if (from === null) return {};

    const check = (node: AstNode, specifier: unknown): void => {
      if (typeof specifier !== 'string') return;
      const target = resolveSpecifier(specifier, importerRootRelative, { rootAbsolute, cwd, aliases });
      if (target === null) return;
      const to = locate(target);
      if (to === null) return;
      const violation = judge(from, to);
      if (violation === null) return;
      const data = { from: describeLocation(from), to: describeLocation(to), fromUnit: from.unit ?? '', path: target };
      context.report({
        node,
        messageId: violation.kind === 'upward' ? 'upward' : violation.kind === 'cross-slice' ? 'crossSlice' : 'sidestep',
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
