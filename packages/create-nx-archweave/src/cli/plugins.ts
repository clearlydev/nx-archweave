import { AI_HOST_CHOICES, PLUGIN_CHOICES, type CliAiHost, type CliPluginChoice } from './types.ts';
import type { InstalledHosts } from './host-probe.ts';
import type { Ask } from './prompts.ts';

export interface PluginInput {
  /** `--plugins`, when passed (`none` → []). */
  flag: string[] | undefined;
  aiHosts: readonly CliAiHost[];
  /** undefined: not probed — every picked host's plugins are offered. */
  installedHosts: InstalledHosts | undefined;
  interactive: boolean;
  /** How the user runs a generator in the new workspace, for the "later" hint. */
  nxG: string;
}

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

/** `1`, `1,2`, `ponytail` or a mix, among `offered`; empty means none. Undefined for
 * anything else — the question is asked again. */
export function parsePluginAnswer(answer: string, offered: readonly CliPluginChoice[]): CliPluginChoice[] | undefined {
  const tokens = answer.split(/[\s,]+/).filter((token) => token.length > 0);
  const picked: CliPluginChoice[] = [];
  for (const token of tokens) {
    const byNumber = /^\d+$/.test(token) ? offered[Number(token) - 1] : undefined;
    const plugin = byNumber ?? offered.find((choice) => choice.id === token.toLowerCase());
    if (!plugin) return undefined;
    if (!picked.includes(plugin)) picked.push(plugin);
  }
  return picked;
}

export function pluginQuestion(host: CliAiHost, offered: readonly CliPluginChoice[]): string {
  return [
    `? Plugins for ${hostLabel(host)} — install now, into this workspace (project scope)?`,
    ...offered.map((plugin, index) => `  ${index + 1}) ${plugin.label} — ${plugin.description} (${plugin.license})`),
    'Choose, e.g. 1 — Enter to skip []: ',
  ].join('\n');
}

/**
 * The optional plugins, asked last. A flag always wins; it
 * may only name plugins of a picked host. Without a terminal and without the flag: none.
 * Asked once per picked host that has catalog plugins and whose CLI was found — installing
 * runs that CLI, so a host this machine lacks gets a one-line "later" hint instead.
 */
export async function choosePlugins(input: PluginInput, ask: Ask, log: (line: string) => void): Promise<PluginResolution> {
  if (input.flag !== undefined) return resolvePluginFlag(input.flag, input.aiHosts);
  if (!input.interactive) return { plugins: [] };

  const plugins: CliPluginChoice[] = [];
  for (const host of input.aiHosts) {
    const offered = PLUGIN_CHOICES.filter((plugin) => plugin.host === host);
    if (offered.length === 0) continue;
    if (input.installedHosts !== undefined && input.installedHosts[host] === undefined) {
      log(
        `${hostLabel(host)} was not found, so its plugins (${offered.map((plugin) => plugin.id).join(', ')}) are not offered. ` +
          `Once it is installed, inside the workspace: ${input.nxG} @clearlydev/nx-archweave:install-integration --tool=<plugin> --apply`,
      );
      continue;
    }
    const question = pluginQuestion(host, offered);
    for (;;) {
      const picked = parsePluginAnswer(await ask(question), offered);
      if (picked) {
        plugins.push(...picked);
        break;
      }
    }
  }
  return { plugins };
}
