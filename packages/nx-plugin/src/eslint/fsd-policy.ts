import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * How strictly `archweave/fsd-boundaries` reads an FSD tree. `basic` is canonical FSD; `practical`
 * accepts the variants common in existing apps. A preset is only a set of values for these
 * options — each can be set on its own, and an explicit value always wins over the preset.
 */
export interface FsdPolicy {
  /** Folders on a sliced layer that only group slices (`features/mypage/{order,claims}`):
   * detected (`auto`), forced (`include`) or ruled out (`exclude`), as `<layer dir>/<name>`. */
  sliceGroups: false | { auto: boolean; include: string[]; exclude: string[] };
  /** The public-API unit of `shared`: a segment (`shared/ui`), a component inside a segment
   * (`shared/ui/button`), or any file (no sidestep check inside shared). */
  sharedPublicApi: 'segment' | 'component' | 'file';
  /** Globs (relative to the source root) of test files, which may import another slice's
   * internals; `false` treats them like any other file. Upward imports are reported either way. */
  testFiles: false | string[];
  /** Extra folder names that are segments, never slices, for group detection. */
  segments: string[];
  /** Platform suffixes whose `index.<suffix>.<ext>` is a public API too (React Native). */
  platformSuffixes: string[];
  /** Folders a framework's router owns (Next.js's Pages Router `pages/`): read as the
   * composition root (the app layer), so they may re-export any layer below. */
  routerDirs: string[];
}

export type FsdPreset = 'basic' | 'practical';

const PRESETS: Record<FsdPreset, FsdPolicy> = {
  basic: {
    sliceGroups: { auto: true, include: [], exclude: [] },
    sharedPublicApi: 'segment',
    testFiles: false,
    segments: [],
    platformSuffixes: [],
    routerDirs: [],
  },
  practical: {
    sliceGroups: { auto: true, include: [], exclude: [] },
    sharedPublicApi: 'file',
    testFiles: ['**/*.{spec,test}.*', '**/__tests__/**'],
    segments: [],
    platformSuffixes: [],
    routerDirs: [],
  },
};

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The policy from a recorded `fsd` object (its preset, then its own keys), then `overrides`.
 * Unknown or malformed values fall back to the preset's. */
export function resolveFsdPolicy(recorded: unknown, overrides: Partial<FsdPolicy> = {}): FsdPolicy {
  const fsd = typeof recorded === 'object' && recorded !== null ? (recorded as Record<string, unknown>) : {};
  const preset = fsd['preset'] === 'practical' ? 'practical' : 'basic';
  const policy: FsdPolicy = { ...PRESETS[preset] };

  const groups = fsd['sliceGroups'];
  if (groups === false) policy.sliceGroups = false;
  else if (groups === 'auto') policy.sliceGroups = { auto: true, include: [], exclude: [] };
  else if (typeof groups === 'object' && groups !== null) {
    const value = groups as Record<string, unknown>;
    policy.sliceGroups = {
      auto: value['auto'] !== false,
      include: isStringArray(value['include']) ? value['include'] : [],
      exclude: isStringArray(value['exclude']) ? value['exclude'] : [],
    };
  }
  const shared = fsd['sharedPublicApi'];
  if (shared === 'segment' || shared === 'component' || shared === 'file') policy.sharedPublicApi = shared;
  const tests = fsd['testFiles'];
  if (tests === false || isStringArray(tests)) policy.testFiles = tests;
  if (isStringArray(fsd['segments'])) policy.segments = fsd['segments'];
  if (isStringArray(fsd['platformSuffixes'])) policy.platformSuffixes = fsd['platformSuffixes'];
  if (isStringArray(fsd['routerDirs'])) policy.routerDirs = fsd['routerDirs'];

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) (policy as unknown as Record<string, unknown>)[key] = value;
  }
  return policy;
}

/** The `fsd` object of the nearest toolkit.config.json at or above `from`; undefined when there
 * is none or it cannot be read. */
export function readRecordedFsd(from: string): unknown {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, 'toolkit.config.json');
    if (existsSync(file)) {
      try {
        return (JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>)['fsd'];
      } catch {
        return undefined;
      }
    }
    if (dirname(dir) === dir) return undefined;
  }
}

const escapeLiteral = (text: string): string => text.replace(/[.+^$()|[\]\\{}]/g, '\\$&');

/** One glob segment without braces: `**`, `*` and `?` as wildcards, the rest literal. */
function wildcardsToRegExp(glob: string): string {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else source += escapeLiteral(ch);
  }
  return source;
}

/** A glob (`**`, `*`, `?`, `{a,b}`) as a regular expression over `/`-separated paths. A brace
 * without its closing `}` is a literal character. */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  let rest = glob;
  for (;;) {
    const open = rest.indexOf('{');
    const close = open === -1 ? -1 : rest.indexOf('}', open);
    if (open === -1 || close === -1) {
      source += wildcardsToRegExp(rest);
      break;
    }
    source += wildcardsToRegExp(rest.slice(0, open));
    source += `(?:${rest.slice(open + 1, close).split(',').map(wildcardsToRegExp).join('|')})`;
    rest = rest.slice(close + 1);
  }
  return new RegExp(`^${source}$`);
}
