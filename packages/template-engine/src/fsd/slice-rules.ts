/** The layers the slice generators serve: the sliced layers hold slices (`widgets` only on
 * request — it is outside the Lite default scope); `shared` holds
 * segments (canonical FSD — it has no slices), scaffolded with the same generator shape. */
export type FsdSliceLayer = 'pages' | 'widgets' | 'features' | 'entities' | 'shared';

function toCamelCase(kebabName: string): string {
  return kebabName
    .split('-')
    .filter((part) => part.length > 0)
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

export function resolveSlicePublicApiName(name: string, publicApiName?: string): string {
  return publicApiName ?? toCamelCase(name);
}

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
// Reserved words (incl. strict-mode and module-context ones) that would make
// `export function <name>()` a syntax error even though they match the identifier pattern.
const RESERVED_WORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function',
  'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null',
  'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

export function isUsableSliceApiName(candidate: string): boolean {
  return IDENTIFIER_PATTERN.test(candidate) && !RESERVED_WORDS.has(candidate);
}

/** Segment names that say what a thing IS instead of what it is FOR. Canonical FSD (and
 * Steiger's `segments-by-purpose`) name segments by purpose — ui, api, model, lib, config —
 * so the `shared` generator refuses these. */
export const ESSENCE_SEGMENT_NAMES: readonly string[] = [
  'components', 'hooks', 'helpers', 'utils', 'types', 'constants', 'consts', 'interfaces',
  'enums', 'modals', 'stores', 'services',
];

export const PURPOSE_SEGMENT_EXAMPLES: readonly string[] = ['ui', 'api', 'model', 'lib', 'config'];

export function isEssenceSegmentName(name: string): boolean {
  return ESSENCE_SEGMENT_NAMES.includes(name);
}

/** A segment directory name: lowercase letters/digits with single hyphens (same shape as a
 * slice name — it becomes a directory and an import path). */
export const SEGMENT_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
