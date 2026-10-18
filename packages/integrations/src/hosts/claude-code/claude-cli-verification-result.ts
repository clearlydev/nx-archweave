import type { ClaudePluginListEntry } from './parse-claude-plugin-list.ts';
import type { PluginMatchResult } from './match-claude-plugin.ts';

export type ClaudeCliVerificationOutcome =
  | { status: 'verified'; version: string | undefined; scope: ClaudePluginListEntry['scope'] }
  | { status: 'installed-but-disabled'; scope: ClaudePluginListEntry['scope'] }
  | { status: 'absent' }
  | { status: 'ambiguous' };

// Deliberately keeps "installed but disabled" distinct from "absent" — a
// disabled plugin is detected, just not recordable as verified.
export function evaluateClaudeCliMatch(match: PluginMatchResult): ClaudeCliVerificationOutcome {
  switch (match.kind) {
    case 'matched':
      return match.entry.enabled
        ? { status: 'verified', version: match.entry.version, scope: match.entry.scope }
        : { status: 'installed-but-disabled', scope: match.entry.scope };
    case 'absent':
      return { status: 'absent' };
    case 'ambiguous':
      return { status: 'ambiguous' };
  }
}
