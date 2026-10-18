// The structural port every subprocess in this package goes through — a pure
// interface, no node:child_process import here or anywhere in @nx-archweave/
// integrations (the Node-backed implementation lives in packages/nx-plugin).
// Only structured fields cross it: executable + argv, never a shell string.
//
// Two call sites exist, with different POLICIES but the same shape:
// - read-only calls (`claude plugin list --json`, see read-only-command-runner.ts);
// - the one mutating call this package makes, a catalog plugin's official
//   `claude plugin install …` (hosts/claude-code/install.ts) —
//   executed only behind an explicit user approval (ApprovedInstallPlan).
export interface CommandRunner {
  run(input: {
    executable: string;
    argv: string[];
    cwd?: string;
    timeoutMs: number;
    stdoutLimitBytes: number;
    stderrLimitBytes: number;
  }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    outputExceeded: boolean;
  }>;
}
