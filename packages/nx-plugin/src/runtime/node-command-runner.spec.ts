import { NodeCommandRunner } from './node-command-runner.ts';

// Exercised against `node` itself (always available in this test environment)
// with small inline scripts — never against the real `claude` binary, so this
// suite is deterministic regardless of whether Claude Code happens to be
// installed on the machine running the tests.
describe('NodeCommandRunner', () => {
  const runner = new NodeCommandRunner();

  it('returns stdout and exitCode 0 for a successful command', async () => {
    const result = await runner.run({
      executable: process.execPath,
      argv: ['-e', 'console.log("hello")'],
      timeoutMs: 5000,
      stdoutLimitBytes: 1_048_576,
      stderrLimitBytes: 65_536,
    });
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.outputExceeded).toBe(false);
  });

  it('reports a non-zero exit code without treating it as an error', async () => {
    const result = await runner.run({
      executable: process.execPath,
      argv: ['-e', 'process.exit(1)'],
      timeoutMs: 5000,
      stdoutLimitBytes: 1_048_576,
      stderrLimitBytes: 65_536,
    });
    expect(result.exitCode).toBe(1);
  });

  it('rejects when the executable does not exist (distinct from a non-zero exit)', async () => {
    await expect(
      runner.run({
        executable: '/this/executable/does/not/exist/anywhere',
        argv: [],
        timeoutMs: 5000,
        stdoutLimitBytes: 1_048_576,
        stderrLimitBytes: 65_536,
      }),
    ).rejects.toThrow();
  });

  it('terminates the child process and reports timedOut when it runs too long', async () => {
    const result = await runner.run({
      executable: process.execPath,
      argv: ['-e', 'setTimeout(() => {}, 5000)'],
      timeoutMs: 100,
      stdoutLimitBytes: 1_048_576,
      stderrLimitBytes: 65_536,
    });
    expect(result.timedOut).toBe(true);
  });

  it('terminates the child process and reports outputExceeded when stdout exceeds the limit', async () => {
    const result = await runner.run({
      executable: process.execPath,
      argv: ['-e', 'process.stdout.write("x".repeat(1000))'],
      timeoutMs: 5000,
      stdoutLimitBytes: 100,
      stderrLimitBytes: 65_536,
    });
    expect(result.outputExceeded).toBe(true);
  });

  it('terminates the child process and reports outputExceeded when stderr exceeds the limit', async () => {
    const result = await runner.run({
      executable: process.execPath,
      argv: ['-e', 'process.stderr.write("x".repeat(1000))'],
      timeoutMs: 5000,
      stdoutLimitBytes: 1_048_576,
      stderrLimitBytes: 100,
    });
    expect(result.outputExceeded).toBe(true);
  });

  it('still settles via SIGKILL when the child ignores SIGTERM after a timeout', async () => {
    const start = Date.now();
    const result = await runner.run({
      executable: process.execPath,
      argv: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      timeoutMs: 100,
      stdoutLimitBytes: 1_048_576,
      stderrLimitBytes: 65_536,
    });
    expect(result.timedOut).toBe(true);
    // Bounded well under the test's own timeout: 100ms timeout + 500ms SIGKILL
    // grace period, with generous slack for CI scheduling jitter.
    expect(Date.now() - start).toBeLessThan(3000);
  }, 10000);

  it('never uses a shell to invoke the command', async () => {
    // A shell-metacharacter-laden argument must be passed through literally,
    // never interpreted — proof there is no shell involved (a real shell
    // would expand $(echo pwned) to "pwned" instead of passing it verbatim).
    const result = await runner.run({
      executable: process.execPath,
      argv: ['-e', 'console.log(JSON.stringify(process.argv))', '$(echo pwned)'],
      timeoutMs: 5000,
      stdoutLimitBytes: 1_048_576,
      stderrLimitBytes: 65_536,
    });
    expect(result.stdout).toContain('$(echo pwned)');
  });
});
