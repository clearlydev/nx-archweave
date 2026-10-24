import { findNodeAtLocation, parseTree, type Node } from 'jsonc-parser';

/**
 * Edits to a JSON file the user owns (project.json, package.json, tsconfig.base.json) that leave
 * every line they do not need to change byte for byte: a tag added to `"tags": ["a"]` stays on
 * that line. Rewriting the whole file with JSON.stringify expanded the user's inline arrays and
 * turned a one-tag change into a large diff. New lines follow the file's indent and line ending.
 */

type JsonPath = (string | number)[];

/** The indentation unit an existing JSON file uses, so an update preserves the
 * author's formatting: the first indented line's leading run of tabs or spaces,
 * else two spaces (e.g. minified JSON or no file). */
export function detectIndent(raw: string): string {
  for (const line of raw.split('\n')) {
    const match = /^(\t+| +)/.exec(line);
    if (match) return match[1];
  }
  return '  ';
}

interface Style {
  eol: string;
  unit: string;
}

function styleOf(raw: string): Style {
  return { eol: raw.includes('\r\n') ? '\r\n' : '\n', unit: detectIndent(raw) };
}

function lineIndentAt(raw: string, offset: number): string {
  const lineStart = raw.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(raw.slice(lineStart))?.[0] ?? '';
}

function isMultiline(raw: string, node: Node): boolean {
  return raw.slice(node.offset, node.offset + node.length).includes('\n');
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** A value as it appears in the file: arrays of primitives inline (`["a", "b"]`), objects one key
 * per line, indented from `indent`. */
function renderValue(value: unknown, indent: string, style: Style): string {
  if (isPrimitive(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    const inner = `${indent}${style.unit}`;
    return `[${style.eol}${value.map((item) => `${inner}${renderValue(item, inner, style)}`).join(`,${style.eol}`)}${style.eol}${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  const inner = `${indent}${style.unit}`;
  const body = entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${renderValue(item, inner, style)}`).join(`,${style.eol}`);
  return `{${style.eol}${body}${style.eol}${indent}}`;
}

function splice(raw: string, start: number, end: number, text: string): string {
  return raw.slice(0, start) + text + raw.slice(end);
}

function nest(keys: JsonPath, value: unknown): unknown {
  return keys.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
}

/** Adds `"key": value` as the last property of `object`, matching how the object is laid out. */
function insertProperty(raw: string, object: Node, key: string | number, value: unknown, style: Style): string {
  const properties = object.children ?? [];
  const objectIndent = lineIndentAt(raw, object.offset);
  if (properties.length === 0) {
    const inner = `${objectIndent}${style.unit}`;
    const text = `{${style.eol}${inner}${JSON.stringify(String(key))}: ${renderValue(value, inner, style)}${style.eol}${objectIndent}}`;
    return splice(raw, object.offset, object.offset + object.length, text);
  }
  const last = properties[properties.length - 1];
  const end = last.offset + last.length;
  if (!isMultiline(raw, object)) {
    return splice(raw, end, end, `, ${JSON.stringify(String(key))}: ${renderValue(value, '', style)}`);
  }
  const indent = lineIndentAt(raw, last.offset);
  return splice(raw, end, end, `,${style.eol}${indent}${JSON.stringify(String(key))}: ${renderValue(value, indent, style)}`);
}

/** Sets `path` to `value`, creating missing objects along the way. */
export function setJsonValue(raw: string, path: JsonPath, value: unknown): string {
  const style = styleOf(raw);
  const root = parseTree(raw);
  if (root === undefined) throw new Error('setJsonValue: not a JSON document');
  const existing = findNodeAtLocation(root, path);
  if (existing !== undefined) {
    return splice(raw, existing.offset, existing.offset + existing.length, renderValue(value, lineIndentAt(raw, existing.offset), style));
  }
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const parent = depth === 0 ? root : findNodeAtLocation(root, path.slice(0, depth));
    if (parent === undefined) continue;
    if (parent.type !== 'object') throw new Error(`setJsonValue: ${path.slice(0, depth).join('.') || 'the root'} is not an object`);
    return insertProperty(raw, parent, path[depth], nest(path.slice(depth + 1), value), style);
  }
  throw new Error('setJsonValue: unreachable');
}

/** Appends `item` to the array at `path` in the array's own layout; creates the array when missing. */
export function appendJsonArrayItem(raw: string, path: JsonPath, item: unknown): string {
  const style = styleOf(raw);
  const root = parseTree(raw);
  const array = root === undefined ? undefined : findNodeAtLocation(root, path);
  if (array === undefined) return setJsonValue(raw, path, [item]);
  if (array.type !== 'array') throw new Error(`appendJsonArrayItem: ${path.join('.')} is not an array`);
  const items = array.children ?? [];
  if (items.length === 0) return splice(raw, array.offset, array.offset + array.length, renderValue([item], '', style));
  const last = items[items.length - 1];
  const end = last.offset + last.length;
  if (!isMultiline(raw, array)) {
    const separator = items.length >= 2 ? raw.slice(items[0].offset + items[0].length, items[1].offset) : ', ';
    return splice(raw, end, end, `${separator}${renderValue(item, '', style)}`);
  }
  const indent = lineIndentAt(raw, last.offset);
  return splice(raw, end, end, `,${style.eol}${indent}${renderValue(item, indent, style)}`);
}

/** Applies `edits` in order to `raw`; with no file yet (`raw` null) builds a new 2-space document
 * with a trailing newline from them. */
export function applyJsonEdits(raw: string | null, edits: [JsonPath, unknown][]): string {
  if (raw === null) {
    let text = '{}\n';
    for (const [path, value] of edits) text = setJsonValue(text, path, value);
    return text;
  }
  return edits.reduce((text, [path, value]) => setJsonValue(text, path, value), raw);
}
