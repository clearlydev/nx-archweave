/** What pnpm 11 writes under `allowBuilds` for a build script it skipped without a
 * decision (pnpm 11.9 `handleIgnoredBuilds`). */
const PENDING_PLACEHOLDER = 'set this to true or false';

/** A plain npm package name — `name` or `@scope/name`. These names end up in YAML and
 * on a command line, so anything else (versions, `file:` specs, paths) is refused. */
export function isPlainPackageName(name: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i.test(name);
}

/** What a package's entry said before this edit. */
export type BuildDecisionState = 'allowed' | 'denied' | 'pending' | 'other' | 'absent';

export interface BuildDecisionChange {
  name: string;
  previous: BuildDecisionState;
}

/** The key the edit goes to: `allowBuilds` (pnpm 11, read by pnpm 10.28 too) or the
 * `onlyBuiltDependencies` list create-nx-workspace writes for pnpm 10. */
export type AllowBuildsTarget = 'allowBuilds' | 'onlyBuiltDependencies';

export type AllowPackageBuildsResult =
  | { status: 'updated'; target: AllowBuildsTarget; changes: BuildDecisionChange[]; text: string }
  | { status: 'unchanged'; target: AllowBuildsTarget; changes: BuildDecisionChange[] }
  | { status: 'unrecognized'; reason: string };

interface Block {
  /** Line index of the top-level key. */
  keyIndex: number;
  /** Line indices of the block's entries, in order (comments and blank lines excluded). */
  entries: number[];
}

interface MapEntry {
  index: number;
  indent: string;
  /** The key as written, quotes included. */
  rawKey: string;
  /** The key without quotes. */
  key: string;
  value: string;
  comment: string;
}

/**
 * Allows dependency build scripts in pnpm-workspace.yaml. The edit goes where the file
 * already keeps its decisions: an `allowBuilds` map (each name set to `true` — an
 * existing entry is rewritten in place, keeping its key quoting and a trailing comment;
 * a missing one is appended), else an `onlyBuiltDependencies` list (missing names
 * appended), else a new `allowBuilds` block. A one-line flow collection — pnpm 11 keeps
 * `allowBuilds: { … }` when the file had `allowBuilds: {}` — is rewritten as a block.
 * Line-based, like every other yaml edit in this package: a shape it does not recognise
 * is reported and never written. Names must already satisfy {@link isPlainPackageName}.
 */
export function allowPackageBuilds(
  yamlText: string,
  names: string[],
  options: { pnpmMajor?: number } = {},
): AllowPackageBuildsResult {
  const bom = yamlText.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = yamlText.slice(bom.length);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const unique = [...new Set(names)];

  // pnpm 11 reads only allowBuilds: a leftover pnpm 10 list is no place for the decision.
  const listIsRead = options.pnpmMajor === undefined || options.pnpmMajor < 11;
  const result = edit(body.split(/\r?\n/), eol, unique, listIsRead);
  return result.status === 'updated' ? { ...result, text: `${bom}${result.text}` } : result;
}

/** The major version of the pnpm that last installed node_modules, from its
 * `node_modules/.modules.yaml` (pnpm 10 writes YAML, pnpm 11 JSON); undefined when
 * the file does not say. */
export function pnpmMajorFromModulesManifest(modulesYamlText: string): number | undefined {
  const match = /^\s*["']?packageManager["']?\s*:\s*["']?pnpm@(\d+)\./m.exec(modulesYamlText);
  return match ? Number(match[1]) : undefined;
}

