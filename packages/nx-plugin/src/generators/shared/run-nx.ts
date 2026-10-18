import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageManagerCommands } from '@nx-archweave/template-engine';
import { TOOLKIT_CONFIG_PATH, workspacePackageManager } from './toolkit-config-file.ts';

/** How a person runs the workspace's own nx — `pnpm nx`, `yarn nx`, `bun nx` or
 * `npm exec nx --` — for the commands generators print. The detected package manager, then
 * the one init recorded, else pnpm (the same order init, add-backend and add-review use). */
export function runNxFor(exists: (path: string) => boolean, read: (path: string) => string | null | undefined): string {
  let config: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(read(TOOLKIT_CONFIG_PATH) ?? 'null');
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
  } catch {
    // an unreadable config only means nothing is recorded
  }
  return packageManagerCommands(workspacePackageManager(exists, read, config) ?? 'pnpm').runNx;
}

/** From the workspace on disk — doctor and the integration generators, which act on the
 * real workspace (tree.root) rather than the Nx Tree. */
export function diskRunNx(root: string): string {
  return runNxFor(
    (path) => existsSync(join(root, path)),
    (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf-8') : undefined),
  );
}
