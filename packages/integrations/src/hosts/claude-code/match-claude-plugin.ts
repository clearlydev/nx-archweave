import type { ClaudePluginListEntry } from './parse-claude-plugin-list.ts';

export type PluginMatchResult =
  | { kind: 'matched'; entry: ClaudePluginListEntry }
  | { kind: 'absent' }
  | { kind: 'ambiguous'; entries: ClaudePluginListEntry[] };

// Exact id equality only — no substring/prefix matching. Two or more matches
// are ambiguous and must never be arbitrarily resolved to one.
export function matchClaudePlugin(entries: ClaudePluginListEntry[], pluginId: string): PluginMatchResult {
  const matches = entries.filter((candidate) => candidate.id === pluginId);
  if (matches.length === 0) {
    return { kind: 'absent' };
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', entries: matches };
  }
  return { kind: 'matched', entry: matches[0] };
}
