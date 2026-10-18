import type { FsdEnforcement, ToolkitFrontend, ToolkitLocale } from '@nx-archweave/shared';
import { buildFsdEslintEntry, buildFsdEslintImportLine, buildFsdEslintSnippet, buildFsdLayerGuide, FSD_ESLINT_MODULE } from '@nx-archweave/templates';
import { maskComments } from '../backend/eslint-boundaries.ts';

/**
 * The frontend app's eslint.config.mjs is where the FSD rule lives.
 * Same contract as the backend axis' root-config writer: recognition is deliberately
 * narrow, a mixed or hand-edited shape is never written to — the report degrades to the
 * paste-ready snippet instead.
 */

export type FsdEslintClassification = 'applied' | 'absent';

/** Doctor's read-only view: our import line, outside comments, means the rule is wired. */
export function classifyFsdEslintConfig(configText: string): FsdEslintClassification {
  return maskComments(configText).includes(FSD_ESLINT_MODULE) ? 'applied' : 'absent';
}

export type ApplyFsdEslintResult =
  | { status: 'applied'; text: string }
  | { status: 'already-applied' }
  | { status: 'unrecognized' };

const EXPORT_DEFAULT_ARRAY = /export\s+default\s+\[/g;
/** A top-level static import, single- or multi-line, ending in `from '...';`. */
const IMPORT_STATEMENT = /^import\b[^;]*?\bfrom\s+['"][^'"]+['"]\s*;?[ \t]*$/gm;
/** The config's closing `]` (optionally `;`), with nothing but whitespace after it. */
const CLOSING_BRACKET = /\]\s*;?\s*$/;

/**
 * Inserts the import after the last import and the spread entry as the last element of
 * `export default [...]`. Recognised shape (Nx's React and Next.js app configs): exactly one
 * `export default [`, the file ends with `];`, and none of our import yet.
 */
export function applyFsdEslintConfig(configText: string, severity: FsdEnforcement): ApplyFsdEslintResult {
  if (classifyFsdEslintConfig(configText) === 'applied') return { status: 'already-applied' };
  const masked = maskComments(configText);
  EXPORT_DEFAULT_ARRAY.lastIndex = 0;
  const exportMatches = masked.match(EXPORT_DEFAULT_ARRAY) ?? [];
  const closing = CLOSING_BRACKET.exec(masked);
  if (exportMatches.length !== 1 || closing === null) return { status: 'unrecognized' };

  const eol = configText.includes('\r\n') ? '\r\n' : '\n';
  const closingIndex = closing.index; // position of the final ']'

  // entry: before the closing bracket, indented like the config's elements (two spaces by
  // Nx convention; the element before decides whether a separating comma is needed)
  const before = configText.slice(0, closingIndex);
  const lastNonSpace = before.replace(/\s+$/, '');
  const needsComma = !lastNonSpace.endsWith(',') && !lastNonSpace.endsWith('[');
  const entryText = `${needsComma ? ',' : ''}${eol}  ${buildFsdEslintEntry(severity)}${eol}`;
  const withEntry = `${lastNonSpace}${entryText}${configText.slice(closingIndex)}`;

  // import: after the last top-level import, else at the very top
  IMPORT_STATEMENT.lastIndex = 0;
  let lastImportEnd = -1;
  const maskedWithEntry = maskComments(withEntry);
  for (let m = IMPORT_STATEMENT.exec(maskedWithEntry); m !== null; m = IMPORT_STATEMENT.exec(maskedWithEntry)) {
    lastImportEnd = m.index + m[0].length;
  }
  const importLine = buildFsdEslintImportLine();
  const text =
    lastImportEnd === -1
      ? `${importLine}${eol}${eol}${withEntry}`
      : `${withEntry.slice(0, lastImportEnd)}${eol}${importLine}${withEntry.slice(lastImportEnd)}`;
  return { status: 'applied', text };
}

export function buildFsdEslintPasteSnippet(severity: FsdEnforcement, locale: ToolkitLocale): string {
  return buildFsdEslintSnippet({ severity, locale });
}

// --- layer guide (what add-fsd-lite prints instead of creating folders) ---

export type FsdLayer = 'app' | 'pages' | 'features' | 'entities' | 'shared';

const REACT_VITE_LAYERS: FsdLayer[] = ['app', 'pages', 'features', 'entities', 'shared'];
const NEXT_LAYERS: FsdLayer[] = ['pages', 'features', 'entities', 'shared'];

/** The directory a layer lives in. Next.js reads `pages/` (and `app/`) under `src/` as its own
 * routers, so FSD's own Next.js guide prefixes those two layers there: `pages` → `_pages`.
 * (`app` is never a generator layer for Next.js — its App Router directory is the app layer.) */
export function fsdLayerDirName(frontend: ToolkitFrontend, layer: FsdLayer): string {
  return frontend === 'next' && (layer === 'pages' || layer === 'app') ? `_${layer}` : layer;
}

export function fsdLayersFor(frontend: ToolkitFrontend): FsdLayer[] {
  return frontend === 'next' ? [...NEXT_LAYERS] : [...REACT_VITE_LAYERS];
}

export function composeFsdLayerGuide({ frontend, sourceRoot, locale }: { frontend: ToolkitFrontend; sourceRoot: string; locale: ToolkitLocale }): string {
  const layers = fsdLayersFor(frontend);
  return buildFsdLayerGuide({ layers, directories: layers.map((layer) => fsdLayerDirName(frontend, layer)), sourceRoot, locale });
}
