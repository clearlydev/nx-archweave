import type { ToolkitAiHost } from '@nx-archweave/shared';
import type { ReviewProviderId } from '../review/provider.ts';
import type { AgentRuleFileName } from '../agent-rules/compose-agent-rules.ts';

/** What picking an AI host gives a workspace. The list is a
 * product decision; Nx's own agent names are only a mapping. Adding a host = one entry. */
export interface AiHostDefinition {
  id: ToolkitAiHost;
  label: string;
  /** `create-nx-workspace --aiAgents <nxAgent>` — which Nx AI files the host gets. */
  nxAgent: 'claude' | 'codex' | 'cursor' | 'gemini';
  /** The file the host reads its rules from (measured: only Claude reads CLAUDE.md). */
  rulesFile: AgentRuleFileName;
  /** The review provider this host's users most likely have a key for. */
  reviewProvider: ReviewProviderId;
}

export const AI_HOSTS: readonly AiHostDefinition[] = [
  { id: 'claude-code', label: 'Claude Code', nxAgent: 'claude', rulesFile: 'CLAUDE.md', reviewProvider: 'claude' },
  { id: 'codex', label: 'Codex', nxAgent: 'codex', rulesFile: 'AGENTS.md', reviewProvider: 'gpt' },
  { id: 'cursor', label: 'Cursor', nxAgent: 'cursor', rulesFile: 'AGENTS.md', reviewProvider: 'cursor' },
  { id: 'gemini-cli', label: 'Gemini CLI', nxAgent: 'gemini', rulesFile: 'AGENTS.md', reviewProvider: 'gemini' },
];

export const AI_HOST_IDS: readonly ToolkitAiHost[] = AI_HOSTS.map((host) => host.id);

/** When nothing picked a host (a standalone `nx g init`, an old config). */
export const DEFAULT_AI_HOSTS: readonly ToolkitAiHost[] = ['claude-code'];

export function isAiHost(value: unknown): value is ToolkitAiHost {
  return typeof value === 'string' && (AI_HOST_IDS as readonly string[]).includes(value);
}

function definitionOf(id: ToolkitAiHost): AiHostDefinition {
  const host = AI_HOSTS.find((candidate) => candidate.id === id);
  if (!host) throw new Error(`Unknown AI host "${id}"`); // unreachable: ids are typed
  return host;
}

/** The rules files the picked hosts read — each once, CLAUDE.md first. An empty list
 * falls back to the default host. */
export function rulesFilesFor(hosts: readonly ToolkitAiHost[]): AgentRuleFileName[] {
  const picked = hosts.length > 0 ? hosts : DEFAULT_AI_HOSTS;
  const files = new Set(picked.map((id) => definitionOf(id).rulesFile));
  return (['CLAUDE.md', 'AGENTS.md'] as const).filter((file) => files.has(file));
}

/** The review provider default: the first picked host's. */
export function reviewProviderFor(hosts: readonly ToolkitAiHost[]): ReviewProviderId {
  return definitionOf(hosts[0] ?? DEFAULT_AI_HOSTS[0]).reviewProvider;
}
