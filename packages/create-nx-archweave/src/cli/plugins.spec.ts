import { choosePlugins, parsePluginAnswer, pluginQuestion, resolvePluginFlag, type PluginInput } from './plugins.ts';
import { PLUGIN_CHOICES } from './types.ts';
import type { Ask } from './prompts.ts';

const ponytail = PLUGIN_CHOICES[0];

function scripted(answers: string[]): { ask: Ask; calls: string[]; logs: string[]; log: (line: string) => void } {
  const calls: string[] = [];
  const logs: string[] = [];
  return {
    ask: async (question) => {
      calls.push(question);
      return answers.shift() ?? '';
    },
    calls,
    logs,
    log: (line) => logs.push(line),
  };
}

const base: PluginInput = {
  flag: undefined,
  aiHosts: ['claude-code'],
  installedHosts: { 'claude-code': '2.1.300' },
  interactive: true,
  nxG: 'pnpm nx g',
};

describe('parsePluginAnswer', () => {
  it.each([
    ['', []],
    ['1', [ponytail]],
    ['ponytail, 1', [ponytail]],
    ['PONYTAIL', [ponytail]],
  ])('%j', (answer, expected) => {
    expect(parsePluginAnswer(answer, [ponytail])).toEqual(expected);
  });

  it.each(['2', '0', 'nope', 'yes'])('%j is not an answer', (answer) => {
    expect(parsePluginAnswer(answer, [ponytail])).toBeUndefined();
  });
});

describe('choosePlugins — the question', () => {
  it("asks once for an installed host with catalog plugins; Enter skips", async () => {
    const io = scripted(['']);
    expect(await choosePlugins(base, io.ask, io.log)).toEqual({ plugins: [] });
    expect(io.calls).toEqual([pluginQuestion('claude-code', [ponytail])]);
    expect(io.calls[0]).toBe(
      '? Plugins for Claude Code — install now, into this workspace (project scope)?\n' +
        `  1) ponytail — ${ponytail.description} (MIT)\n` +
        'Choose, e.g. 1 — Enter to skip []: ',
    );
  });

  it('asks again after an answer that is not a listed plugin', async () => {
    const io = scripted(['3', '1']);
    expect(await choosePlugins(base, io.ask, io.log)).toEqual({ plugins: [ponytail] });
    expect(io.calls).toHaveLength(2);
  });

  it('never asks for a host without catalog plugins', async () => {
    const io = scripted([]);
    const result = await choosePlugins({ ...base, aiHosts: ['codex', 'gemini-cli'], installedHosts: { codex: '0.162.1' } }, io.ask, io.log);
    expect(result).toEqual({ plugins: [] });
    expect(io.calls).toEqual([]);
    expect(io.logs).toEqual([]);
  });

  it("a picked host whose CLI was not found: not asked, a one-line hint for later instead", async () => {
    const io = scripted([]);
    expect(await choosePlugins({ ...base, installedHosts: {} }, io.ask, io.log)).toEqual({ plugins: [] });
    expect(io.calls).toEqual([]);
    expect(io.logs).toEqual([
      'Claude Code was not found, so its plugins (ponytail) are not offered. Once it is installed, inside the workspace: ' +
        'pnpm nx g @clearlydev/nx-archweave:install-integration --tool=<plugin> --apply',
    ]);
  });

  it('hosts not probed: still offered', async () => {
    const io = scripted(['1']);
    expect(await choosePlugins({ ...base, installedHosts: undefined }, io.ask, io.log)).toEqual({ plugins: [ponytail] });
  });

  it('without a terminal and without the flag: none, nothing asked', async () => {
    const io = scripted([]);
    expect(await choosePlugins({ ...base, interactive: false }, io.ask, io.log)).toEqual({ plugins: [] });
    expect(io.calls).toEqual([]);
  });
});

describe('choosePlugins — --plugins', () => {
  it('wins over the question, even when the host CLI was not found (install-integration then says how)', async () => {
    const io = scripted([]);
    expect(await choosePlugins({ ...base, flag: ['ponytail'], installedHosts: {}, interactive: false }, io.ask, io.log)).toEqual({
      plugins: [ponytail],
    });
    expect(await choosePlugins({ ...base, flag: [] }, io.ask, io.log)).toEqual({ plugins: [] });
    expect(io.calls).toEqual([]);
  });

  it("refuses a plugin whose host was not picked", async () => {
    const io = scripted([]);
    expect(await choosePlugins({ ...base, flag: ['ponytail'], aiHosts: ['codex'] }, io.ask, io.log)).toEqual({
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
