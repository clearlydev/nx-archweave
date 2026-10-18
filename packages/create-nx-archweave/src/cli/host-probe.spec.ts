import { detectInstalledHosts, parseProbeVersion, type VersionProbe } from './host-probe.ts';

describe('parseProbeVersion', () => {
  it.each([
    ['2.1.300 (Claude Code)\n', '2.1.300'], // measured 2026-10-15
    ['codex-cli 0.162.1\n', '0.162.1'], // measured
    ['0.64.0\n', '0.64.0'], // gemini, measured
    ['2026.05.24-dda726e\n', '2026.05.24-dda726e'], // cursor-agent, per its install guides
    ['Cursor Agent\n', 'Cursor Agent'],
    ['', ''],
  ])('%j → %j', (output, version) => {
    expect(parseProbeVersion(output)).toBe(version);
  });

  it('shortens a long line without a version', () => {
    expect(parseProbeVersion('x'.repeat(80))).toHaveLength(40);
  });
});

describe('detectInstalledHosts', () => {
  it("probes each host's command at once; a failed or throwing probe means not found", async () => {
    const asked: string[] = [];
    let running = 0;
    let peak = 0;
    const probe: VersionProbe = async (command) => {
      asked.push(command);
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      if (command === 'claude') return '2.1.300 (Claude Code)\n';
      if (command === 'gemini') throw new Error('spawn gemini ENOENT');
      return undefined;
    };
    expect(await detectInstalledHosts(probe)).toEqual({ 'claude-code': '2.1.300' });
    expect(asked).toEqual(['claude', 'codex', 'cursor-agent', 'gemini']);
    expect(peak).toBe(4);
  });
});
