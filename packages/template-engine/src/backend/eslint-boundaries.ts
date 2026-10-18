/**
 * Project-level boundary constraints — the backend axis' enforcement layer.
 * Three statuses rule everything here:
 *
 * - applied: the Nx-generated allow-all block was replaced with the scope
 *   constraints. Recognition is DELIBERATELY narrow — exactly one uncommented
 *   allow-all block, and none of our marker anywhere (a mixed state is not
 *   ours to judge).
 * - already-applied: our constraints are present and no allow-all leak
 *   remains; nothing to do (idempotent).
 * - unrecognized: anything else. By contract the caller never writes in this
 *   case — a user's hand-edited ESLint config is never corrupted, the report
 *   degrades to the paste-ready snippet instead.
 *
 * applyBoundaryConstraints is built ON TOP of classifyBoundaryConstraints —
 * writer and doctor share one classification, so they cannot disagree.
 */

export interface ScopeConstraint {
  sourceTag: string;
  onlyDependOnLibsWithTags?: string[];
  notDependOnLibsWithTags?: string[];
}

/**
 * Deny-list scheme: the fullstack template
 * ships a rich lib graph with its own tags (scope:shop, scope:api, ...), so an
 * allow-list (frontend may ONLY see shared) would lint-break the template's
 * internal imports. What the moat actually promises is narrower and sharper:
 * the two sides must not import each other, and shared stays side-free.
 * enforce-module-boundaries applies every matching constraint conjunctively,
 * so these ride on top of the allow-all baseline without touching anything
 * else in the user's graph.
 */
export const SCOPE_CONSTRAINTS: readonly ScopeConstraint[] = [
  { sourceTag: 'scope:frontend', notDependOnLibsWithTags: ['scope:backend'] },
  { sourceTag: 'scope:backend', notDependOnLibsWithTags: ['scope:frontend'] },
  { sourceTag: 'scope:shared', notDependOnLibsWithTags: ['scope:frontend', 'scope:backend'] },
];

/** Root ESLint flat-config filenames, in lookup order. Shared by the writer
 * (add-backend) and the checker (doctor) so both always inspect the same file. */
export const ESLINT_CONFIG_CANDIDATES = ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs'] as const;

const APPLIED_MARKER = "sourceTag: 'scope:frontend'";

/** The exact depConstraints block a fresh Nx workspace ships: a single
 * allow-all entry. Whitespace is tolerated, nothing else is. */
const ALLOW_ALL_BLOCK =
  /depConstraints:\s*\[\s*\{\s*sourceTag:\s*'\*',\s*onlyDependOnLibsWithTags:\s*\[\s*'\*'\s*\],?\s*\},?\s*\]/g;

/**
 * Blanks out `//` line comments and block comments with same-length spaces, so
 * detection never fires on commented-out code while every match index still
 * points into the ORIGINAL text. String-aware by necessity: Nx configs are
 * full of glob literals whose characters look exactly like comment delimiters
 * (a double-star glob contains both an opener and a closer), so a naive regex
 * mask would blank out live code — a quote-tracking scan keeps strings intact.
 */
export function maskComments(text: string): string {
  const out = text.split('');
  let mode: 'code' | 'string' | 'line' | 'block' = 'code';
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const d = text[i + 1];
    if (mode === 'code') {
      if (c === "'" || c === '"' || c === '`') {
        mode = 'string';
        quote = c;
      } else if (c === '/' && d === '/') {
        mode = 'line';
        out[i] = ' ';
      } else if (c === '/' && d === '*') {
        mode = 'block';
        out[i] = ' ';
      }
    } else if (mode === 'string') {
      if (c === '\\') {
        i++;
      } else if (c === quote) {
        mode = 'code';
      }
    } else if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
      } else {
        out[i] = ' ';
      }
    } else {
      // block comment
      if (c === '*' && d === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i++;
        mode = 'code';
      } else if (c !== '\n') {
        out[i] = ' ';
      }
    }
  }
  return out.join('');
}

