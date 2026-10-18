import { matchClaudePlugin } from './match-claude-plugin.ts';
import type { ClaudePluginListEntry } from './parse-claude-plugin-list.ts';

function entry(overrides: Partial<ClaudePluginListEntry> = {}): ClaudePluginListEntry {
  return { id: 'ponytail@ponytail', version: '4.8.4', scope: 'user', enabled: true, ...overrides };
}

describe('matchClaudePlugin', () => {
  it('finds an exact id match', () => {
    const result = matchClaudePlugin([entry()], 'ponytail@ponytail');
    expect(result).toEqual({ kind: 'matched', entry: entry() });
  });

  it('ignores an unrelated plugin id', () => {
    const result = matchClaudePlugin(
      [entry({ id: 'frontend-design@claude-plugins-official' })],
      'ponytail@ponytail',
    );
    expect(result).toEqual({ kind: 'absent' });
  });

  it('reports absent for an empty list', () => {
    expect(matchClaudePlugin([], 'ponytail@ponytail')).toEqual({ kind: 'absent' });
  });

  it('does not match a similar but different id (no substring/prefix match)', () => {
    const result = matchClaudePlugin([entry({ id: 'ponytail@other-marketplace' })], 'ponytail@ponytail');
    expect(result).toEqual({ kind: 'absent' });
  });

  it('reports ambiguous when two entries share the same exact id', () => {
    const duplicate = [entry({ scope: 'user' }), entry({ scope: 'project' })];
    const result = matchClaudePlugin(duplicate, 'ponytail@ponytail');
    expect(result).toEqual({ kind: 'ambiguous', entries: duplicate });
  });
});
