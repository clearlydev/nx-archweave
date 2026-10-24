import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FsdPolicy } from './fsd-policy.ts';

/** Folder names that make a folder a slice even without its own index: FSD's segments, and
 * the by-kind folders existing apps often organise a slice with. */
const SEGMENTS = [
  'ui', 'model', 'api', 'lib', 'config',
  'components', 'hooks', 'types', 'utils', 'helpers', 'constants', 'consts', 'store', 'stores', 'styles', 'assets', 'services', 'context',
];

/** Dotfiles (`.DS_Store`) and READMEs say nothing about a folder's role. */
const IGNORED = /^(\.|readme(\.|$))/i;

export type DirectoryLister = (dir: string) => { name: string; directory: boolean }[] | null;

interface Listing {
  mtimeMs: number;
  entries: { name: string; directory: boolean }[];
}

/** Directory listings, re-read whenever a directory's mtime moves. Only listings are cached,
 * never a verdict: a group's verdict depends on its children's listings, and adding
 * `features/mypage/order/index.ts` changes the mtime of `order/` alone. Kept for the life of
 * the process, so an editor's long-lived ESLint server sees changes without a restart. */
const listings = new Map<string, Listing>();

function list(dir: string): Listing['entries'] | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(dir).mtimeMs;
  } catch {
    listings.delete(dir);
    return null;
  }
  const cached = listings.get(dir);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.entries;
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
    listings.set(dir, { mtimeMs, entries });
    return entries;
  } catch {
    return null;
  }
}

/**
 * Whether `<rootAbsolute>/<layerDir>/<name>` groups slices instead of being one. A group has no
 * files of its own (so no index), none of its folders is a segment, and at least one of its
 * folders has an index. `include` / `exclude` (`<layerDir>/<name>`) decide before detection.
 */
export function createGroupDetector(
  rootAbsolute: string,
  policy: FsdPolicy,
  isIndexFile: (name: string) => boolean,
  listDirectory: DirectoryLister = list,
): (layerDir: string, name: string) => boolean {
  const groups = policy.sliceGroups;
  if (groups === false) return () => false;
  const segments = new Set([...SEGMENTS, ...policy.segments]);
  return (layerDir, name) => {
    const key = `${layerDir}/${name}`;
    if (groups.include.includes(key)) return true;
    if (groups.exclude.includes(key) || !groups.auto) return false;
    const entries = listDirectory(join(rootAbsolute, layerDir, name))?.filter((entry) => !IGNORED.test(entry.name)) ?? null;
    if (entries === null || entries.length === 0) return false;
    if (entries.some((entry) => !entry.directory || segments.has(entry.name))) return false;
    return entries.some((entry) => listDirectory(join(rootAbsolute, layerDir, name, entry.name))?.some((child) => !child.directory && isIndexFile(child.name)) ?? false);
  };
}
