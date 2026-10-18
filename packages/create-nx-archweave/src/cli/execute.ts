import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CreatePlan, PlanStep, StepContext } from './plan.ts';
import { spawnableCommand } from './spawnable-command.ts';

/** With `stdio: 'inherit'` the child's output streams live to the user's terminal
 * and is never captured — so the exit status is deliberately all an ExecResult
 * carries. The failure report points at the output already printed above it. */
export interface ExecResult {
  status: number | null;
}

/** Injected for tests (mirrors `packages/nx-plugin/src/generators/init/validation.ts`'s
 * `ProcessExec` pattern) — the real implementation shells out via `spawnSync` with
 * inherited stdio so the user sees `create-nx-workspace`/`pnpm`/`nx g` output live;
 * tests supply a stub instead. */
export type PlanExec = (
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
) => ExecResult;

/** Variables a launcher sets only for the command it started. `npm exec --package=<x>`
 * exports `npm_config_package=<x>`, and a child `npx -y create-nx-workspace@…` would read
 * it and treat create-nx-workspace as a command inside <x> ("not found"). The positional
 * `npx create-nx-archweave` form sets nothing here (measured 2026-10-15). */
const LAUNCHER_ONLY = /^npm_config_package$/i;

/** The environment every step runs with: the inherited one minus launcher-only
 * variables, plus the plan's overrides. PATH, HOME, proxies and registry settings stay. */
export function childEnv(parent: NodeJS.ProcessEnv, overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) if (!LAUNCHER_ONLY.test(key)) env[key] = value;
  return { ...env, ...overrides };
}

function isFileOnDisk(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function createProcessExec(): PlanExec {
  return (command, args, options) => {
    // npx, npm, pnpm, yarn and bun are .cmd shims on Windows, which Node cannot start
    // without cmd.exe; there they run through it with every argument escaped.
    const env = childEnv(process.env, options.env);
    const spawnable = spawnableCommand(command, args, { platform: process.platform, env, isFile: isFileOnDisk });
    const result = spawnSync(spawnable.command, spawnable.args, {
      cwd: options.cwd,
      stdio: 'inherit',
      env,
      windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
    });
    return { status: result.status ?? null };
  };
}

export interface CompletedStep {
  step: PlanStep;
  result: ExecResult;
  /** The args the step actually ran with (after finalizeArgs); absent when skipped. */
  args?: string[];
  /** Set when finalizeArgs returned {skip} — the step was satisfied without running. */
  skipped?: string;
  /** An optional step that failed (the run went on): the exit status, or why it never ran. */
  optionalFailure?: string;
}

export type ExecuteReport =
  | { ok: true; completed: CompletedStep[] }
  | {
      ok: false;
      completed: CompletedStep[];
      failedStep: PlanStep;
      failedResult: ExecResult;
      /** Set when finalizeArgs refused — the step never executed. */
      finalizeError?: string;
    };

/** Real StepContext over the created workspace (tests inject their own). */
export function createStepContext(workspacePath: string): StepContext {
  return {
    workspacePath,
    readFile: (relativePath) => {
      try {
        return readFileSync(join(workspacePath, relativePath), 'utf-8');
      } catch {
        return undefined;
      }
    },
    listDir: (relativePath) => {
      try {
        // directories only — a stray apps/.DS_Store must never count as an app
        return readdirSync(join(workspacePath, relativePath), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
  };
}

/**
 * Runs the plan's steps in order. On the first non-zero exit, stops immediately —
 * later steps never run — and reports which step failed clearly, leaving the generated
 * directory in place with cleanup guidance instead of deleting it automatically. An
 * `optional` step is the exception: its failure is recorded and the run goes on. This function itself never deletes anything;
 * it only reports.
 */
export function executePlan(
  plan: CreatePlan,
  exec: PlanExec,
  invokedFromDir: string,
  ctxFactory: (workspacePath: string) => StepContext = createStepContext,
): ExecuteReport {
  const completed: CompletedStep[] = [];

  for (const step of plan.steps) {
    const cwd = step.cwd === null ? invokedFromDir : join(invokedFromDir, step.cwd);
    let args = step.args;
    if (step.finalizeArgs) {
      const finalized = step.finalizeArgs(ctxFactory(cwd));
      if ('error' in finalized) {
        if (step.optional) {
          completed.push({ step, result: { status: null }, optionalFailure: `stopped before execution: ${finalized.error}` });
          continue;
        }
        return { ok: false, completed, failedStep: step, failedResult: { status: null }, finalizeError: finalized.error };
      }
      if ('skip' in finalized) {
        // satisfied without running (e.g. the template already provides it)
        completed.push({ step, result: { status: 0 }, skipped: finalized.skip });
        continue;
      }
      args = finalized;
    }
    const result = exec(step.command, args, plan.env ? { cwd, env: plan.env } : { cwd });

    if (result.status !== 0) {
      if (step.optional) {
        const optionalFailure =
          result.status === null
            ? 'it did not start or was stopped (no exit code)'
            : `exit code: ${result.status} (its own error output is printed above)`;
        completed.push({ step, result, args, optionalFailure });
        continue;
      }
      return { ok: false, completed, failedStep: step, failedResult: result };
    }
    completed.push({ step, result, args });
  }

  return { ok: true, completed };
}

/** Renders the final message printed after `executePlan` returns — success prints the
 * plan's next-steps guidance; failure explains which step failed and how to recover,
 * explicitly noting the created directory is left in place (never auto-deleted). */
export function renderExecuteReport(report: ExecuteReport, plan: CreatePlan, workspaceName: string): string {
  if (report.ok) {
    const skippedLines = report.completed
      .filter((c) => c.skipped !== undefined)
      .map((c) => `  skipped "${c.step.id}": ${c.skipped}`);
    const noteLines = report.completed.flatMap((c) =>
      c.skipped === undefined && c.optionalFailure === undefined && c.args !== undefined && c.step.successNote
        ? [`  note: ${c.step.successNote(c.args)}`]
        : [],
    );
    const failedOptional = report.completed.filter((c) => c.optionalFailure !== undefined);
    const optionalLines = failedOptional.flatMap((c) => [
      `  optional step "${c.step.id}" failed — ${c.step.description}.`,
      `    ${c.optionalFailure}`,
      ...(c.step.failureHint ? [`    ${c.step.failureHint}`] : []),
    ]);
    return [
      '',
      failedOptional.length === 0
        ? 'create-nx-archweave finished successfully.'
        : `create-nx-archweave finished — the workspace is complete, but ${failedOptional.length} optional step(s) failed:`,
      ...optionalLines,
      ...skippedLines,
      ...noteLines,
      '',
      'Next steps:',
      ...plan.nextSteps.map((line) => `  ${line}`),
    ].join('\n');
  }

  const { failedStep, failedResult } = report;
  const detail = report.finalizeError
    ? `stopped before execution: ${report.finalizeError}`
    : `exit code: ${failedResult.status ?? 'unknown'} (the command's own error output is printed above)`;

  return [
    '',
    `create-nx-archweave stopped: step "${failedStep.id}" failed — ${failedStep.description}.`,
    `  ${detail}`,
    ...(!report.finalizeError && failedStep.failureHint ? [`  ${failedStep.failureHint}`] : []),
    '',
    `The "${workspaceName}" directory (if it was created) was left in place — create-nx-archweave never deletes it automatically.`,
    `Inspect the error above, fix the issue, then either re-run the failed command yourself inside "${workspaceName}" or remove the directory and start over.`,
  ].join('\n');
}
