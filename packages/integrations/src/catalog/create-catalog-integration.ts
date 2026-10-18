import type { ToolIntegration } from '../contracts/integration.ts';
import type { CommandRunner } from '../process/command-runner.ts';
import { PLUGIN_CATALOG, PLUGIN_HOSTS, type PluginCatalogEntry } from './plugin-catalog.ts';
import { resolveVersionFromNpmRegistry } from './resolve-version.ts';
import { detectWorkspacePackage } from '../hosts/claude-code/detect.ts';
import { createClaudeMarketplacePlan, VERSION_DECIDED_BY_MARKETPLACE } from '../hosts/claude-code/plan.ts';
import { createClaudeMarketplaceInstall } from '../hosts/claude-code/install.ts';
import { createClaudeMarketplaceVerifier } from '../hosts/claude-code/verify.ts';

export interface CatalogIntegrationDependencies {
  /** Serves both the read-only `plugin list` verification and — only behind an
   * ApprovedInstallPlan — the one mutating `plugin install` call. */
  runner: CommandRunner;
  /** Version resolver for plan() when no versionRange is pinned. Defaults to the npm
   * registry for an entry with an npm package (the marketplace decides otherwise); tests
   * inject a fake so they never touch the network. */
  resolveVersion?: (versionRange?: string) => Promise<string>;
}

function defaultResolveVersion(entry: PluginCatalogEntry): () => Promise<string> {
  const npmPackage = entry.npmPackage;
  return npmPackage === undefined
    ? async () => VERSION_DECIDED_BY_MARKETPLACE
    : () => resolveVersionFromNpmRegistry(npmPackage);
}

// A catalog entry (data) × its host adapter (code) = the ToolIntegration every generator,
// the manifest and doctor already work with. Factory, not a singleton — no module-level
// pre-wired object: the caller supplies the runtime dependency explicitly, every time.
// Claude Code is the only adapter today.
export function createCatalogIntegration(entry: PluginCatalogEntry, deps: CatalogIntegrationDependencies): ToolIntegration {
  return {
    id: entry.id,
    displayName: entry.displayName,
    homepage: entry.homepage,
    repository: entry.repository,
    license: entry.license,
    supportedEnvironments: PLUGIN_HOSTS.filter((host) => entry.hosts[host] !== undefined),
    detect: (context) => detectWorkspacePackage(entry, context),
    plan: createClaudeMarketplacePlan(entry, { resolveVersion: deps.resolveVersion ?? defaultResolveVersion(entry) }),
    install: createClaudeMarketplaceInstall(entry, { runner: deps.runner }),
    verify: createClaudeMarketplaceVerifier(entry, { runner: deps.runner }),
    uninstallInstructions: async () => [...entry.uninstallSteps],
  };
}

/** Every catalog entry as a ToolIntegration, in catalog order. */
export function createCatalogIntegrations(deps: CatalogIntegrationDependencies): ToolIntegration[] {
  return PLUGIN_CATALOG.map((entry) => createCatalogIntegration(entry, deps));
}
