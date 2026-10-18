import type { CommandRunner } from './command-runner.ts';

// The name documents a USAGE POLICY, not a different shape: callers typed
// against ReadOnlyCommandRunner only ever issue read-only commands
// (`claude plugin list --json`). The structural port itself is CommandRunner
// (command-runner.ts) — the real, Node-backed implementation lives in
// packages/nx-plugin.
export type ReadOnlyCommandRunner = CommandRunner;

// Fixed values for the one call this adapter makes — decided up front, not left
// to implementation-time judgment.
export const CLAUDE_CLI_TIMEOUT_MS = 5000;
export const CLAUDE_CLI_STDOUT_LIMIT_BYTES = 1_048_576; // 1 MiB
export const CLAUDE_CLI_STDERR_LIMIT_BYTES = 65_536; // 64 KiB

export function createFakeCommandRunner(response: {
  stdout: string;
  stderr?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  outputExceeded?: boolean;
}): ReadOnlyCommandRunner {
  return {
    async run() {
      return {
        stdout: response.stdout,
        stderr: response.stderr ?? '',
        exitCode: response.exitCode !== undefined ? response.exitCode : 0,
        timedOut: response.timedOut ?? false,
        outputExceeded: response.outputExceeded ?? false,
      };
    },
  };
}
