import {
  sharedTypesApiTypesContent,
  sharedTypesIndexContent,
  sharedTypesPackageJsonContent,
} from '@nx-archweave/templates';
import { DEFAULT_BOUNDARY_TAGS, type BoundaryTags } from './eslint-boundaries.ts';

/**
 * Pure assembly for the backend wiring (shape confirmed by E2E): the shared-types
 * file set (a package.json workspace project — the same shape the fullstack
 * template's own libs use), the import package name, the role→tag mapping, and
 * the pnpm-workspace glob registration. All content literals live in
 * @nx-archweave/templates (thin-adapter invariant).
 */

export interface BackendWiringFile {
  filePath: string;
  content: string;
}

export interface BackendWiring {
  sharedTypesFiles: BackendWiringFile[];
  /** The package name AND the import specifier: the workspace link is the
   * wiring. A scoped workspace keeps its scope (`@org/source` →
   * `@org/shared-types`); a bare name gains one (`my-app` →
   * `@my-app/shared-types`). */
  sharedTypesPackageName: string;
  /** Where the lib lives, relative to the workspace root. */
  sharedTypesRoot: string;
  tagByRole: BoundaryTags;
}

export const DEFAULT_SHARED_TYPES_ROOT = 'libs/shared-types';

/** `sharedTypes` from a toolkit config object: `false` for none, else where the lib goes and
 * (optionally) its import path. */
export function readSharedTypesConfig(config: Record<string, unknown> | null | undefined): false | { path: string; importPath?: string } {
  const value = config?.['sharedTypes'];
  if (value === false) return false;
  if (typeof value !== 'object' || value === null) return { path: DEFAULT_SHARED_TYPES_ROOT };
  const record = value as Record<string, unknown>;
  const path = typeof record['path'] === 'string' && record['path'].trim() !== '' ? record['path'].replace(/\/+$/, '') : DEFAULT_SHARED_TYPES_ROOT;
  const importPath = typeof record['importPath'] === 'string' && record['importPath'].trim() !== '' ? record['importPath'] : undefined;
  return importPath === undefined ? { path } : { path, importPath };
}

export function composeBackendWiring(input: {
  workspaceName: string;
  tags?: BoundaryTags;
  sharedTypes?: { path: string; importPath?: string };
}): BackendWiring {
  const scoped = /^@([^/]+)\//.exec(input.workspaceName);
  const scope = scoped ? `@${scoped[1]}` : `@${input.workspaceName.split('/').pop() || 'workspace'}`;
  const sharedTypesRoot = input.sharedTypes?.path ?? DEFAULT_SHARED_TYPES_ROOT;
  const sharedTypesPackageName = input.sharedTypes?.importPath ?? `${scope}/shared-types`;
  const tagByRole = input.tags ?? DEFAULT_BOUNDARY_TAGS;
  return {
    sharedTypesFiles: [
      { filePath: `${sharedTypesRoot}/package.json`, content: sharedTypesPackageJsonContent(sharedTypesPackageName, tagByRole.shared) },
      { filePath: `${sharedTypesRoot}/src/index.ts`, content: sharedTypesIndexContent() },
      { filePath: `${sharedTypesRoot}/src/lib/api-types.ts`, content: sharedTypesApiTypesContent() },
    ],
    sharedTypesPackageName,
    sharedTypesRoot,
    tagByRole,
  };
}

export type WorkspaceGlobResult = { status: 'added'; text: string } | { status: 'present' } | { status: 'unrecognized' };

/**
 * npm counterpart of the pnpm transform: registers
 * libs/shared-types in the root package.json's "workspaces". Supports the
 * array form and the object form ({"packages": [...]}); anything else —
 * non-object JSON, a string field, unparseable text — is 'unrecognized' and
 * never written.
 *
 * The write is line-surgical: only the array gets one more entry
 * (or the field is added as the last root key), in the array's own style —
 * one entry per line, or inline — so every other byte of the file, CRLF line
 * endings included, stays as it was. Should the text defeat the scanner
 * (which the JSON.parse above makes unlikely), it falls back to re-serializing,
 * which is correct but rewrites the whole file.
 */
export function addSharedTypesNpmWorkspace(packageJsonText: string, entry: string = DEFAULT_SHARED_TYPES_ROOT): WorkspaceGlobResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return { status: 'unrecognized' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'unrecognized' };
  const pkg = parsed as Record<string, unknown>;
  const field = pkg['workspaces'];
  let target: unknown[];
  if (field === undefined) {
    target = [];
  } else if (Array.isArray(field)) {
    target = field;
  } else if (field !== null && typeof field === 'object' && Array.isArray((field as { packages?: unknown }).packages)) {
    target = (field as { packages: unknown[] }).packages;
  } else {
    return { status: 'unrecognized' };
  }
  const parentGlob = `${entry.split('/').slice(0, -1).join('/')}/*`;
  if (target.some((existing) => existing === entry || existing === parentGlob)) return { status: 'present' };

  const surgical = insertSharedTypesWorkspace(packageJsonText, field === undefined ? 'absent' : Array.isArray(field) ? 'array' : 'object', JSON.stringify(entry));
  if (surgical !== null) return { status: 'added', text: surgical };

  // fallback: correct JSON, noisy diff
  if (field === undefined) pkg['workspaces'] = target;
  target.push(entry);
  // [ \t]+ on purpose: \s+ would swallow blank lines before the first key.
  const indent = /\n([ \t]+)"/.exec(packageJsonText)?.[1] ?? '  ';
  const trailing = packageJsonText.endsWith('\n') ? '\n' : '';
  return { status: 'added', text: `${JSON.stringify(pkg, null, indent)}${trailing}` };
}

