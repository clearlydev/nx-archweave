import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Import aliases from a tsconfig's `compilerOptions.paths`: every
 * `"<prefix>*": ["<dir>/*"]` entry becomes `{ "<prefix>": "<dir>" }`, the directory relative
 * to `cwd` (what the rule's `aliases` option takes). The `extends` chain is followed
 * (relative paths only — a package preset is skipped), the nearest config winning per key;
 * `baseUrl` of the config that declares the paths resolves the targets. Comments and
 * trailing commas are tolerated, like tsc. Anything unreadable yields nothing: the rule
 * then falls back to its default alias — a wrong alias map costs a missed report, never a
 * false one, so this stays best-effort.
 */
export function aliasesFromTsconfig({ cwd, tsconfig = 'tsconfig.json', maxDepth = 8 }: { cwd: string; tsconfig?: string; maxDepth?: number }): Record<string, string> {
  const aliases: Record<string, string> = {};
  let current: string | null = resolve(cwd, tsconfig);
  const seen = new Set<string>();
  for (let depth = 0; current !== null && depth < maxDepth && !seen.has(current); depth++) {
    seen.add(current);
    const config = readJsonc(current);
    if (config === null) break;
    const compilerOptions = asRecord(config['compilerOptions']);
    const paths = asRecord(compilerOptions?.['paths']);
    if (paths) {
      const baseUrl = typeof compilerOptions?.['baseUrl'] === 'string' ? resolve(dirname(current), compilerOptions['baseUrl']) : dirname(current);
      for (const [pattern, targets] of Object.entries(paths)) {
        if (!pattern.endsWith('*')) continue;
        const prefix = pattern.slice(0, -1);
        if (prefix in aliases) continue; // a nearer config already decided this prefix
        const target = Array.isArray(targets) ? targets.find((t): t is string => typeof t === 'string') : undefined;
        if (target === undefined || !target.endsWith('/*')) continue;
        const dir = toPosix(relative(cwd, resolve(baseUrl, target.slice(0, -'/*'.length))));
        aliases[prefix] = dir === '' ? '.' : dir;
      }
    }
    const parent = config['extends'];
    const parentPath = typeof parent === 'string' ? parent : Array.isArray(parent) ? parent.find((p): p is string => typeof p === 'string') : undefined;
    current = parentPath !== undefined && (parentPath.startsWith('.') || isAbsolute(parentPath)) ? resolveExtends(dirname(current), parentPath) : null;
  }
  return aliases;
}

function resolveExtends(fromDir: string, target: string): string | null {
  const candidates = [resolve(fromDir, target), resolve(fromDir, `${target}.json`)];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

/** tsconfig is JSON with comments and trailing commas; strip both outside strings. */
export function readJsonc(path: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  let out = '';
  let mode: 'code' | 'string' | 'line' | 'block' = 'code';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const d = text[i + 1];
    if (mode === 'code') {
      if (c === '"') {
        mode = 'string';
        out += c;
      } else if (c === '/' && d === '/') {
        mode = 'line';
        i++;
      } else if (c === '/' && d === '*') {
        mode = 'block';
        i++;
      } else {
        out += c;
      }
    } else if (mode === 'string') {
      out += c;
      if (c === '\\') {
        out += d ?? '';
        i++;
      } else if (c === '"') {
        mode = 'code';
      }
    } else if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
        out += c;
      }
    } else if (c === '*' && d === '/') {
      mode = 'code';
      i++;
    }
  }
  try {
    const parsed: unknown = JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
    return asRecord(parsed);
  } catch {
    return null;
  }
}
