import { spawnSync } from 'node:child_process';
import { spawnableCommand } from '@nx-archweave/shared';
import type { GeneratorCallback, Tree } from '@nx/devkit';
import {
  allowPackageBuilds,
  detectWorkspacePackageManager,
  isPlainPackageName,
  missingFromLockfile,
  pnpmMajorFromModulesManifest,
} from '@nx-archweave/template-engine';
import type { AllowBuildsGeneratorSchema } from './schema.d.ts';
import { renderAllowBuildsReport, type AllowBuildsReport } from './render.ts';

const WORKSPACE_YAML = 'pnpm-workspace.yaml';
const LOCKFILE = 'pnpm-lock.yaml';
/** Where pnpm records which version installed node_modules. */
const MODULES_MANIFEST = 'node_modules/.modules.yaml';

/** Runs `pnpm <args>` in `cwd`. Injected for tests; the real one inherits stdio so the
 * package's own install output reaches the terminal. */
export type RebuildExec = (args: string[], cwd: string) => { status: number | null; error?: Error };

const spawnPnpm: RebuildExec = (args, cwd) => {
  // No shell, like every other command this repo spawns; on Windows pnpm's .cmd shim runs
  // through cmd.exe with every argument escaped (spawnableCommand).
  const spawnable = spawnableCommand('pnpm', args);
  const result = spawnSync(spawnable.command, spawnable.args, {
    cwd,
    stdio: 'inherit',
    windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
  });
  return { status: result.status, error: result.error };
};

/**
 * allow-builds: the way back from a build pnpm skipped or was told
 * to deny. Preview by default; `--apply` writes the decision through the Tree and
 * returns the `pnpm rebuild` that Nx runs after the flush. Refusals are reports and
 * write nothing; a name that is not a plain npm package name is an input error.
 */
export function runAllowBuilds(
  tree: Tree,
  options: AllowBuildsGeneratorSchema,
  deps: { exec?: RebuildExec } = {},
): { report: AllowBuildsReport; callback?: GeneratorCallback } {
  const packages = [...new Set(options.packages.map((name) => name.trim()))];
  const invalid = packages.filter((name) => !isPlainPackageName(name));
  if (packages.length === 0 || invalid.length > 0) {
    throw new Error(
      `Expected npm package names (e.g. --packages=sharp,@swc/core)${invalid.length > 0 ? `; not a package name: ${invalid.map((name) => JSON.stringify(name)).join(', ')}` : ''}.`,
    );
  }
  // `nx g` owns --dry-run (it strips a dryRun option), so approval is --apply; Nx's own
  // --dry-run still wins through NX_DRY_RUN.
  const apply = (options.apply ?? false) && process.env['NX_DRY_RUN'] !== 'true';

  const pm = detectWorkspacePackageManager((path) => tree.exists(path), (path) => tree.read(path, 'utf-8'));
  if (pm === 'npm') return { report: { packages, refused: 'npm' } };
  if (pm === 'yarn') return { report: { packages, refused: 'yarn' } };
  if (pm === 'bun') return { report: { packages, refused: 'bun' } };
  if (pm === null) return { report: { packages, refused: 'no-package-manager' } };
  const yaml = tree.read(WORKSPACE_YAML, 'utf-8');
  if (yaml === null) return { report: { packages, refused: 'no-workspace-yaml' } };

  const lockfile = tree.read(LOCKFILE, 'utf-8');
  const unknown = lockfile === null ? [] : missingFromLockfile(lockfile, packages);
  if (unknown.length > 0) return { report: { packages, refused: 'unknown-packages', unknown } };

  const modules = tree.read(MODULES_MANIFEST, 'utf-8');
  const pnpmMajor = modules === null ? undefined : pnpmMajorFromModulesManifest(modules);
  const result = allowPackageBuilds(yaml, packages, { pnpmMajor });
  if (result.status === 'unrecognized') return { report: { packages, refused: 'unrecognized', reason: result.reason } };

  const report: AllowBuildsReport = {
    packages,
    target: result.target,
    changes: result.changes,
    applied: apply,
    ...(lockfile === null ? { namesUnchecked: true } : {}),
  };
  if (!apply) return { report };

  if (result.status === 'updated') tree.write(WORKSPACE_YAML, result.text);
  const exec = deps.exec ?? spawnPnpm;
  const root = tree.root;
  const callback: GeneratorCallback = () => {
    const args = ['rebuild', ...packages];
    const command = `pnpm ${args.join(' ')}`;
    const outcome = exec(args, root);
    if (outcome.error) {
      throw new Error(`"${command}" could not start: ${outcome.error.message}. ${WORKSPACE_YAML} already allows the build — run "${command}" yourself.`);
    }
    if (outcome.status !== 0) {
      throw new Error(`"${command}" exited with ${outcome.status ?? 'a signal'}. ${WORKSPACE_YAML} already allows the build — fix the cause above, then run "${command}" yourself.`);
    }
  };
  return { report, callback };
}

export async function allowBuildsGenerator(
  tree: Tree,
  options: AllowBuildsGeneratorSchema,
  deps: { exec?: RebuildExec } = {},
): Promise<GeneratorCallback | undefined> {
  const { report, callback } = runAllowBuilds(tree, options, deps);
  console.log(renderAllowBuildsReport(report));
  return callback;
}

export default allowBuildsGenerator;
