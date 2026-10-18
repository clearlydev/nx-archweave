import { evaluateClaudeCliMatch } from './claude-cli-verification-result.ts';
import type { ClaudePluginListEntry } from './parse-claude-plugin-list.ts';

function entry(overrides: Partial<ClaudePluginListEntry> = {}): ClaudePluginListEntry {
  return { id: 'ponytail@ponytail', version: '4.8.4', scope: 'user', enabled: true, ...overrides };
}

describe('evaluateClaudeCliMatch', () => {
  it('reports verified for an enabled match, including its version and scope', () => {
    const result = evaluateClaudeCliMatch({ kind: 'matched', entry: entry() });
    expect(result).toEqual({ status: 'verified', version: '4.8.4', scope: 'user' });
  });

  it('reports verified even when version is missing', () => {
    const result = evaluateClaudeCliMatch({ kind: 'matched', entry: entry({ version: undefined }) });
    expect(result).toEqual({ status: 'verified', version: undefined, scope: 'user' });
  });

  it('reports installed-but-disabled for a disabled match', () => {
    const result = evaluateClaudeCliMatch({ kind: 'matched', entry: entry({ enabled: false }) });
    expect(result).toEqual({ status: 'installed-but-disabled', scope: 'user' });
  });

  it('reports absent when there is no match', () => {
    expect(evaluateClaudeCliMatch({ kind: 'absent' })).toEqual({ status: 'absent' });
  });

  it('reports ambiguous for duplicate matches', () => {
    const result = evaluateClaudeCliMatch({ kind: 'ambiguous', entries: [entry(), entry({ scope: 'project' })] });
    expect(result).toEqual({ status: 'ambiguous' });
  });
});
