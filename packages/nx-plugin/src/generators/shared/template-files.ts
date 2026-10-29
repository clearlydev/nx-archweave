import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateFiles } from '@nx/devkit';
// createTree is the devkit's in-memory Tree; it holds the rendered files until the caller has
// compared each one with the workspace.
import { createTree } from '@nx/devkit/testing';

export interface RenderedFile {
  filePath: string;
  content: string;
}

/**
 * The `files/` directory of a generator. `fromUrl` is the calling module's `import.meta.url`:
 * from source, from a generator's own bundle and from a shared chunk in `generators/_chunks/`
 * that is `../<generator>/files`; from the package's root `index.js` it is
 * `./generators/<generator>/files`.
 */
export function generatorFilesDir(generator: string, fromUrl: string): string {
  for (const relative of [`../${generator}/files`, `./generators/${generator}/files`]) {
    const dir = fileURLToPath(new URL(relative, fromUrl));
    if (existsSync(dir)) return dir;
  }
  throw new Error(`The "${generator}" generator's template files are missing next to ${fileURLToPath(fromUrl)}`);
}

/**
 * Renders a template folder the way every Nx generator does — `generateFiles`: `__key__` in
 * paths and EJS in contents take the substitutions, a `.template` suffix is dropped — into a
 * scratch tree, and returns the files sorted by path. The caller decides what reaches the
 * workspace (create, leave an existing file alone, or only report it in a dry run).
 */
export function renderTemplateFiles(srcFolder: string, target: string, substitutions: Record<string, unknown>): RenderedFile[] {
  const scratch = createTree();
  // createTree seeds a .prettierrc; only what generateFiles adds belongs to the result.
  const seeded = new Set(scratch.listChanges().map((change) => change.path));
  generateFiles(scratch, srcFolder, target, substitutions);
  return scratch
    .listChanges()
    .flatMap((change) =>
      change.type === 'CREATE' && change.content !== null && !seeded.has(change.path)
        ? [{ filePath: change.path, content: change.content.toString('utf-8') }]
        : [],
    )
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}
