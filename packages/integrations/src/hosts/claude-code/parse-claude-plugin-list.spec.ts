import { parseClaudePluginList } from './parse-claude-plugin-list.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(__dirname, '../../../../../tools/fixtures/integrations/claude-plugin-list');
const read = (name: string) => readFileSync(join(FIXTURES, `${name}.json`), 'utf8');

describe('parseClaudePluginList', () => {
  it('parses a well-formed list with an enabled match', () => {
    const result = parseClaudePluginList(read('enabled-match'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toEqual([
        { id: 'ponytail@ponytail', version: '4.8.4', scope: 'user', enabled: true },
      ]);
    }
  });

  it('parses a disabled match correctly', () => {
    const result = parseClaudePluginList(read('disabled-match'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries[0].enabled).toBe(false);
    }
  });

  it('parses an unrelated plugin without matching anything meaningful yet', () => {
    const result = parseClaudePluginList(read('no-match'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries[0].id).toBe('frontend-design@claude-plugins-official');
    }
  });

  it('parses duplicate matching entries with different scopes', () => {
    const result = parseClaudePluginList(read('duplicate-match'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].scope).toBe('user');
      expect(result.entries[1].scope).toBe('project');
    }
  });

  it('rejects malformed JSON without throwing', () => {
    expect(() => parseClaudePluginList(read('malformed'))).not.toThrow();
    expect(parseClaudePluginList(read('malformed'))).toEqual({ ok: false, reason: 'invalid-json' });
  });

  it('rejects a non-array top-level value', () => {
    expect(parseClaudePluginList(read('non-array'))).toEqual({ ok: false, reason: 'non-array' });
  });

  it('rejects an entry missing required fields', () => {
    expect(parseClaudePluginList(read('missing-fields'))).toEqual({ ok: false, reason: 'missing-fields' });
  });

  it('accepts an empty list', () => {
    expect(parseClaudePluginList(read('empty'))).toEqual({ ok: true, entries: [], otherScopeIds: [] });
  });

  it('never includes installPath on the parsed entry type', () => {
    const result = parseClaudePluginList(read('enabled-match'));
    if (result.ok) {
      expect((result.entries[0] as unknown as Record<string, unknown>)['installPath']).toBeUndefined();
    }
  });

  it('never includes installedAt/lastUpdated on the parsed entry type', () => {
    const result = parseClaudePluginList(read('enabled-match'));
    if (result.ok) {
      const entry = result.entries[0] as unknown as Record<string, unknown>;
      expect(entry['installedAt']).toBeUndefined();
      expect(entry['lastUpdated']).toBeUndefined();
    }
  });

  it.each(['user', 'project', 'local', 'managed'] as const)('accepts the supported scope value %s', (scope) => {
    const result = parseClaudePluginList(JSON.stringify([{ id: 'ponytail@ponytail', enabled: true, scope }]));
    expect(result).toEqual({ ok: true, entries: [{ id: 'ponytail@ponytail', version: undefined, scope, enabled: true }], otherScopeIds: [] });
  });

  it('sets an entry at an unknown scope aside by id instead of voiding the list (Claude Code 2.1.300 "synced", measured)', () => {
    const result = parseClaudePluginList(
      JSON.stringify([
        { id: 'figma@synced', version: '2.2.157', scope: 'synced', enabled: true, installPath: '/root/.claude/plugins/synced/x' },
        { id: 'ponytail@ponytail', enabled: true, scope: 'project' },
      ]),
    );
    expect(result).toEqual({
      ok: true,
      entries: [{ id: 'ponytail@ponytail', version: undefined, scope: 'project', enabled: true }],
      otherScopeIds: ['figma@synced'],
    });
  });

  it.each([[''], [3], [null]])('rejects an entry whose scope is not a non-empty string (%j)', (scope) => {
    const result = parseClaudePluginList(JSON.stringify([{ id: 'ponytail@ponytail', enabled: true, scope }]));
    expect(result).toEqual({ ok: false, reason: 'missing-fields' });
  });

  it('rejects an entry with a non-boolean enabled value', () => {
    const result = parseClaudePluginList(
      JSON.stringify([{ id: 'ponytail@ponytail', enabled: 'yes', scope: 'user' }]),
    );
    expect(result).toEqual({ ok: false, reason: 'missing-fields' });
  });

  it('accepts an entry with no version field', () => {
    const result = parseClaudePluginList(
      JSON.stringify([{ id: 'ponytail@ponytail', enabled: true, scope: 'user' }]),
    );
    expect(result).toEqual({
      ok: true,
      entries: [{ id: 'ponytail@ponytail', version: undefined, scope: 'user', enabled: true }],
      otherScopeIds: [],
    });
  });
});

describe('parseClaudePluginList — project-scope entries of other projects', () => {
  // Measured, Claude Code 2.1.300, in a new workspace after installing at project scope elsewhere.
  const LISTED = JSON.stringify([
    { id: 'ponytail@ponytail', version: '5.2.0', scope: 'project', enabled: false, projectPath: '/work/other', projectEnabled: false },
    { id: 'ponytail@ponytail', version: '5.2.0', scope: 'project', enabled: true, projectPath: '/work/this', projectEnabled: true },
    { id: 'figma@synced', scope: 'synced', enabled: true },
  ]);

  it("drops another project's entry when asked about this workspace, and never keeps the path", () => {
    expect(parseClaudePluginList(LISTED, { isThisWorkspace: (path) => path === '/work/this' })).toEqual({
      ok: true,
      entries: [{ id: 'ponytail@ponytail', version: '5.2.0', scope: 'project', enabled: true }],
      otherScopeIds: ['figma@synced'],
    });
  });

  it('without the option every entry counts (as before)', () => {
    const result = parseClaudePluginList(LISTED);
    expect(result.ok && result.entries).toHaveLength(2);
  });
});
