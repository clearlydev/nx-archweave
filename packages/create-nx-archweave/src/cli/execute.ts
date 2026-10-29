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
  /** How long the step's command ran; absent when it never ran. */
  durationMs?: number;
}

export type ExecuteReport =
  | { ok: true; completed: CompletedStep[] }
  | {
      ok: false;
      completed: CompletedStep[];
      failedStep: PlanStep;
      failedResult: ExecResult;
      /** The args the failed step ran with (after finalizeArgs); absent when it never executed. */
      failedArgs?: string[];
      /** Set when finalizeArgs refused — the step never executed. */
      finalizeError?: string;
      /** How long the failed step's command ran; absent when it never ran. */
      failedDurationMs?: number;
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
  now: () => number = Date.now,
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
        // satisfied without running (e.g. express already declared)
        completed.push({ step, result: { status: 0 }, skipped: finalized.skip });
        continue;
      }
      args = finalized;
    }
    const startedAt = now();
    const result = exec(step.command, args, plan.env ? { cwd, env: plan.env } : { cwd });
    const durationMs = now() - startedAt;

    if (result.status !== 0) {
      if (step.optional) {
        const optionalFailure =
          result.status === null
            ? 'it did not start or was stopped (no exit code)'
            : `exit code: ${result.status} (its own error output is printed above)`;
        completed.push({ step, result, args, optionalFailure, durationMs });
        continue;
      }
      return { ok: false, completed, failedStep: step, failedResult: result, failedArgs: args, failedDurationMs: durationMs };
    }
    completed.push({ step, result, args, durationMs });
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
    `Inspect the error above and fix the issue. Then either run the remaining steps below yourself, or remove the directory and start over.`,
    '',
    ...renderRemainingSteps(report, plan, workspaceName),
  ].join('\n');
}

/** How long each step that ran took, slowest work first in plan order: printed when
 * CREATE_NX_ARCHWEAVE_TIMINGS=1 (the e2e scripts set it to see where a slow run spends its
 * time). */
export function renderStepTimings(report: ExecuteReport): string {
  const rows: [string, number][] = report.completed.filter((c) => c.durationMs !== undefined).map((c) => [c.step.id, c.durationMs as number]);
  if (!report.ok && report.failedDurationMs !== undefined) rows.push([`${report.failedStep.id} (failed)`, report.failedDurationMs]);
  return ['Step timings:', ...rows.map(([id, ms]) => `  ${(ms / 1000).toFixed(1).padStart(7)}s  ${id}`)].join('\n');
}

/** The failed step and every step after it, as commands to run by hand. Printed only —
 * create-nx-archweave never runs them again. A step whose arguments are decided at run
 * time (finalizeArgs) shows its planned arguments with a note, except the failed step
 * itself when it got as far as running: that one shows exactly what ran. */
function renderRemainingSteps(report: Extract<ExecuteReport, { ok: false }>, plan: CreatePlan, workspaceName: string): string[] {
  const start = plan.steps.indexOf(report.failedStep);
  const remaining = start === -1 ? [report.failedStep] : plan.steps.slice(start);
  const lines = [`Remaining steps, in order (printed only — create-nx-archweave does not run them again):`];
  const env = Object.entries(plan.env ?? {});
  if (env.length > 0) lines.push(`  Run them with ${env.map(([key, value]) => `${key}=${value}`).join(' ')} set, as the CLI does.`);
  remaining.forEach((step, index) => {
    const ranArgs = step === report.failedStep ? report.failedArgs : undefined;
    const args = ranArgs ?? step.args;
    const where = step.cwd === null ? 'in the directory you ran create-nx-archweave from' : `inside "${workspaceName}"`;
    lines.push(`  ${index + 1}. ${step.description}${step.optional ? ' (optional)' : ''} — ${where}:`);
    lines.push(`       ${[step.command, ...args].map(shellQuote).join(' ')}`);
    if (step.finalizeArgs && ranArgs === undefined) {
      lines.push('       (the CLI works out this step\'s exact arguments when it runs — check them against the workspace first)');
    }
  });
  return lines;
}

/** POSIX-style quoting for display: plain words stay bare, anything else is single-quoted. */
function shellQuote(word: string): string {
  return /^[\w@%+=:,./^~-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}