/** Index just past the JSON value starting at `start` (a string, or a bracketed value). */
function skipJsonValue(text: string, start: number): number {
  if (text[start] === '"') {
    let i = start + 1;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    return i + 1;
  }
  if (text[start] === '[' || text[start] === '{') {
    let depth = 0;
    let i = start;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        i = skipJsonValue(text, i);
        continue;
      }
      if (c === '[' || c === '{') depth++;
      if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return -1;
  }
  // a literal: number, true, false, null
  const literal = /^[^,}\]\s]+/.exec(text.slice(start));
  return literal ? start + literal[0].length : -1;
}

/** The members of the object starting at `open` ('{'), with each key's value span. */
function objectMembers(text: string, open: number): { key: string; valueStart: number; valueEnd: number }[] | null {
  const members: { key: string; valueStart: number; valueEnd: number }[] = [];
  let i = open + 1;
  for (;;) {
    while (/[\s,]/.test(text[i] ?? '')) i++;
    if (text[i] === '}') return members;
    if (text[i] !== '"') return null;
    const keyEnd = skipJsonValue(text, i);
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    i = keyEnd;
    while (/\s/.test(text[i] ?? '')) i++;
    if (text[i] !== ':') return null;
    i++;
    while (/\s/.test(text[i] ?? '')) i++;
    const valueEnd = skipJsonValue(text, i);
    if (valueEnd === -1) return null;
    members.push({ key, valueStart: i, valueEnd });
    i = valueEnd;
  }
}

/** Appends the entry to the array at [open, close), in the array's own layout. */
function appendToArray(text: string, open: number, close: number, eol: string, quoted: string): string {
  const inner = text.slice(open + 1, close - 1);
  if (inner.trim() === '') return `${text.slice(0, open + 1)}${quoted}${text.slice(close - 1)}`;
  if (!inner.includes('\n')) {
    // inline: ["apps/*", "libs/*"] → keep it on one line
    const body = inner.replace(/\s+$/, '');
    return `${text.slice(0, open + 1)}${body}, ${quoted}${inner.slice(body.length)}${text.slice(close - 1)}`;
  }
  // one entry per line: copy the last entry's indentation
  const lastEntryLineStart = text.lastIndexOf('\n', open + 1 + inner.trimEnd().length - 1) + 1;
  const itemIndent = /^[ \t]*/.exec(text.slice(lastEntryLineStart))?.[0] ?? '  ';
  const bodyEnd = open + 1 + inner.trimEnd().length;
  return `${text.slice(0, bodyEnd)},${eol}${itemIndent}${quoted}${text.slice(bodyEnd)}`;
}

function insertSharedTypesWorkspace(text: string, form: 'array' | 'object' | 'absent', quoted: string): string | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rootOpen = text.indexOf('{');
  if (rootOpen === -1) return null;
  const members = objectMembers(text, rootOpen);
  if (members === null) return null;
  const workspaces = members.find((member) => member.key === 'workspaces');

  if (form === 'absent') {
    const last = members[members.length - 1];
    // [ \t]+ on purpose: \s+ would swallow blank lines before the first key.
    const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? '  ';
    if (last === undefined) {
      const close = skipJsonValue(text, rootOpen) - 1;
      return `${text.slice(0, rootOpen + 1)}${eol}${indent}"workspaces": [${quoted}]${eol}${text.slice(close)}`;
    }
    return `${text.slice(0, last.valueEnd)},${eol}${indent}"workspaces": [${quoted}]${text.slice(last.valueEnd)}`;
  }
  if (workspaces === undefined) return null;
  if (form === 'array') {
    if (text[workspaces.valueStart] !== '[') return null;
    return appendToArray(text, workspaces.valueStart, workspaces.valueEnd, eol, quoted);
  }
  if (text[workspaces.valueStart] !== '{') return null;
  const packages = objectMembers(text, workspaces.valueStart)?.find((member) => member.key === 'packages');
  if (packages === undefined || text[packages.valueStart] !== '[') return null;
  return appendToArray(text, packages.valueStart, packages.valueEnd, eol, quoted);
}

/**
 * Registers `libs/shared-types` in pnpm-workspace.yaml so pnpm links the new
 * package. Recognition is narrow on purpose: a plain top-level `packages:`
 * list of quoted entries (exactly what create-nx-workspace emits). Anything
 * else returns 'unrecognized' and is never written — same contract as the
 * ESLint transform. Known limits (fine at v0.1): the 'present' check scans the
 * whole file, so a libs glob in another YAML section reads as present; forms
 * like 'libs/**' are not recognized as covering; output joins with LF.
 */
export function addSharedTypesWorkspaceGlob(yamlText: string, entry: string = DEFAULT_SHARED_TYPES_ROOT): WorkspaceGlobResult {
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const parentGlob = `${entry.split('/').slice(0, -1).join('/')}/*`;
  if (new RegExp(`^\\s*-\\s*['"]?(${escape(entry)}|${escape(parentGlob)})['"]?\\s*$`, 'm').test(yamlText)) {
    return { status: 'present' };
  }
  const lines = yamlText.split('\n');
  const packagesIndex = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (packagesIndex === -1) return { status: 'unrecognized' };
  let lastEntry = packagesIndex;
  for (let i = packagesIndex + 1; i < lines.length; i++) {
    if (/^\s+-\s+\S/.test(lines[i])) {
      lastEntry = i;
    } else if (lines[i].trim() === '') {
      continue;
    } else {
      break;
    }
  }
  if (lastEntry === packagesIndex) return { status: 'unrecognized' };
  const indent = /^(\s+)-/.exec(lines[lastEntry])?.[1] ?? '  ';
  lines.splice(lastEntry + 1, 0, `${indent}- '${entry}'`);
  return { status: 'added', text: lines.join('\n') };
}
