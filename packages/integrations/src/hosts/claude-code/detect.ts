import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DetectionResult, IntegrationContext } from '../../contracts/integration.ts';
import type { PluginCatalogEntry } from '../../catalog/plugin-catalog.ts';

// Read-only — checks only a single, clearly
// scoped location (the workspace root package.json), never scans the user's
// home directory. Claude Code's own plugin-marketplace install state lives
// outside the workspace and is not reliably discoverable from here (it is
// managed entirely by the Claude Code host) — this function is honest about
// that limit rather than guessing. A plugin without an npm package has no such signal.
export async function detectWorkspacePackage(entry: PluginCatalogEntry, context: IntegrationContext): Promise<DetectionResult> {
  const npmPackage = entry.npmPackage;
  if (npmPackage === undefined) {
    return { installed: false, managedBy: 'unknown', evidence: [] };
  }
  const packageJsonPath = join(context.workspaceRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return { installed: false, managedBy: 'unknown', evidence: [] };
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return { installed: false, managedBy: 'unknown', evidence: [] };
  }

  const deps = (pkg['dependencies'] ?? {}) as Record<string, string>;
  const devDeps = (pkg['devDependencies'] ?? {}) as Record<string, string>;
  const version = deps[npmPackage] ?? devDeps[npmPackage];

  if (!version) {
    return { installed: false, managedBy: 'unknown', evidence: [] };
  }

  return {
    installed: true,
    installedVersion: version,
    managedBy: 'external-tool',
    evidence: [`package.json: ${npmPackage}@${version}`],
  };
}
