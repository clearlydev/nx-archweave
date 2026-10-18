import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv, createStepContext, executePlan, renderExecuteReport, type ExecResult, type PlanExec } from './execute.ts';
import { buildPlan, type CreatePlan } from './plan.ts';

const plan = buildPlan({ name: 'my-app', preset: 'quick-start', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });

function ok(): ExecResult {
  return { status: 0 };
}

function fail(): ExecResult {
  return { status: 1 };
}

describe('executePlan', () => {
  it('runs every step in order with the resolved cwd, and reports ok on full success', () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const exec: PlanExec = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return ok();
    };

    const report = executePlan(plan, exec, '/work');

    expect(calls).toEqual([
      { command: 'pnpm', args: plan.steps[0].args, cwd: '/work' },
      { command: 'pnpm', args: plan.steps[1].args, cwd: join('/work', 'my-app') },
      { command: 'pnpm', args: plan.steps[2].args, cwd: join('/work', 'my-app') },
    ]);
    expect(report.ok).toBe(true);
    if (report.ok) {
      // the pnpm plan's final settle step finds no pnpm-workspace.yaml here and is skipped
      expect(report.completed).toHaveLength(4);
      expect(report.completed[3].step.id).toBe('settle-build-approvals');
      expect(report.completed[3].skipped).toBeDefined();
    }
  });

  it('stops at the first failing step and never runs the remaining steps', () => {
    let callCount = 0;
    const exec: PlanExec = () => {
      callCount += 1;
      return callCount === 2 ? fail() : ok();
    };

    const report = executePlan(plan, exec, '/work');

    expect(callCount).toBe(2);
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.failedStep.id).toBe('install-plugin');
      expect(report.failedResult.status).toBe(1);
      expect(report.completed).toHaveLength(1);
      expect(report.completed[0].step.id).toBe('create-workspace');
    }
  });

  it('reports the create-workspace step failing on the very first call', () => {
    const exec: PlanExec = () => fail();
    const report = executePlan(plan, exec, '/work');

    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.failedStep.id).toBe('create-workspace');
      expect(report.completed).toHaveLength(0);
    }
  });

  it('reports the run-init step failing after the first two succeed', () => {
    let callCount = 0;
    const exec: PlanExec = () => {
      callCount += 1;
      return callCount === 3 ? fail() : ok();
    };

    const report = executePlan(plan, exec, '/work');

    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.failedStep.id).toBe('run-init');
      expect(report.completed).toHaveLength(2);
    }
  });
});

describe('renderExecuteReport', () => {
  it('prints the next-steps guidance on success', () => {
    const report = executePlan(plan, () => ok(), '/work');
    const text = renderExecuteReport(report, plan, 'my-app');

    expect(text).toContain('create-nx-archweave finished successfully.');
    expect(text).toContain('Next steps:');
    for (const line of plan.nextSteps) {
      expect(text).toContain(line);
    }
  });

  it('explains which step failed and leaves cleanup to the user, without ever deleting anything', () => {
    let callCount = 0;
    const exec: PlanExec = () => {
      callCount += 1;
      return callCount === 2 ? { status: 7 } : ok();
    };
    const report = executePlan(plan, exec, '/work');
    const text = renderExecuteReport(report, plan, 'my-app');

    expect(text).toContain('step "install-plugin" failed');
    expect(text).toContain('exit code: 7');
    expect(text).toContain("error output is printed above");
    expect(text).toContain('was left in place');
    expect(text).toContain('never deletes it automatically');
  });

  it('reports an unknown exit code when spawnSync yields no status', () => {
    const exec: PlanExec = () => ({ status: null });
    const report = executePlan(plan, exec, '/work');
    const text = renderExecuteReport(report, plan, 'my-app');

    expect(text).toContain('exit code: unknown');
  });

  it("prints the failed step's failureHint right under the exit code", () => {
    const npmPlan = buildPlan({ name: 'my-app', preset: 'quick-start', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager: 'npm' });
    const report = executePlan(npmPlan, () => fail(), '/work');
    const lines = renderExecuteReport(report, npmPlan, 'my-app').split('\n');

    const exitLine = lines.findIndex((line) => line.includes('exit code: 1'));
    expect(exitLine).toBeGreaterThan(-1);
    expect(lines[exitLine + 1]).toBe(`  ${npmPlan.steps[0].failureHint}`);
  });

  it('prints no hint for a step without one, nor for a finalizeArgs refusal', () => {
    const hinted = {
      steps: [{ id: 'install-plugin' as const, description: 'x', command: 'pnpm', args: [], cwd: 'my-app', failureHint: 'HINT', finalizeArgs: () => ({ error: 'refused' }) }],
      nextSteps: [],
    };
    const refused = renderExecuteReport(executePlan(hinted, () => ok(), '/work'), hinted, 'my-app');
    expect(refused).toContain('refused');
    expect(refused).not.toContain('HINT');

    const failed = renderExecuteReport(executePlan(plan, () => fail(), '/work'), plan, 'my-app');
    expect(failed.split('\n').filter((line) => line.startsWith('  '))).toHaveLength(1); // the exit-code line only
  });
});