function findAllowAllMatches(masked: string): { index: number; length: number }[] {
  const matches: { index: number; length: number }[] = [];
  ALLOW_ALL_BLOCK.lastIndex = 0;
  for (let m = ALLOW_ALL_BLOCK.exec(masked); m !== null; m = ALLOW_ALL_BLOCK.exec(masked)) {
    matches.push({ index: m.index, length: m[0].length });
  }
  return matches;
}

export type BoundaryClassification = 'enforced' | 'allow-all' | 'unknown';

/** Doctor's read-only view (the boundary-constraints-applied check). Comments
 * are masked first. The marker OUTRANKS a wildcard block: under conjunctive
 * constraint semantics our deny rules enforce even when an allow-all baseline
 * coexists — the baseline is deliberately part of the applied shape. */
export function classifyBoundaryConstraints(configText: string): BoundaryClassification {
  const masked = maskComments(configText);
  if (masked.includes(APPLIED_MARKER)) return 'enforced';
  if (findAllowAllMatches(masked).length > 0) return 'allow-all';
  return 'unknown';
}

function renderConstraintsBlock(indent: string, eol: string): string {
  const renderList = (tags: string[]): string => tags.map((t) => `'${t}'`).join(', ');
  const inner = SCOPE_CONSTRAINTS.map((c) => {
    const field = c.notDependOnLibsWithTags
      ? `notDependOnLibsWithTags: [${renderList(c.notDependOnLibsWithTags)}]`
      : `onlyDependOnLibsWithTags: [${renderList(c.onlyDependOnLibsWithTags ?? [])}]`;
    return [`${indent}  {`, `${indent}    sourceTag: '${c.sourceTag}',`, `${indent}    ${field},`, `${indent}  },`].join(eol);
  }).join(eol);
  return [
    `// nx-archweave boundaries — the frontend and the backend may never import each other`,
    `${indent}depConstraints: [`,
    inner,
    [
      `${indent}  // baseline: everything else stays allowed (constraints apply conjunctively)`,
      `${indent}  {`,
      `${indent}    sourceTag: '*',`,
      `${indent}    onlyDependOnLibsWithTags: ['*'],`,
      `${indent}  },`,
    ].join(eol),
    `${indent}]`,
  ].join(eol);
}

export type ApplyBoundaryResult =
  | { status: 'applied'; text: string }
  | { status: 'already-applied' }
  | { status: 'unrecognized' };

export function applyBoundaryConstraints(configText: string): ApplyBoundaryResult {
  const classification = classifyBoundaryConstraints(configText);
  if (classification === 'enforced') return { status: 'already-applied' };
  if (classification === 'unknown') return { status: 'unrecognized' };

  // classification === 'allow-all' (and no marker, or classify would have said
  // enforced): rewrite only the unambiguous state — exactly one uncommented
  // allow-all block.
  const masked = maskComments(configText);
  const matches = findAllowAllMatches(masked);
  if (matches.length !== 1) {
    return { status: 'unrecognized' };
  }

  const [match] = matches;
  const eol = configText.includes('\r\n') ? '\r\n' : '\n';
  const lineStart = configText.lastIndexOf('\n', match.index) + 1;
  const indent = /^[ \t]*/.exec(configText.slice(lineStart, match.index))?.[0] ?? '';
  const replacement = renderConstraintsBlock(indent, eol);
  const text = configText.slice(0, match.index) + replacement + configText.slice(match.index + match.length);
  return { status: 'applied', text };
}

/** Paste-ready report-only snippet for the non-write paths. */
export function buildBoundarySnippet(): string {
  // Rendered in the exact shape applyBoundaryConstraints writes: pasting it must
  // satisfy APPLIED_MARKER, or doctor keeps reporting 'not enforced' to a user who
  // followed its own suggestion.
  return [
    '// nx-archweave project boundaries — merge these entries into the depConstraints',
    "// array of the '@nx/enforce-module-boundaries' rule in your root ESLint config.",
    '// They ride on top of your existing entries: constraints apply conjunctively,',
    '// so the allow-all baseline can stay.',
    renderConstraintsBlock('', '\n'),
  ].join('\n');
}