function edit(original: string[], eol: string, names: string[], listIsRead: boolean): AllowPackageBuildsResult {
  const shape = checkDocumentShape(original);
  if (shape !== undefined) return { status: 'unrecognized', reason: shape };

  const lines = expandFlow(original, 'allowBuilds');
  if (typeof lines === 'string') return { status: 'unrecognized', reason: lines };
  const allowBuilds = findBlock(lines, 'allowBuilds');
  if (typeof allowBuilds === 'string') return { status: 'unrecognized', reason: allowBuilds };
  if (allowBuilds) return editAllowBuilds(lines, eol, allowBuilds, names);
  if (!listIsRead) return appendAllowBuilds(original, eol, names);

  const listLines = expandFlow(original, 'onlyBuiltDependencies');
  if (typeof listLines === 'string') return { status: 'unrecognized', reason: listLines };
  const onlyBuilt = findBlock(listLines, 'onlyBuiltDependencies');
  if (typeof onlyBuilt === 'string') return { status: 'unrecognized', reason: onlyBuilt };
  if (onlyBuilt) return editOnlyBuilt(listLines, eol, onlyBuilt, names);
  return appendAllowBuilds(original, eol, names);
}

/** No allowBuilds key (or only a list pnpm no longer reads): a new block at the end. */
function appendAllowBuilds(original: string[], eol: string, names: string[]): AllowPackageBuildsResult {
  const changes = names.map((name) => ({ name, previous: 'absent' as const }));
  const entries = names.map((name) => `  ${yamlPackageKey(name)}: true`);
  const head = original[original.length - 1] === '' ? original.slice(0, -1) : original;
  return { status: 'updated', target: 'allowBuilds', changes, text: [...head, 'allowBuilds:', ...entries, ''].join(eol) };
}

function editAllowBuilds(lines: string[], eol: string, block: Block, names: string[]): AllowPackageBuildsResult {
  const entries: MapEntry[] = [];
  for (const index of block.entries) {
    // keys may hold colons (`foo@file:../foo`), so a key ends at the first ": " / end of line
    const match = /^(\s+)('([^']*)'|"([^"]*)"|([^\s'"#-]\S*?)):(?:\s+(.*))?$/.exec(lines[index]);
    if (!match) return { status: 'unrecognized', reason: 'allowBuilds holds something other than "<package>: <value>" entries' };
    entries.push({ index, indent: match[1], rawKey: match[2], key: match[3] ?? match[4] ?? match[5], ...splitValue(match[6] ?? '') });
  }
  const indent = entries[0]?.indent ?? '  ';

  for (const name of names) {
    if (entries.filter((entry) => entry.key === name).length > 1) return { status: 'unrecognized', reason: `allowBuilds lists ${name} more than once` };
    // pnpm 11 lets a deny of `name@version` win over an allow of `name`
    const versioned = entries.find((entry) => entry.key.startsWith(`${name}@`) && classify(entry.value) !== 'allowed');
    if (versioned) return { status: 'unrecognized', reason: `allowBuilds has a version-specific entry for ${name} (${versioned.key}) that is not true` };
  }

  const next = [...lines];
  const appended: string[] = [];
  const changes: BuildDecisionChange[] = names.map((name) => {
    const entry = entries.find((candidate) => candidate.key === name);
    if (!entry) {
      appended.push(`${indent}${yamlPackageKey(name)}: true`);
      return { name, previous: 'absent' };
    }
    const previous = classify(entry.value);
    if (previous !== 'allowed') next[entry.index] = `${entry.indent}${entry.rawKey}: true${entry.comment ? ` ${entry.comment}` : ''}`;
    return { name, previous };
  });

  if (changes.every((change) => change.previous === 'allowed')) return { status: 'unchanged', target: 'allowBuilds', changes };
  next.splice(insertionPoint(block), 0, ...appended);
  return { status: 'updated', target: 'allowBuilds', changes, text: next.join(eol) };
}

