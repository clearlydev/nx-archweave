import { verifyViaClaudeCli } from './verify-via-claude-cli.ts';
import { createFakeCommandRunner } from '../../process/read-only-command-runner.ts';
import type { ReadOnlyCommandRunner } from '../../process/read-only-command-runner.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(__dirname, '../../../../../tools/fixtures/integrations/claude-plugin-list');
const read = (name: string) => readFileSync(join(FIXTURES, `${name}.json`), 'utf8');

const PLUGIN_ID = 'ponytail@ponytail';

describe('verifyViaClaudeCli', () => {
  it('reports a verified outcome for an enabled match', async () => {
    const runner = createFakeCommandRunner({ stdout: read('enabled-match') });
    const result = await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli', outcome: { status: 'verified', version: '4.8.4', scope: 'user' } });
  });

  it('reports installed-but-disabled distinctly from absent', async () => {
    const runner = createFakeCommandRunner({ stdout: read('disabled-match') });
    const result = await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli', outcome: { status: 'installed-but-disabled', scope: 'user' } });
  });

  it('reports absent when the plugin is not in the list', async () => {
    const runner = createFakeCommandRunner({ stdout: read('no-match') });
    const result = await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli', outcome: { status: 'absent' } });
  });

  it('reports ambiguous for duplicate matches', async () => {
    const runner = createFakeCommandRunner({ stdout: read('duplicate-match') });
    const result = await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli', outcome: { status: 'ambiguous' } });
  });

  it('a list holding account-synced plugins (Claude Code 2.1.300, measured) still answers for ours', async () => {
    const runner = createFakeCommandRunner({ stdout: read('synced-scope') });
    expect(await verifyViaClaudeCli(runner, PLUGIN_ID)).toEqual({ source: 'claude-cli', outcome: { status: 'absent' } });
  });

  it('our own plugin at a scope we do not know stays a distinct schema error', async () => {
    const runner = createFakeCommandRunner({ stdout: JSON.stringify([{ id: PLUGIN_ID, enabled: true, scope: 'synced' }]) });
    expect(await verifyViaClaudeCli(runner, PLUGIN_ID)).toEqual({ source: 'claude-cli-unavailable', reason: 'unexpected-schema' });
  });

  it('our plugin at a known scope and again at an unknown one is ambiguous, never matched', async () => {
    const runner = createFakeCommandRunner({
      stdout: JSON.stringify([
        { id: PLUGIN_ID, enabled: true, scope: 'project', version: '5.2.0' },
        { id: PLUGIN_ID, enabled: true, scope: 'synced' },
      ]),
    });
    expect(await verifyViaClaudeCli(runner, PLUGIN_ID)).toEqual({ source: 'claude-cli', outcome: { status: 'ambiguous' } });
  });

  it("another project's project-scope install is not this workspace's (measured): absent here", async () => {
    const runner = createFakeCommandRunner({
      stdout: JSON.stringify([{ id: PLUGIN_ID, enabled: false, scope: 'project', projectPath: '/elsewhere/demo', projectEnabled: false }]),
    });
    expect(await verifyViaClaudeCli(runner, PLUGIN_ID, '/work/this')).toEqual({ source: 'claude-cli', outcome: { status: 'absent' } });
  });

  it('classifies a rejected run() as CLI not found — the only case that ever suggests a fallback', async () => {
    const rejectingRunner: ReadOnlyCommandRunner = {
      run: () => Promise.reject(new Error('spawn claude ENOENT')),
    };
    const result = await verifyViaClaudeCli(rejectingRunner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli-unavailable', reason: 'not-found' });
  });

  it('classifies a timeout as a verification error, never falling back', async () => {
    const runner = createFakeCommandRunner({ stdout: '', timedOut: true, exitCode: null });
    const result = await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli-unavailable', reason: 'timeout' });
  });

  it('classifies a non-zero exit as a verification error, never falling back', async () => {
    const runner = createFakeCommandRunner({ stdout: '', exitCode: 1 });
    const result = await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli-unavailable', reason: 'non-zero-exit' });
  });

  it('classifies malformed JSON as a verification error, never falling back', async () => {
    const runner = createFakeCommandRunner({ stdout: read('malformed') });
    const result = await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli-unavailable', reason: 'invalid-json' });
  });

  it('classifies a non-array top-level value as unexpected schema', async () => {
    const runner = createFakeCommandRunner({ stdout: read('non-array') });
    const result = await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli-unavailable', reason: 'unexpected-schema' });
  });

  it('classifies missing required fields as unexpected schema', async () => {
    const runner = createFakeCommandRunner({ stdout: read('missing-fields') });
    const result = await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli-unavailable', reason: 'unexpected-schema' });
  });

  it('classifies oversized output as a verification error and never parses the partial stdout', async () => {
    const runner = createFakeCommandRunner({ stdout: '[{"id":"ponytail@ponytail"', outputExceeded: true, exitCode: null });
    const result = await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(result).toEqual({ source: 'claude-cli-unavailable', reason: 'output-too-large' });
  });

  it('runs the list in the given workspace so project/local-scope plugins are seen', async () => {
    const cwds: (string | undefined)[] = [];
    const runner = {
      async run(input: { cwd?: string }) {
        cwds.push(input.cwd);
        return { stdout: '[]', stderr: '', exitCode: 0, timedOut: false, outputExceeded: false };
      },
    };
    await verifyViaClaudeCli(runner as never, 'ponytail@ponytail', '/ws');
    expect(cwds).toEqual(['/ws']);
  });

  it('passes the fixed executable and argv to the runner, nothing user-provided', async () => {
    let capturedInput: unknown;
    const runner: ReadOnlyCommandRunner = {
      run: async (input) => {
        capturedInput = input;
        return { stdout: '[]', stderr: '', exitCode: 0, timedOut: false, outputExceeded: false };
      },
    };
    await verifyViaClaudeCli(runner, PLUGIN_ID);
    expect(capturedInput).toMatchObject({
      executable: 'claude',
      argv: ['plugin', 'list', '--json'],
    });
  });
});
