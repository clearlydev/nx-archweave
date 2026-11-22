import { AI_HOST_CHOICES, PLUGIN_CHOICES, type CliAiHost, type CliPluginChoice } from './types.ts';

export type PluginResolution = { plugins: CliPluginChoice[] } | { error: string };

const hostLabel = (host: CliAiHost): string => AI_HOST_CHOICES.find((choice) => choice.id === host)?.label ?? host;

/** `--plugins` against the picked hosts: an unknown id or a plugin of a host not picked is
 * an error. bin.ts runs it before any question when both flags were passed. */
export function resolvePluginFlag(ids: readonly string[], aiHosts: readonly CliAiHost[]): PluginResolution {
  const plugins: CliPluginChoice[] = [];
  for (const id of ids) {
    const plugin = PLUGIN_CHOICES.find((choice) => choice.id === id);
    if (!plugin) return { error: `Unknown plugin "${id}" in --plugins. Supported: ${PLUGIN_CHOICES.map((choice) => choice.id).join(', ')}.` };
    if (!aiHosts.includes(plugin.host)) {
      return {
        error:
          `--plugins=${id} installs into ${hostLabel(plugin.host)}, which is not among the AI hosts (${aiHosts.join(', ')}) — ` +
          `add ${plugin.host} to --ai-hosts or drop the plugin.`,
      };
    }
    plugins.push(plugin);
  }
  return { plugins };
}

/**
 * The optional plugins: only what --plugins names, never asked. The flag may only name plugins
 * of a picked host. Without it, none — a plugin is added later with install-integration.
 */
export function choosePlugins(input: { flag: string[] | undefined; aiHosts: readonly CliAiHost[] }): PluginResolution {
  return input.flag === undefined ? { plugins: [] } : resolvePluginFlag(input.flag, input.aiHosts);
}
