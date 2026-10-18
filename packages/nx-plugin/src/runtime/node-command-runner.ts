import { spawn } from 'node:child_process';
import { spawnableCommand } from '@nx-archweave/shared';
import type { CommandRunner } from '@nx-archweave/integrations';

// SIGTERM is not guaranteed to actually end a process — a child that traps
// or ignores it would otherwise keep this runner's promise pending forever,
// silently defeating the fixed timeout/output-limit guarantees. SIGKILL
// cannot be caught or ignored, so it is the backstop once a process has had
// a short grace period to exit cleanly on its own.
const KILL_GRACE_MS = 500;

// The one place node:child_process is imported — packages/integrations never
// imports it directly. Uses spawn (never a shell) so stdout/stderr can be bounded
// independently at the exact approved limits, and so the child process can be
// terminated on timeout or overflow without waiting for it to finish producing output.
export class NodeCommandRunner implements CommandRunner {
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
  }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let outputExceeded = false;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;

      // An npm-installed claude is a .cmd shim on Windows: it runs through cmd.exe with every
      // argument escaped — still never a shell string built from raw input.
      const spawnable = spawnableCommand(input.executable, input.argv);
      const child = spawn(spawnable.command, spawnable.args, {
        cwd: input.cwd,
        shell: false,
        windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
        windowsHide: true,
        // No stdin: nothing here ever answers a prompt (a command that wants
        // confirmation must fail fast instead of waiting on an open pipe).
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // SIGTERM first (lets a well-behaved process clean up); SIGKILL after a
      // short grace period as a backstop against one that ignores it.
      const terminate = () => {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, KILL_GRACE_MS);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, input.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (Buffer.byteLength(stdout, 'utf8') > input.stdoutLimitBytes) {
          outputExceeded = true;
          terminate();
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (Buffer.byteLength(stderr, 'utf8') > input.stderrLimitBytes) {
          outputExceeded = true;
          terminate();
        }
      });

      // Spawn-level failure (e.g. ENOENT — executable not found) is distinct
      // from a completed process with a non-zero exit code. Only this case
      // rejects the promise.
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        resolve({ stdout, stderr, exitCode: code, timedOut, outputExceeded });
      });
    });
  }
}
