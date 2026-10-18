import { spawnSync } from 'node:child_process';
import { spawnableCommand } from '@nx-archweave/shared';

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Injected for tests — the real implementation
 * (`createProcessExec`) shells out via `spawnSync`; tests supply a stub covering the
 * actionlint absent/present-passing/present-failing three-way split. */
export type ProcessExec = (command: string, args: string[], options?: { cwd?: string }) => ExecResult;

export function createProcessExec(): ProcessExec {
  return (command, args, options) => {
    // nx / actionlint may be .cmd shims on Windows, which Node cannot start without cmd.exe.
    const spawnable = spawnableCommand(command, args);
    const result = spawnSync(spawnable.command, spawnable.args, {
      cwd: options?.cwd,
      encoding: 'utf-8',
      windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
    });
    return { status: result.status ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
}

export interface PostInitValidationInput {
  root: string;
  /** Paths (relative to `root`) of `.github/workflows/*.yml` files this run actually
   * wrote — not every workflow file that happens to exist. */
  workflowPaths: string[];
  /** Where `nx graph --file=...` should write its JSON output. */
  graphOutputFile: string;
}

/** Runs `exec`, catching anything it throws (e.g. a stub or an unforeseen environment
 * failure) so a single check can never take down the rest of validation — the "never
 * throws" half of the best-effort contract applies even to the injected dependency, not
 * just to non-zero exit codes. */
function safeExec(exec: ProcessExec, command: string, args: string[], options?: { cwd?: string }): ExecResult {
  try {
    return exec(command, args, options);
  } catch (error) {
    return { status: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  }
}

/** Post-flush, best-effort validation: never throws, only
 * reports via console. Runs after the generator's `GeneratorCallback` fires, once every
 * file this run wrote is actually on disk. Neither actionlint nor nx are added as
 * dependencies — both are invoked as external binaries, detected at call time. */
export function runPostInitValidation(input: PostInitValidationInput, exec: ProcessExec): void {
  console.log('');
  console.log('Post-run validation (best-effort):');

  if (input.workflowPaths.length === 0) {
    console.log('  actionlint: skipped (no GitHub Actions workflow files were written this run)');
  } else {
    const versionCheck = safeExec(exec, 'actionlint', ['--version'], { cwd: input.root });
    if (versionCheck.status !== 0) {
      console.log('  actionlint: not found on PATH — skipped.');
      console.log('    Install it from https://github.com/rhysd/actionlint to validate workflow files locally.');
    } else {
      const lintResult = safeExec(exec, 'actionlint', input.workflowPaths, { cwd: input.root });
      if (lintResult.status === 0) {
        console.log(`  actionlint: passed (${input.workflowPaths.join(', ')})`);
      } else {
        console.log('  actionlint: reported issues —');
        for (const line of (lintResult.stdout || lintResult.stderr).split('\n')) {
          if (line.length > 0) console.log(`    ${line}`);
        }
      }
    }
  }

  const nxVersionCheck = safeExec(exec, 'nx', ['--version'], { cwd: input.root });
  if (nxVersionCheck.status !== 0) {
    console.log('  nx graph: nx not found on PATH — skipped.');
    console.log('    Run it via your package manager instead, e.g. `pnpm nx graph`, `yarn nx graph`, `bun nx graph` or `npm exec nx graph`.');
    return;
  }
  const graphResult = safeExec(exec, 'nx', ['graph', `--file=${input.graphOutputFile}`], { cwd: input.root });
  if (graphResult.status === 0) {
    console.log(`  nx graph: valid (written to ${input.graphOutputFile})`);
  } else {
    console.log('  nx graph: failed —');
    for (const line of (graphResult.stdout || graphResult.stderr).split('\n')) {
      if (line.length > 0) console.log(`    ${line}`);
    }
  }
}
