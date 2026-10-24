import type { FsdEnforcement, ToolkitFrontend, ToolkitLocale } from '@nx-archweave/shared';
import { buildFsdEslintEntry, buildFsdEslintImportLine, buildFsdEslintSnippet, buildFsdLayerGuide, FSD_ESLINT_MODULE, type FsdEslintFrameworkOptions } from '@nx-archweave/templates';
import { maskComments } from '../backend/eslint-boundaries.ts';
import { profileById } from '../frameworks/profiles.ts';

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

/** The `]` that closes the array opening at `open` (a `[`), skipping strings; -1 when unbalanced. */
function closingBracketOf(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < masked.length && masked[i] !== ch; i++) if (masked[i] === '\\') i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i;
  }
  return -1;
}

/** create-next-app's shape: `const eslintConfig = [...]` (or `= defineConfig([...])`) and
 * `export default eslintConfig;` — the index of the array's closing `]`, or -1. */
function namedConfigArrayEnd(masked: string): number {
  const exported = [...masked.matchAll(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/g)];
  if (exported.length !== 1) return -1;
  const declaration = new RegExp(`(?:const|let|var)\\s+${exported[0][1].replace(/\$/g, '\\$')}\\s*=\\s*(?:defineConfig\\s*\\(\\s*)?\\[`).exec(masked);
  if (declaration === null) return -1;
  return closingBracketOf(masked, declaration.index + declaration[0].length - 1);
}

/**
 * Inserts the import after the last import and the spread entry as the last element of the
 * config array. Recognised shapes: Nx's React and Next.js app configs (exactly one
 * `export default [`, the file ends with `];`) and create-next-app's (`const eslintConfig = [...]`
 * or `defineConfig([...])`, then `export default eslintConfig;`) — with none of our import yet.
 */
export function applyFsdEslintConfig(configText: string, severity: FsdEnforcement, root = 'src', framework: FsdEslintFrameworkOptions = {}): ApplyFsdEslintResult {
  if (classifyFsdEslintConfig(configText) === 'applied') return { status: 'already-applied' };
  const masked = maskComments(configText);
  EXPORT_DEFAULT_ARRAY.lastIndex = 0;
  const exportMatches = masked.match(EXPORT_DEFAULT_ARRAY) ?? [];
  const closing = CLOSING_BRACKET.exec(masked);
  const closingIndex = exportMatches.length === 1 && closing !== null ? closing.index : namedConfigArrayEnd(masked);
  if (closingIndex === -1) return { status: 'unrecognized' };

  const eol = configText.includes('\r\n') ? '\r\n' : '\n';

  // entry: before the closing bracket, indented like the config's elements (two spaces by
  // Nx convention; the element before decides whether a separating comma is needed)
  const before = configText.slice(0, closingIndex);
  const lastNonSpace = before.replace(/\s+$/, '');
  const needsComma = !lastNonSpace.endsWith(',') && !lastNonSpace.endsWith('[');
  const entryText = `${needsComma ? ',' : ''}${eol}  ${buildFsdEslintEntry(severity, root, framework)}${eol}`;
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

export function buildFsdEslintPasteSnippet(severity: FsdEnforcement, locale: ToolkitLocale, root = 'src', framework: FsdEslintFrameworkOptions = {}): string {
  return buildFsdEslintSnippet({ severity, locale, root, framework });
}

// --- layer guide (what add-fsd-lite prints instead of creating folders) ---

export type FsdLayer = 'app' | 'pages' | 'features' | 'entities' | 'shared';

/** The directory a layer lives in: its own name unless the framework's router owns that name. */
export function fsdLayerDirName(frontend: ToolkitFrontend, layer: FsdLayer): string {
  return profileById(frontend).layerDirs[layer] ?? layer;
}

export function fsdLayersFor(frontend: ToolkitFrontend): FsdLayer[] {
  return [...profileById(frontend).layers];
}

export function composeFsdLayerGuide({ frontend, sourceRoot, locale }: { frontend: ToolkitFrontend; sourceRoot: string; locale: ToolkitLocale }): string {
  const layers = fsdLayersFor(frontend);
  return buildFsdLayerGuide({ layers, directories: layers.map((layer) => fsdLayerDirName(frontend, layer)), sourceRoot, locale });
}
