import { parseJson, type Tree } from '@nx/devkit';

export type ProjectType = 'application' | 'library';

/**
 * The project type Nx itself would use when a project declares none — the
 * classic-preset Nx 23 layout configures apps through a bare package.json, so a
 * filter on the declared `projectType` alone misses every one of them.
 *
 * Mirrors the project graph's rule (nx 23 core `normalize-project-nodes`
 * `getProjectType`): a declared type wins (anything but `library` counts as an
 * application, as in Nx); then `tsconfig.lib.json` → library; `tsconfig.app.json`
 * → application; a readable package.json with none of exports/main/module/bin
 * set → application; anything else — including a missing or unparseable
 * package.json — → library. Mirrored, not imported: the plugin's runtime
 * dependencies stay @nx/devkit + tslib. Not mirrored: the package-json plugin's
 * `workspaceLayout.appsDir`/`libsDir` override, which devkit's tree-based
 * `getProjects` never applies either.
 */
export function resolveProjectType(tree: Tree, root: string, declared: string | undefined): ProjectType {
  if (declared) return declared === 'library' ? 'library' : 'application';
  const prefix = root === '' || root === '.' ? '' : `${root}/`;
  if (tree.exists(`${prefix}tsconfig.lib.json`)) return 'library';
  if (tree.exists(`${prefix}tsconfig.app.json`)) return 'application';
  const raw = tree.read(`${prefix}package.json`, 'utf-8');
  if (raw === null) return 'library';
  try {
    // parseJson accepts comments and trailing commas, like Nx's readJsonFile
    const manifest = parseJson<Record<string, unknown>>(raw) as Record<string, unknown> | null;
    // truthiness, like Nx: an empty "main": "" is no entry point
    if (manifest && !['exports', 'main', 'module', 'bin'].some((key) => Boolean(manifest[key]))) return 'application';
  } catch {
    // unparseable — Nx's graph falls through to library as well
  }
  return 'library';
}
