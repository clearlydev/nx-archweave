import type { IntegrationInstallScope, IntegrationOptions, InstallPlan } from '../../contracts/integration.ts';
import type { PluginCatalogEntry } from '../../catalog/plugin-catalog.ts';

/** resolvedVersion when nothing is pinned and the registry lookup is skipped: the
 * Claude Code marketplace installs its own latest, and the version that actually got
 * installed is the one recorded after verification. */
export const VERSION_DECIDED_BY_MARKETPLACE = 'latest (decided by the marketplace)';

/** Files Claude Code changes INSIDE the workspace for each scope (user scope writes only
 * to the user's own settings, outside the workspace — not listed, not ours). */
const WORKSPACE_FILES_BY_SCOPE: Record<'user' | 'project' | 'local', string[]> = {
  user: [],
  project: ['.claude/settings.json'],
  local: ['.claude/settings.local.json'],
};

export interface ClaudeMarketplacePlanDependencies {
  resolveVersion: (versionRange?: string) => Promise<string>;
}

/** The default install scope:
 * project — Claude Code records the plugin in the workspace's .claude/settings.json
 * instead of the user's own settings. `--marketplace` itself registers the marketplace in
 * user settings, so at this scope install-integration also
 * runs projectMarketplaceCommand (install.ts) to declare it in the workspace. */
export const DEFAULT_PLUGIN_SCOPE: IntegrationInstallScope = 'project';

// Dependency-injected so tests never hit the real npm registry (the real
// resolver — resolveVersionFromNpmRegistry, wired by createCatalogIntegration — does a
// real network call; that only happens in production use, never in unit tests).
export function createClaudeMarketplacePlan(
  entry: PluginCatalogEntry,
  deps: ClaudeMarketplacePlanDependencies,
): (options: IntegrationOptions) => Promise<InstallPlan> {
  return async (options: IntegrationOptions): Promise<InstallPlan> => {
    const distribution = entry.hosts['claude-code'];
    if (options.targetEnvironment !== 'claude-code' || distribution === undefined) {
      const supported = Object.entries(entry.hosts)
        .filter(([, value]) => value !== undefined)
        .map(([host]) => host)
        .join(', ');
      throw new Error(
        `Target environment "${options.targetEnvironment}" is not supported by this integration. ` +
          `Supported: ${supported}.`,
      );
    }

    // Explicit versionRange is treated as an exact pin, per the user's request.
    // Resolving an actual semver *range* against the registry's version list is out
    // of scope — an exact version string is what's supported.
    const resolvedVersion =
      options.versionRange ??
      (options.resolveLatestVersion === false ? VERSION_DECIDED_BY_MARKETPLACE : await deps.resolveVersion(options.versionRange));

    // Claude Code ≥ 2.1.285 exposes the plugin install as a real CLI command
    // (flags read from `claude plugin install
    // --help`, not guessed). `--marketplace <source>` adds the marketplace first
    // when it is not registered yet, so the README's two slash commands collapse
    // into ONE subprocess — and InstallPlan.officialCommand's single-command
    // shape fits without a contract change. `-y` / `--accept-command` are never
    // part of it: a marketplace-declared command is a person's call.
    const scope = options.scope ?? DEFAULT_PLUGIN_SCOPE;
    return {
      officialCommand: {
        executable: 'claude',
        args: [
          'plugin',
          'install',
          distribution.name,
          '--marketplace',
          distribution.marketplace,
          '--scope',
          scope,
          '--json',
        ],
      },
      resolvedVersion,
      filesCreated: [],
      // project/local scope: Claude Code records the plugin in the workspace's own
      // .claude settings — shown before approval as the files that will change.
      filesModified: [...WORKSPACE_FILES_BY_SCOPE[scope]],
      conflicts: [],
      sourceRepository: entry.repository,
      officialHomepage: entry.homepage,
      license: entry.license,
      requiresManualExecution: false,
    };
  };
}
