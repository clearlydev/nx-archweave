import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectWorkspacePackageManager } from '../environment/package-manager.ts';

export interface EnvironmentDetection {
  hasNxWorkspace: boolean;
  nxVersion?: string;
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
  rootPackageJson?: Record<string, unknown>;
  rootPackageJsonError?: string;
}

export function detectEnvironment(root: string): EnvironmentDetection {
  const hasNxWorkspace = existsSync(join(root, 'nx.json'));
  if (!hasNxWorkspace) {
    return { hasNxWorkspace: false };
  }

  let nxVersion: string | undefined;
  let rootPackageJson: Record<string, unknown> | undefined;
  let rootPackageJsonError: string | undefined;
  const packageJsonPath = join(root, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      rootPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const deps = rootPackageJson?.['devDependencies'] as Record<string, string> | undefined;
      const deps2 = rootPackageJson?.['dependencies'] as Record<string, string> | undefined;
      nxVersion = deps?.['nx'] ?? deps2?.['nx'];
    } catch (error) {
      // A single unreadable/malformed file must not crash the whole diagnosis:
      // record the failure and let the caller decide the
      // status of the checks that depend on this data.
      rootPackageJsonError = error instanceof Error ? error.message : String(error);
    }
  }

  // The generators' own rule (detectWorkspacePackageManager), so doctor never
  // contradicts them — pnpm markers first, a stray lockfile settled by packageManager.
  const exists = (path: string) => existsSync(join(root, path));
  const packageManager: EnvironmentDetection['packageManager'] =
    detectWorkspacePackageManager(exists, (path) => (exists(path) ? readFileSync(join(root, path), 'utf-8') : undefined)) ?? undefined;

  return { hasNxWorkspace, nxVersion, packageManager, rootPackageJson, rootPackageJsonError };
}