function editOnlyBuilt(lines: string[], eol: string, block: Block, names: string[]): AllowPackageBuildsResult {
  const listed = new Set<string>();
  for (const index of block.entries) {
    const item = /^\s+-\s+(?:'([^']*)'|"([^"]*)"|([^\s#'"][^#]*?))\s*(?:#.*)?$/.exec(lines[index]);
    const value = item ? (item[1] ?? item[2] ?? item[3]) : undefined;
    // `- name: x` is a map item, not a package
    if (value === undefined || (item?.[3] !== undefined && /:(\s|$)/.test(value))) {
      return { status: 'unrecognized', reason: 'onlyBuiltDependencies holds something other than "- <package>" items' };
    }
    listed.add(value);
  }
  const indent = block.entries.length > 0 ? leadingSpace(lines[block.entries[0]]) : '  ';

  const changes: BuildDecisionChange[] = names.map((name) => ({ name, previous: listed.has(name) ? 'allowed' : 'absent' }));
  if (changes.every((change) => change.previous === 'allowed')) {
    return { status: 'unchanged', target: 'onlyBuiltDependencies', changes };
  }
  const next = [...lines];
  const appended = changes.filter((change) => change.previous === 'absent').map((change) => `${indent}- ${yamlPackageKey(change.name)}`);
  next.splice(insertionPoint(block), 0, ...appended);
  return { status: 'updated', target: 'onlyBuiltDependencies', changes, text: next.join(eol) };
}

/**
 * The file must be one plain block mapping with its keys at column 0 — otherwise a key
 * this parser cannot see (an indented or flow root, `? key`, a second document) could
 * already hold the decisions, and appending would duplicate it.
 */
