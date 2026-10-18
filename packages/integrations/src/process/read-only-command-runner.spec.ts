import { createFakeCommandRunner } from './read-only-command-runner.ts';

describe('createFakeCommandRunner', () => {
  it('returns exactly the response it was constructed with', async () => {
    const runner = createFakeCommandRunner({ stdout: 'hello', exitCode: 0 });
    const result = await runner.run({
      executable: 'claude',
      argv: ['plugin', 'list', '--json'],
      timeoutMs: 5000,
      stdoutLimitBytes: 1_048_576,
      stderrLimitBytes: 65_536,
    });
    expect(result).toEqual({
      stdout: 'hello',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      outputExceeded: false,
    });
  });

  it('applies defaults for stderr/timedOut/outputExceeded when not specified', async () => {
    const runner = createFakeCommandRunner({ stdout: '[]' });
    const result = await runner.run({
      executable: 'claude',
      argv: ['plugin', 'list', '--json'],
      timeoutMs: 5000,
      stdoutLimitBytes: 1_048_576,
      stderrLimitBytes: 65_536,
    });
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.outputExceeded).toBe(false);
  });

  it('can simulate a timeout', async () => {
    const runner = createFakeCommandRunner({ stdout: '', timedOut: true, exitCode: null });
    const result = await runner.run({
      executable: 'claude',
      argv: ['plugin', 'list', '--json'],
      timeoutMs: 5000,
      stdoutLimitBytes: 1_048_576,
      stderrLimitBytes: 65_536,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('can simulate exceeded output', async () => {
    const runner = createFakeCommandRunner({ stdout: '', outputExceeded: true, exitCode: null });
    const result = await runner.run({
      executable: 'claude',
      argv: ['plugin', 'list', '--json'],
      timeoutMs: 5000,
      stdoutLimitBytes: 1_048_576,
      stderrLimitBytes: 65_536,
    });
    expect(result.outputExceeded).toBe(true);
  });
});
