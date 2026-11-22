import { choosePlugins, resolvePluginFlag } from './plugins.ts';
import { PLUGIN_CHOICES } from './types.ts';

const ponytail = PLUGIN_CHOICES[0];

describe('choosePlugins — never asked; only --plugins installs any', () => {
  it('without --plugins: none, with or without a terminal (install-integration adds one later)', () => {
    expect(choosePlugins({ flag: undefined, aiHosts: ['claude-code'] })).toEqual({ plugins: [] });
  });

  it('--plugins installs the named ones, and an empty list means none', () => {
    expect(choosePlugins({ flag: ['ponytail'], aiHosts: ['claude-code'] })).toEqual({ plugins: [ponytail] });
    expect(choosePlugins({ flag: [], aiHosts: ['claude-code'] })).toEqual({ plugins: [] });
  });

  it('refuses a plugin whose host was not picked', () => {
    expect(choosePlugins({ flag: ['ponytail'], aiHosts: ['codex'] })).toEqual({
      error: '--plugins=ponytail installs into Claude Code, which is not among the AI hosts (codex) — add claude-code to --ai-hosts or drop the plugin.',
    });
  });
});

describe('resolvePluginFlag (also run by bin.ts before any question when both flags are passed)', () => {
  it('resolves ids of picked hosts, refuses the others', () => {
    expect(resolvePluginFlag(['ponytail'], ['codex', 'claude-code'])).toEqual({ plugins: [ponytail] });
    expect(resolvePluginFlag([], ['codex'])).toEqual({ plugins: [] });
    expect(resolvePluginFlag(['ponytail'], ['gemini-cli'])).toEqual({ error: expect.stringContaining('not among the AI hosts (gemini-cli)') });
    expect(resolvePluginFlag(['nope'], ['claude-code'])).toEqual({ error: 'Unknown plugin "nope" in --plugins. Supported: ponytail.' });
  });
});