describe('executePlan — finalizeArgs', () => {
  const ctx = { workspacePath: '/work/my-app', readFile: () => undefined, listDir: () => [] };

  it('executes with the finalized args', () => {
    const plan = buildPlan({ name: 'my-app', preset: 'quick-start', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    plan.steps[1] = { ...plan.steps[1], finalizeArgs: () => ['add', '-D', '-w', 'pinned@1.2.3'] };
    const calls: string[][] = [];
    const exec: PlanExec = (_c, args) => {
      calls.push(args);
      return { status: 0 };
    };
    const report = executePlan(plan, exec, '/work', () => ctx);
    expect(report.ok).toBe(true);
    expect(calls[1]).toEqual(['add', '-D', '-w', 'pinned@1.2.3']);
  });

  it('stops before executing a step whose finalizeArgs returns an error', () => {
    const plan = buildPlan({ name: 'my-app', preset: 'quick-start', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    plan.steps[1] = { ...plan.steps[1], finalizeArgs: () => ({ error: 'nx version not found' }) };
    let calls = 0;
    const exec: PlanExec = () => {
      calls += 1;
      return { status: 0 };
    };
    const report = executePlan(plan, exec, '/work', () => ctx);
    expect(calls).toBe(1); // only step 1 ran
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.failedStep.id).toBe('install-plugin');
      const text = renderExecuteReport(report, plan, 'my-app');
      expect(text).toContain('nx version not found');
    }
  });
});

describe('executePlan — finalize skip', () => {
  const ctx = { workspacePath: '/w', readFile: () => undefined, listDir: () => [] };
  it('records a skipped step without executing it and continues', () => {
    const plan = buildPlan({ name: 'my-app', preset: 'quick-start', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    plan.steps[1] = { ...plan.steps[1], finalizeArgs: () => ({ skip: 'already provided by the template' }) };
    const calls: string[][] = [];
    const exec: PlanExec = (_c, args) => {
      calls.push(args);
      return { status: 0 };
    };
    const report = executePlan(plan, exec, '/work', () => ctx);
    expect(report.ok).toBe(true);
    expect(calls).toHaveLength(2); // steps 1 and 3 only
    expect(report.completed[1].skipped).toBe('already provided by the template');
  });

  it('surfaces the skip reason in the success report', () => {
    const plan = buildPlan({ name: 'my-app', preset: 'quick-start', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    plan.steps[1] = { ...plan.steps[1], finalizeArgs: () => ({ skip: 'already provided by the template' }) };
    const exec: PlanExec = () => ({ status: 0 });
    const report = executePlan(plan, exec, '/work', () => ctx);
    const text = renderExecuteReport(report, plan, 'my-app');
    expect(text).toContain('skipped "install-plugin": already provided by the template');
  });
});

describe('createStepContext — listDir', () => {
  it('returns only directories, never stray files', () => {
    const base = mkdtempSync(join(tmpdir(), 'ctx-listdir-'));
    mkdirSync(join(base, 'apps', 'web'), { recursive: true });
    writeFileSync(join(base, 'apps', '.DS_Store'), '');
    writeFileSync(join(base, 'apps', 'README.md'), '');
    try {
      expect(createStepContext(base).listDir('apps')).toEqual(['web']);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('executePlan — plan env, executed args, success notes (2026-10-14)', () => {
  const ctx = { workspacePath: '/work/my-app', readFile: () => undefined, listDir: () => [] };

  it('forwards plan.env to every exec call, and passes no env key when the plan has none', () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const exec: PlanExec = (_c, _a, options) => {
      seen.push(options.env);
      return ok();
    };
    const pnpmPlan = buildPlan({ name: 'my-app', preset: 'quick-start', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    executePlan({ ...pnpmPlan, steps: pnpmPlan.steps.slice(0, 3) }, exec, '/work');
    expect(seen).toEqual([pnpmPlan.env, pnpmPlan.env, pnpmPlan.env]);

    const optionKeys: string[][] = [];
    const npmPlan = buildPlan({ name: 'my-app', preset: 'quick-start', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager: 'npm' });
    executePlan(npmPlan, (_c, _a, options) => {
      optionKeys.push(Object.keys(options));
      return ok();
    }, '/work');
    expect(optionKeys.every((keys) => keys.join() === 'cwd')).toBe(true);
  });

  it('records the args a step ran with and renders its success note; a skipped step gets no note', () => {
    const noted = {
      steps: [
        { id: 'install-plugin' as const, description: 'a', command: 'x', args: ['base'], cwd: 'my-app', finalizeArgs: () => ['ran', '!pkg'], successNote: (args: string[]) => `NOTE ${args.join(' ')}` },
        { id: 'run-init' as const, description: 'b', command: 'x', args: [], cwd: 'my-app', finalizeArgs: () => ({ skip: 'nothing to do' }), successNote: () => 'NEVER' },
      ],
      nextSteps: ['cd my-app'],
    };
    const report = executePlan(noted, () => ok(), '/work', () => ctx);
    expect(report.completed[0].args).toEqual(['ran', '!pkg']);
    expect(report.completed[1].args).toBeUndefined();
    const text = renderExecuteReport(report, noted, 'my-app');
    expect(text).toContain('  note: NOTE ran !pkg');
    expect(text).not.toContain('NEVER');
  });
});

describe('childEnv', () => {
  it('drops the npm_config_package an `npm exec --package=` launch leaves behind, and keeps the rest', () => {
    const env = childEnv(
      { PATH: '/bin', npm_config_package: '/tmp/cli.tgz', NPM_CONFIG_PACKAGE: 'x', npm_config_registry: 'https://r.example', HTTPS_PROXY: 'http://p' },
      { pnpm_config_strict_dep_builds: 'false' },
    );
    expect(env).toEqual({ PATH: '/bin', npm_config_registry: 'https://r.example', HTTPS_PROXY: 'http://p', pnpm_config_strict_dep_builds: 'false' });
  });
});

describe('executePlan — optional steps', () => {
  const optionalPlan: CreatePlan = {
    nextSteps: ['cd my-app'],
    steps: [
      { id: 'run-init', description: 'Run init', command: 'pnpm', args: ['init'], cwd: 'my-app' },
      {
        id: 'install-ai-plugin',
        description: 'Install the ponytail plugin',
        command: 'pnpm',
        args: ['plugin'],
        cwd: 'my-app',
        optional: true,
        failureHint: 'To retry: pnpm plugin',
        successNote: () => 'plugin note',
      },
      {
        id: 'install-ai-plugin',
        description: 'Install another plugin',
        command: 'pnpm',
        args: ['other'],
        cwd: 'my-app',
        optional: true,
        finalizeArgs: () => ({ error: 'no way' }),
      },
    ],
  };

  it('a failing optional step does not stop the run; the report names it, its hint, and keeps the next steps', () => {
    const calls: string[][] = [];
    const report = executePlan(optionalPlan, (_command, args) => {
      calls.push(args);
      return args[0] === 'plugin' ? fail() : ok();
    }, '/work');
    expect(calls).toEqual([['init'], ['plugin']]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.completed.map((c) => c.optionalFailure)).toEqual([
      undefined,
      'exit code: 1 (its own error output is printed above)',
      'stopped before execution: no way',
    ]);
    const text = renderExecuteReport(report, optionalPlan, 'my-app');
    expect(text).toContain('create-nx-archweave finished — the workspace is complete, but 2 optional step(s) failed:');
    expect(text).toContain('  optional step "install-ai-plugin" failed — Install the ponytail plugin.\n    exit code: 1');
    expect(text).toContain('    To retry: pnpm plugin');
    expect(text).toContain('    stopped before execution: no way');
    expect(text).not.toContain('plugin note');
    expect(text).toContain('Next steps:\n  cd my-app');
  });

  it('a successful optional step shows its note like any other', () => {
    const report = executePlan({ ...optionalPlan, steps: optionalPlan.steps.slice(0, 2) }, () => ok(), '/work');
    const text = renderExecuteReport(report, optionalPlan, 'my-app');
    expect(text).toContain('create-nx-archweave finished successfully.');
    expect(text).toContain('  note: plugin note');
  });
});

it('an optional step that never started (no exit code) says so', () => {
  const report = executePlan(
    { nextSteps: [], steps: [{ id: 'install-ai-plugin', description: 'Install', command: 'x', args: [], cwd: null, optional: true }] },
    () => ({ status: null }),
    '/work',
  );
  expect(report.ok && report.completed[0].optionalFailure).toBe('it did not start or was stopped (no exit code)');
});