function checkDocumentShape(lines: string[]): string | undefined {
  const content = lines.filter((line) => line.trim() !== '' && !/^\s*#/.test(line));
  if (content.some((line) => /^(---|\.\.\.)(\s|$)/.test(line))) return 'the file has YAML document markers (--- / ...)';
  const first = content[0];
  if (first !== undefined && !/^(?:'[^']*'|"[^"]*"|[^\s#'"?{[\]-][^:]*?)\s*:(?:\s|$)/.test(first)) {
    return 'the file is not a plain mapping with its keys at column 0';
  }
  return undefined;
}

/**
 * Rewrites a one-line flow collection under a top-level key as a block: pnpm 11 keeps
 * `allowBuilds: { a: false, b: true }` when the file had `allowBuilds: {}`. Items are
 * split at commas, which is safe for package keys and pnpm's values; nesting or an
 * item that is not `key: value` (map) / a scalar (list) is refused.
 */
function expandFlow(lines: string[], key: string): string[] | string {
  const keyLine = topLevelKeyLine(key);
  const index = lines.findIndex((line) => keyLine.test(line));
  if (index === -1) return lines;
  const match = /^(.*?:)\s*([{[])(.*)([}\]])\s*(#.*)?$/.exec(lines[index]);
  if (!match) return lines;
  const [, head, open, inner, close, comment] = match;
  const isMap = key === 'allowBuilds';
  if ((isMap && (open !== '{' || close !== '}')) || (!isMap && (open !== '[' || close !== ']'))) {
    return `${key} is a flow collection of the wrong kind`;
  }
  const items = inner.trim() === '' ? [] : inner.split(',').map((item) => item.trim());
  const valid = isMap
    ? (item: string) => /^(?:'[^']*'|"[^"]*"|[^\s'"#-]\S*?):\s+[^{}[\],]+$/.test(item)
    : (item: string) => /^(?:'[^']*'|"[^"]*"|[^\s'"#{}[\],:-][^{}[\],:]*)$/.test(item);
  if (items.some((item) => !valid(item))) return `${key} is a flow collection this parser does not split`;
  const block = items.map((item) => (isMap ? `  ${item}` : `  - ${item}`));
  return [...lines.slice(0, index), `${head}${comment ? ` ${comment}` : ''}`, ...block, ...lines.slice(index + 1)];
}

function topLevelKeyLine(key: string): RegExp {
  return new RegExp(`^(['"]?)${key}\\1\\s*:(.*)$`);
}

/**
 * Locates a top-level key's block. `undefined` → the key is absent; a string → the
 * reason the shape is not recognised. Comment lines (at any column) and blank lines
 * neither end nor join a block; it ends at the next line starting at column 0. A
 * column-0 `-` there is a compact list this parser does not edit. The key may not
 * appear anywhere else (nested, `? key`): pnpm reads only the top-level one, and a
 * second spelling would be a duplicate this parser cannot see.
 */
function findBlock(lines: string[], key: string): Block | string | undefined {
  const keyLine = topLevelKeyLine(key);
  const keyIndices = lines.flatMap((line, index) => (keyLine.test(line) ? [index] : []));
  const mentions = lines.filter((line) => !/^\s*#/.test(line) && new RegExp(`\\b${key}\\b`).test(line));
  if (mentions.length > keyIndices.length) return `${key} appears somewhere other than a top-level key`;
  if (keyIndices.length === 0) return undefined;
  if (keyIndices.length > 1) return `${key} appears more than once at the top level`;

  const keyIndex = keyIndices[0];
  const rest = (keyLine.exec(lines[keyIndex])?.[2] ?? '').replace(/\s+#.*$/, '').trim();
  if (rest !== '') return `${key} is not a block (found "${key}: ${rest}")`;

  const entries: number[] = [];
  for (let index = keyIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) {
      if (line.startsWith('-')) return `${key} uses a column-0 list`;
      break;
    }
    entries.push(index);
  }
  if (entries.length > 0) {
    const indent = leadingSpace(lines[entries[0]]);
    if (entries.some((index) => leadingSpace(lines[index]) !== indent)) return `${key} has entries at more than one indentation`;
  }
  return { keyIndex, entries };
}

/** New entries go right after the block's last entry (before any trailing blank lines
 * or comments), or right after the key when the block is empty. */
function insertionPoint(block: Block): number {
  return (block.entries.length > 0 ? block.entries[block.entries.length - 1] : block.keyIndex) + 1;
}

function splitValue(raw: string): { value: string; comment: string } {
  const match = /^('[^']*'|"[^"]*"|[^#]*?)\s*(#.*)?$/.exec(raw.trim());
  return { value: match?.[1] ?? raw.trim(), comment: match?.[2] ?? '' };
}

/** pnpm acts on a YAML boolean only: a quoted 'true' is a string, so it is not an allow. */
function classify(value: string): BuildDecisionState {
  if (/^(true|True|TRUE)$/.test(value)) return 'allowed';
  if (/^(false|False|FALSE)$/.test(value)) return 'denied';
  const unquoted = /^(['"])(.*)\1$/.exec(value)?.[2] ?? value;
  if (unquoted === PENDING_PLACEHOLDER) return 'pending';
  return 'other';
}

/** A package name as a YAML key or list item. pnpm's own writer single-quotes names
 * YAML would otherwise misread (a leading `@`); quoting anything that does not start
 * with a letter covers that, and digits and YAML's boolean/null words too. */
export function yamlPackageKey(name: string): string {
  return /^[a-z][a-z0-9._~-]*$/i.test(name) && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(name) ? name : `'${name}'`;
}

function leadingSpace(line: string): string {
  return /^(\s*)/.exec(line)?.[1] ?? '';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The names with no package entry in pnpm-lock.yaml — the keys of its `packages:` and
 * `snapshots:` sections (`  sharp@0.34.5:`, `  '@swc/core@1.15.8':`). An importer's
 * `specifier` or an `overrides:` key alone does not count: nothing installed means
 * nothing to build.
 */
export function missingFromLockfile(lockfileText: string, names: string[]): string[] {
  const installed: string[] = [];
  let section = '';
  for (const line of lockfileText.split(/\r?\n/)) {
    if (/^\S/.test(line)) section = /^([A-Za-z]+):/.exec(line)?.[1] ?? '';
    else if (section === 'packages' || section === 'snapshots') installed.push(line);
  }
  const text = installed.join('\n');
  return names.filter((name) => !new RegExp(`^ {2}(['"]?)/?${escapeRegExp(name)}@`, 'm').test(text));
}
