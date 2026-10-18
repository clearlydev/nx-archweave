import { verifyViaClaudeCli, getCatalogEntry } from '@nx-archweave/integrations';
import { NodeCommandRunner } from './node-command-runner.ts';

// Opt-in only — disabled by default, gated by an environment variable, and
// never part of the normal automated suite (`ARCHWEAVE_LIVE_CLAUDE_SMOKE_TEST=1`
// enables it). Calls the real, locally installed `claude` binary exactly
// once, read-only (`plugin list --json`). It does not require Ponytail to be
// installed and never mutates any plugin state — it only validates that the
// parser accepts this machine's actual current output shape. Never logs the
// raw plugin list output, only the resulting classification shape.
const shouldRun = process.env['ARCHWEAVE_LIVE_CLAUDE_SMOKE_TEST'] === '1';
const describeIfEnabled = shouldRun ? describe : describe.skip;

describeIfEnabled('verifyViaClaudeCli — opt-in smoke test against the real, locally installed claude CLI', () => {
  it('produces a well-formed classification against whatever this machine currently reports', async () => {
    const runner = new NodeCommandRunner();
    const result = await verifyViaClaudeCli(runner, getCatalogEntry('ponytail')!.hosts['claude-code']!.pluginId);

    if (result.source === 'claude-cli') {
      expect(['verified', 'installed-but-disabled', 'absent', 'ambiguous']).toContain(result.outcome.status);
    } else {
      expect([
        'not-found',
        'timeout',
        'non-zero-exit',
        'invalid-json',
        'unexpected-schema',
        'output-too-large',
      ]).toContain(result.reason);
    }
  });
});
