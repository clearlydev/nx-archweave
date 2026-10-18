// The plugin catalog — DATA, not code. Each entry is a
// reviewed plugin with an official install path, described per AI host. How a host
// installs and verifies a plugin is code (hosts/<host>/), shared by every entry; adding a
// plugin for an existing host is one entry here plus its copies, which tests keep equal:
// the generators' --tool enums (catalog-schema-enums.spec.ts) and the create CLI's
// PLUGIN_CHOICES (create-nx-archweave cli/types.spec.ts — the CLI imports nothing).
//
// This is not the installed-state manifest (manifest/manifest.ts, archweave-integrations.json).

/** AI hosts that have a plugin adapter (hosts/<host>/). */
export const PLUGIN_HOSTS = ['claude-code'] as const;
export type PluginHost = (typeof PLUGIN_HOSTS)[number];

/** A plugin distributed through a Claude Code plugin marketplace. */
export interface ClaudeMarketplaceDistribution {
  /** `claude plugin install <name>` */
  name: string;
  /** `--marketplace <source>` — also the manifest entry's `source`. */
  marketplace: string;
  /** How `claude plugin list --json` reports it: `<name>@<marketplace's own name>`. */
  pluginId: string;
}

export interface PluginCatalogEntry {
  id: string;
  displayName: string;
  /** One line, shown where the plugin is offered. */
  description: string;
  homepage: string;
  repository: string;
  license: string;
  /** The plugin's npm package, when it ships one: the version source when nothing is
   * pinned, and the weak workspace-dependency signal when the host CLI is missing. */
  npmPackage?: string;
  /** The official install instructions (linked from every manual alternative). */
  installDocs: string;
  /** The official uninstall instructions, verbatim. */
  uninstallSteps: string[];
  hosts: { 'claude-code'?: ClaudeMarketplaceDistribution };
}

export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = [
  {
    // Researched 2026-07-15. The claude-code values are the ones the manifest and verifier
    // were measured with. ponytail documents official installs for ~20 hosts; only claude-code
    // has an adapter.
    id: 'ponytail',
    displayName: 'ponytail',
    // The project's own tagline.
    description: 'over-engineering review rules and skills — "makes your AI agent think like the laziest senior dev in the room"',
    homepage: 'https://ponytail.dev',
    repository: 'https://github.com/DietrichGebert/ponytail',
    license: 'MIT',
    npmPackage: '@dietrichgebert/ponytail',
    installDocs: 'https://github.com/DietrichGebert/ponytail#install',
    uninstallSteps: [
      'Run this from a clone of https://github.com/DietrichGebert/ponytail (or before removing the plugin below — ' +
        'the script is itself a plugin file, so removing the plugin first deletes it): node scripts/uninstall.js',
      "Then remove the plugin via your host's own command, e.g. in Claude Code: /plugin uninstall ponytail@ponytail " +
        '(or use the Claude Code Desktop app: Customize > manage marketplaces > remove plugin).',
      'See https://github.com/DietrichGebert/ponytail#uninstall for the full, current official instructions.',
    ],
    hosts: {
      'claude-code': { name: 'ponytail', marketplace: 'DietrichGebert/ponytail', pluginId: 'ponytail@ponytail' },
    },
  },
];

export const PLUGIN_IDS: readonly string[] = PLUGIN_CATALOG.map((entry) => entry.id);

export function getCatalogEntry(id: string): PluginCatalogEntry | undefined {
  return PLUGIN_CATALOG.find((entry) => entry.id === id);
}

/** The catalog entries a host can install, in catalog order. */
export function catalogEntriesFor(host: PluginHost): PluginCatalogEntry[] {
  return PLUGIN_CATALOG.filter((entry) => entry.hosts[host] !== undefined);
}

/** The manifest method every Claude Code marketplace install is recorded under. */
export const CLAUDE_MARKETPLACE_METHOD = 'claude-code-plugin-marketplace';

/** What the manifest records about where a plugin came from. */
export function recordMetadataFor(entry: PluginCatalogEntry): { source: string; repository: string; method: string } | undefined {
  const claude = entry.hosts['claude-code'];
  if (!claude) return undefined;
  return { source: claude.marketplace, repository: entry.repository, method: CLAUDE_MARKETPLACE_METHOD };
}
