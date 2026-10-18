/**
 * Literal option types shared by the parse/prompt/plan layers.
 *
 * These are intentionally NOT imported from `@nx-archweave/shared` or
 * `@nx-archweave/template-engine`: the CLI stream owns none of that policy (no content
 * or policy knowledge), it only forwards option values — so the literals here are
 * copied from `packages/nx-plugin/src/generators/init/schema.json`'s `preset`,
 * `frontend`, and `locale` enums, not derived from them. If the schema's enum ever
 * changes, this file must be updated to match by hand.
 */

export type CliPreset = 'quick-start' | 'solo' | 'team';
export type CliFrontend = 'react-vite' | 'next' | 'none';
export type CliBackend = 'express' | 'nest' | 'none';
export type CliLocale = 'ko' | 'en';

export const PRESET_VALUES: readonly CliPreset[] = ['quick-start', 'solo', 'team'];
export const FRONTEND_VALUES: readonly CliFrontend[] = ['react-vite', 'next', 'none'];
export const BACKEND_VALUES: readonly CliBackend[] = ['express', 'nest', 'none'];
export const LOCALE_VALUES: readonly CliLocale[] = ['ko', 'en'];

/** The AI coding tools (hosts) the workspace is set up for — copied from init's `aiHosts`
 * enum (types.spec.ts keeps the copy equal to it). `nxAgent` is orchestration knowledge,
 * like `--pm`: what `create-nx-workspace --aiAgents` calls the host. Which files and
 * review provider a host gets is the plugin's policy, not the CLI's. */
export type CliAiHost = 'claude-code' | 'codex' | 'cursor' | 'gemini-cli';

export type CliReviewProvider = 'claude' | 'gemini' | 'gpt' | 'cursor';

/** `reviewProvider` is the host's default review provider — a copy of template-engine's
 * AI host table (types.spec.ts keeps it equal), shown as the review question's default. */
export const AI_HOST_CHOICES: readonly { id: CliAiHost; label: string; nxAgent: string; reviewProvider: CliReviewProvider }[] = [
  { id: 'claude-code', label: 'Claude Code', nxAgent: 'claude', reviewProvider: 'claude' },
  { id: 'codex', label: 'Codex', nxAgent: 'codex', reviewProvider: 'gpt' },
  { id: 'cursor', label: 'Cursor', nxAgent: 'cursor', reviewProvider: 'cursor' },
  { id: 'gemini-cli', label: 'Gemini CLI', nxAgent: 'gemini', reviewProvider: 'gemini' },
];

/** init's `reviewProvider` enum (types.spec.ts keeps it equal), with display labels. */
export const REVIEW_PROVIDER_CHOICES: readonly { id: CliReviewProvider; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'gpt', label: 'GPT' },
  { id: 'cursor', label: 'Cursor' },
];

export const REVIEW_PROVIDER_VALUES: readonly CliReviewProvider[] = REVIEW_PROVIDER_CHOICES.map((provider) => provider.id);

export const AI_HOST_VALUES: readonly CliAiHost[] = AI_HOST_CHOICES.map((host) => host.id);

/** Used when nothing picked a host: a non-interactive run without --ai-hosts, or Enter. */
export const DEFAULT_AI_HOSTS: readonly CliAiHost[] = ['claude-code'];

/** The command each host's `--version` probe runs, measured
 * 2026-10-15: claude → "2.1.300 (Claude Code)", codex → "codex-cli 0.162.1", gemini →
 * "0.64.0". Cursor's installer links `cursor-agent` and a generic `agent`; only the
 * unambiguous name is probed, as Cursor's install guides name it. */
export const AI_HOST_PROBES: Readonly<Record<CliAiHost, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor-agent',
  'gemini-cli': 'gemini',
};

/** The plugins the CLI can offer — copied from the plugin catalog
 * (packages/integrations/src/catalog/plugin-catalog.ts; types.spec.ts keeps the copy equal
 * to it and to install-integration's `--tool` / `--target` enums). The CLI only forwards
 * the id to `install-integration`, which owns how a plugin is installed and verified. */
export interface CliPluginChoice {
  id: string;
  label: string;
  description: string;
  license: string;
  host: CliAiHost;
}

export const PLUGIN_CHOICES: readonly CliPluginChoice[] = [
  {
    id: 'ponytail',
    label: 'ponytail',
    description: 'over-engineering review rules and skills — "makes your AI agent think like the laziest senior dev in the room"',
    license: 'MIT',
    host: 'claude-code',
  },
];

export const PLUGIN_VALUES: readonly string[] = PLUGIN_CHOICES.map((plugin) => plugin.id);
