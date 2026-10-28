import { buildPlan, isYarnBerry, nxGenerateCommand, pendingBuildDecisions, type CreatePlanInput, type StepContext } from './plan.ts';
import { PLUGIN_CHOICES } from './types.ts';
import { CLI_VERSION } from '../render-usage.ts';

// The plan installs the plugin release this CLI was built with, so the spec follows a version bump.
const PLUGIN_SPEC = `@clearlydev/nx-archweave@^${CLI_VERSION}`;

const stepById = (plan: ReturnType<typeof buildPlan>, id: string) => plan.steps.find((step) => step.id === id)!;

const baseInput: CreatePlanInput = {
  packageManager: 'pnpm',
  name: 'my-app',
  preset: 'quick-start',
  frontend: 'react-vite',
  backend: 'none',
  locale: 'en',
  aiHosts: ['claude-code'],
};

describe('buildPlan', () => {
  it('builds the literal command list for react-vite', () => {
    const plan = buildPlan(baseInput);

    expect(plan.steps).toEqual([
      {
        id: 'create-workspace',
        description: 'Create the Nx workspace "my-app"',
        command: 'pnpm',
        args: [
          'dlx',
          'create-nx-workspace@24.0.1',
          'my-app',
          '--preset=empty',
          '--aiAgents=claude',
          '--pm=pnpm',
          '--nxCloud=skip',
          '--interactive=false',
        ],
        cwd: null,
      },
      {
        id: 'add-react-plugin',
        description: 'Add @nx/react with nx add (at the workspace nx version)',
        command: 'pnpm',
        args: ['nx', 'add', '@nx/react'],
        cwd: 'my-app',
      },
      {
        id: 'create-web-app',
        description: 'Create the React + Vite app in apps/web with the official @nx/react generator',
        command: 'pnpm',
        args: [
          'nx',
          'g',
          '@nx/react:app',
          'apps/web',
          '--bundler=vite',
          '--linter=eslint',
          '--style=css',
          '--unitTestRunner=vitest',
          '--e2eTestRunner=none',
          '--routing=false',
        ],
        cwd: 'my-app',
      },
      {
        id: 'install-plugin',
        description: `Install ${PLUGIN_SPEC}`,
        command: 'pnpm',
        args: ['add', '-D', '-w', PLUGIN_SPEC],
        cwd: 'my-app',
      },
      {
        id: 'run-init',
        description: 'Run the nx-archweave init generator',
        command: 'pnpm',
        args: [
          'nx',
          'g',
          '@clearlydev/nx-archweave:init',
          '--preset=quick-start',
          '--frontend=react-vite',
          '--backend=none',
          '--locale=en',
          '--aiHosts=claude-code',
      '--packageManager=pnpm',
          '--allowDirty=true',
          '--dirtyFromCaller=true',
          '--applyEslint=true',
        ],
        cwd: 'my-app',
      },
      {
        id: 'settle-build-approvals',
        description: expect.stringContaining('allowBuilds'),
        command: 'pnpm',
        args: ['approve-builds'],
        cwd: 'my-app',
        finalizeArgs: expect.any(Function),
        successNote: expect.any(Function),
        failureHint: expect.stringContaining('workspace itself is complete'),
      },
    ]);
  });

  it('maps the next frontend to the next create-nx-workspace preset', () => {
    const plan = buildPlan({ ...baseInput, frontend: 'next' });
    expect(plan.steps[0].args).toEqual([
      'dlx',
      'create-nx-workspace@24.0.1',
      'my-app',
      '--preset=next',
      '--appName=web',
      '--e2eTestRunner=none',
      '--aiAgents=claude',
      '--pm=pnpm',
      '--nxCloud=skip',
      '--interactive=false',
    ]);
  });

  it('overrides the plugin source in the install step only', () => {
    const plan = buildPlan({ ...baseInput, pluginSource: 'file:../local-plugin.tgz' });
    expect(stepById(plan, 'install-plugin')).toEqual({
      id: 'install-plugin',
      description: 'Install file:../local-plugin.tgz',
      command: 'pnpm',
      args: ['add', '-D', '-w', 'file:../local-plugin.tgz'],
      cwd: 'my-app',
    });
    // create-workspace and run-init steps are unaffected by pluginSource.
    expect(plan.steps[0].args).not.toContain('file:../local-plugin.tgz');
    expect(stepById(plan, 'run-init').args).not.toContain('file:../local-plugin.tgz');
  });

  it('appends --review=true to the init step when review is explicitly true', () => {
    const plan = buildPlan({ ...baseInput, review: true });
    expect(stepById(plan, 'run-init').args).toEqual([
      'nx',
      'g',
      '@clearlydev/nx-archweave:init',
      '--preset=quick-start',
      '--frontend=react-vite',
      '--backend=none',
      '--locale=en',
      '--aiHosts=claude-code',
      '--packageManager=pnpm',
      '--allowDirty=true',
      '--dirtyFromCaller=true',
      '--review=true',
      '--applyEslint=true',
    ]);
  });

  it('appends --review=false to the init step when review is explicitly false', () => {
    const plan = buildPlan({ ...baseInput, review: false });
    expect(stepById(plan, 'run-init').args).toEqual([
      'nx',
      'g',
      '@clearlydev/nx-archweave:init',
      '--preset=quick-start',
      '--frontend=react-vite',
      '--backend=none',
      '--locale=en',
      '--aiHosts=claude-code',
      '--packageManager=pnpm',
      '--allowDirty=true',
      '--dirtyFromCaller=true',
      '--review=false',
      '--applyEslint=true',
    ]);
  });

  it('always passes --allowDirty=true to init — the plugin-install step (step 2) has just dirtied the tree', () => {
    const plan = buildPlan(baseInput);
    expect(stepById(plan, 'run-init').args).toContain('--allowDirty=true');
  });

  it('tells init the dirty tree is its own plugin install, so the earlier-changes note stays out of the report', () => {
    const plan = buildPlan(baseInput);
    expect(stepById(plan, 'run-init').args).toContain('--dirtyFromCaller=true');
  });

  it('omits --review from the init step when review is left undefined', () => {
    const plan = buildPlan(baseInput);
    expect(stepById(plan, 'run-init').args.some((arg) => arg.startsWith('--review'))).toBe(false);
  });

  describe('nextSteps', () => {
    it('always leads with cd + a manual commit reminder, and never auto-commits', () => {
      const plan = buildPlan({ ...baseInput, review: false });
      expect(plan.nextSteps[0]).toBe('cd my-app');
      expect(plan.nextSteps[1]).toBe('git add -A && git commit -m "chore: initial commit"');
    });

    it('adds a definite review reminder when review is explicitly true', () => {
      const plan = buildPlan({ ...baseInput, review: true });
      expect(plan.nextSteps).toEqual([
        'cd my-app',
        'git add -A && git commit -m "chore: initial commit"',
        '(create-nx-archweave never commits for you — review what the init report above generated first.)',
        'AI PR review is enabled: add the review secret named in the init report above to the repository before opening a pull request.',
        'Verify the default branch matches what the init report above expects before relying on branch protection.',
      ]);
    });

    it('omits the review reminder entirely when review is explicitly false', () => {
      const plan = buildPlan({ ...baseInput, review: false });
      expect(plan.nextSteps).toEqual([
        'cd my-app',
        'git add -A && git commit -m "chore: initial commit"',
        '(create-nx-archweave never commits for you — review what the init report above generated first.)',
      ]);
    });

    it('adds a conditional review reminder when review is left undefined (preset default applies)', () => {
      const plan = buildPlan(baseInput);
      expect(plan.nextSteps).toEqual([
        'cd my-app',
        'git add -A && git commit -m "chore: initial commit"',
        '(create-nx-archweave never commits for you — review what the init report above generated first.)',
        'If the init report above shows AI PR review enabled, add the review secret it names to the repository before opening a pull request, and verify the default branch first.',
      ]);
    });
  });
});

describe('buildPlan — backend steps', () => {
  const stubCtx = (files: Record<string, string>, apps: string[]): StepContext => ({
    workspacePath: '/work/my-app',
    readFile: (rel) => files[rel],
    listDir: (rel) => (rel === 'apps' ? apps : []),
  });

  it("backend 'none' keeps exactly the three classic steps (plus pnpm's final settle step) with no other finalizeArgs", () => {
    const plan = buildPlan(baseInput);
    expect(plan.steps.map((s) => s.id)).toEqual(['create-workspace', 'add-react-plugin', 'create-web-app', 'install-plugin', 'run-init', 'settle-build-approvals']);
    expect(plan.steps.slice(0, 5).every((s) => s.finalizeArgs === undefined)).toBe(true);
    // the CLI just created the workspace: every ESLint rule is written for real
    expect(stepById(plan, 'run-init').args).toContain('--applyEslint=true');
    const npmPlan = buildPlan({ ...baseInput, packageManager: 'npm' });
    expect(npmPlan.steps.map((s) => s.id)).toEqual(['create-workspace', 'add-react-plugin', 'create-web-app', 'install-plugin', 'run-init']);
    expect(npmPlan.steps.every((s) => s.finalizeArgs === undefined)).toBe(true);
  });

  it('backend nest inserts the two official steps and forwards applyEslint to init', () => {
    const plan = buildPlan({ ...baseInput, backend: 'nest' });
    expect(plan.steps.map((s) => s.id)).toEqual([
      'create-workspace',
      'add-react-plugin',
      'create-web-app',
      'install-plugin',
      'install-backend-plugin',
      'create-api-app',
      'run-init',
      'settle-build-approvals',
    ]);
    expect(stepById(plan, 'run-init').args).toContain('--backend=nest');
    expect(stepById(plan, 'run-init').args).toContain('--applyEslint=true');
  });

  it('pins @nx/<backend> to the workspace nx version at execution time', () => {
    const plan = buildPlan({ ...baseInput, backend: 'express' });
    const step = plan.steps.find((s) => s.id === 'install-backend-plugin')!;
    const args = step.finalizeArgs!(stubCtx({ 'package.json': JSON.stringify({ devDependencies: { nx: '23.1.0' } }) }, ['web', 'web-e2e']));
    expect(args).toEqual(['add', '-D', '-w', '@nx/express@23.1.0']);
  });

  it('fails the install step cleanly when the nx version cannot be read', () => {
    const plan = buildPlan({ ...baseInput, backend: 'express' });
    const step = plan.steps.find((s) => s.id === 'install-backend-plugin')!;
    const result = step.finalizeArgs!(stubCtx({}, ['web', 'web-e2e']));
    expect(result).toHaveProperty('error');
  });

  it('detects the single frontend app dir for --frontendProject', () => {
    const plan = buildPlan({ ...baseInput, backend: 'nest' });
    const step = plan.steps.find((s) => s.id === 'create-api-app')!;
    const args = step.finalizeArgs!(stubCtx({}, ['web', 'web-e2e']));
    expect(args).toEqual(['nx', 'g', '@nx/nest:application', 'apps/api', '--frontendProject=web', '--unitTestRunner=vitest', '--e2eTestRunner=none']);
    const npmStep = buildPlan({ ...baseInput, backend: 'nest', packageManager: 'npm' }).steps.find((s) => s.id === 'create-api-app')!;
    expect(npmStep.finalizeArgs!(stubCtx({}, ['web', 'web-e2e']))).toEqual([
      'exec', 'nx', '--', 'g', '@nx/nest:application', 'apps/api', '--frontendProject=web', '--unitTestRunner=vitest', '--e2eTestRunner=none',
    ]);
  });

  it.each(['express', 'nest'] as const)('passes the unit test runner to @nx/%s:application, which asks for one in a terminal', (backend) => {
    const step = buildPlan({ ...baseInput, backend }).steps.find((s) => s.id === 'create-api-app')!;
    expect(step.args).toContain('--unitTestRunner=vitest');
    expect(step.finalizeArgs!(stubCtx({}, ['web']))).toContain('--unitTestRunner=vitest');
  });

  it('fails with both names when the frontend app is ambiguous', () => {
    const plan = buildPlan({ ...baseInput, backend: 'nest' });
    const step = plan.steps.find((s) => s.id === 'create-api-app')!;
    const result = step.finalizeArgs!(stubCtx({}, ['web', 'admin']));
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error).toContain('web');
      expect(result.error).toContain('admin');
    }
  });
});

describe('buildPlan — both frontends build apps/web with no api, so both official steps run', () => {
  const ctx = (apps: string[], files: Record<string, string> = {}): StepContext => ({
    workspacePath: '/work/my-app',
    readFile: (rel) => files[rel],
    listDir: (rel) => (rel === 'apps' ? apps : []),
  });

  it.each(['express', 'nest'] as const)('react-vite × %s: both official steps run against apps/web', (backend) => {
    const plan = buildPlan({ ...baseInput, backend });
    const install = stepById(plan, 'install-backend-plugin');
    const create = stepById(plan, 'create-api-app');
    const web = ctx(['web'], {
      'package.json': JSON.stringify({ devDependencies: { nx: '23.3.0' } }),
      'apps/web/package.json': JSON.stringify({ name: '@my-app/web' }),
    });
    expect(install.finalizeArgs!(web)).toEqual(['add', '-D', '-w', `@nx/${backend}@23.3.0`]);
    expect(create.finalizeArgs!(web)).toEqual(['nx', 'g', `@nx/${backend}:application`, 'apps/api', '--frontendProject=@my-app/web', '--unitTestRunner=vitest', '--e2eTestRunner=none']);
  });

  it.each(['express', 'nest'] as const)('an apps/api that already exists stops %s before any backend step, pointing at add-backend', (backend) => {
    const plan = buildPlan({ ...baseInput, backend });
    const first = stepById(plan, 'install-backend-plugin');
    const result = first.finalizeArgs!(ctx(['api', 'web'], { 'package.json': JSON.stringify({ devDependencies: { nx: '23.3.0' } }) }));
    expect(result).toHaveProperty('error');
    if ('error' in result) expect(result.error).toContain(`add-backend --backend=${backend}`);
  });

  it.each(['express', 'nest'] as const)('next × %s: Nx 23 builds apps/web — both official steps run against it', (backend) => {
    const plan = buildPlan({ ...baseInput, frontend: 'next', backend });
    const install = plan.steps.find((s) => s.id === 'install-backend-plugin')!;
    const create = plan.steps.find((s) => s.id === 'create-api-app')!;
    const next = ctx(['web', 'web-e2e'], {
      'package.json': JSON.stringify({ devDependencies: { nx: '23.2.0' } }),
      'apps/web/package.json': JSON.stringify({ name: '@my-app/web' }),
    });
    expect(install.finalizeArgs!(next)).toEqual(['add', '-D', '-w', `@nx/${backend}@23.2.0`]);
    expect(create.finalizeArgs!(next)).toEqual(['nx', 'g', `@nx/${backend}:application`, 'apps/api', '--frontendProject=@my-app/web', '--unitTestRunner=vitest', '--e2eTestRunner=none']);
  });

  it('a workspace without apps/: refuses with the manual add-backend guidance', () => {
    const plan = buildPlan({ ...baseInput, frontend: 'next', backend: 'express' });
    const create = plan.steps.find((s) => s.id === 'create-api-app')!;
    const result = create.finalizeArgs!(ctx([]));
    expect(result).toHaveProperty('error');
    if ('error' in result) expect(result.error).toContain('add-backend');
  });
});

describe('buildPlan — next steps and the nest conflict', () => {
  it('nextSteps tell the user to pnpm install when a backend was wired', () => {
    const plan = buildPlan({ name: 'my-app', preset: 'solo', frontend: 'react-vite', backend: 'express', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    expect(plan.nextSteps.some((line) => line.includes('pnpm install'))).toBe(true);
  });

  it('nextSteps stay install-free when backend is none', () => {
    const plan = buildPlan({ name: 'my-app', preset: 'solo', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    expect(plan.nextSteps.some((line) => line.includes('pnpm install'))).toBe(false);
  });

  it('the nest conflict stop tells the user how to finish setup with init', () => {
    const plan = buildPlan({ name: 'my-app', preset: 'solo', frontend: 'react-vite', backend: 'nest', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    const step = plan.steps.find((s) => s.id === 'install-backend-plugin');
    const finalized = step?.finalizeArgs?.({
      workspacePath: '/w',
      readFile: () => undefined,
      listDir: (p) => (p === 'apps' ? ['api', 'web'] : []),
    });
    expect(finalized && 'error' in finalized ? finalized.error : '').toContain('@clearlydev/nx-archweave:init');
  });
});

describe('buildPlan — npm command matrix', () => {
  const npmPlan = () =>
    buildPlan({ name: 'my-app', preset: 'solo', frontend: 'react-vite', backend: 'express', locale: 'en', aiHosts: ['claude-code'], packageManager: 'npm' });

  it('create-workspace uses npx with --pm=npm', () => {
    const step = npmPlan().steps.find((s) => s.id === 'create-workspace');
    expect(step?.command).toBe('npx');
    expect(step?.args).toContain('--pm=npm');
    expect(step?.args).toContain('-y');
  });

  it('install-plugin uses npm install -D and NEVER -w (npm -w means --workspace=<name>)', () => {
    const step = npmPlan().steps.find((s) => s.id === 'install-plugin');
    expect(step?.command).toBe('npm');
    expect(step?.args?.slice(0, 2)).toEqual(['install', '-D']);
    expect(step?.args).not.toContain('-w');
  });

  it('run-init goes through npm exec nx -- g, with the -- separator before generator args', () => {
    const step = npmPlan().steps.find((s) => s.id === 'run-init');
    expect(step?.command).toBe('npm');
    expect(step?.args?.slice(0, 3)).toEqual(['exec', 'nx', '--']);
    expect(step?.args).toContain('--packageManager=npm');
  });

  it('backend install finalize pins via npm install -D without -w', () => {
    const step = npmPlan().steps.find((s) => s.id === 'install-backend-plugin');
    const ctx = {
      workspacePath: '/w',
      readFile: (p: string) => (p === 'package.json' ? JSON.stringify({ devDependencies: { nx: '23.2.0' } }) : undefined),
      listDir: (p: string) => (p === 'apps' ? ['web'] : []),
    };
    const finalized = step?.finalizeArgs?.(ctx);
    expect(finalized).toEqual(['install', '-D', '@nx/express@23.2.0']);
  });

  it('nextSteps say npm install for the npm plan', () => {
    expect(npmPlan().nextSteps.some((l) => l.includes('npm install'))).toBe(true);
  });

  it('pnpm plans keep the pnpm matrix and pass --packageManager=pnpm to init', () => {
    const plan = buildPlan({ name: 'my-app', preset: 'solo', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    expect(plan.steps.find((s) => s.id === 'create-workspace')?.command).toBe('pnpm');
    expect(plan.steps.find((s) => s.id === 'run-init')?.args).toContain('--packageManager=pnpm');
  });
});

describe('buildPlan — react-vite starts from the empty preset and Nx\'s own React generator', () => {
  // --preset=react-monorepo becomes a template download under an AI agent's environment;
  // empty is never redirected and downloads nothing.
  it('asks for --preset=empty, never a template or react-monorepo, for every package manager', () => {
    for (const packageManager of ['pnpm', 'npm', 'yarn', 'bun'] as const) {
      const args = stepById(buildPlan({ ...baseInput, packageManager }), 'create-workspace').args;
      expect(args).toContain('--preset=empty');
      expect(args.some((a) => a.startsWith('--template') || a === '--preset=react-monorepo')).toBe(false);
    }
  });

  it('adds @nx/react and the apps/web app right after the workspace, before the plugin install', () => {
    const ids = buildPlan(baseInput).steps.map((s) => s.id);
    expect(ids.slice(0, 4)).toEqual(['create-workspace', 'add-react-plugin', 'create-web-app', 'install-plugin']);
    expect(stepById(buildPlan({ ...baseInput, packageManager: 'npm' }), 'add-react-plugin').args).toEqual(['exec', 'nx', '--', 'add', '@nx/react']);
  });

  it('passes every option @nx/react:app would ask about, with no e2e project', () => {
    const args = stepById(buildPlan(baseInput), 'create-web-app').args;
    for (const flag of ['--bundler=vite', '--linter=eslint', '--style=css', '--unitTestRunner=vitest', '--e2eTestRunner=none', '--routing=false']) {
      expect(args).toContain(flag);
    }
  });

  it('keeps the next preset for --frontend=next, with no React steps', () => {
    const plan = buildPlan({ ...baseInput, frontend: 'next', packageManager: 'npm' });
    expect(plan.steps[0].args).toContain('--preset=next');
    expect(plan.steps.map((s) => s.id)).not.toContain('create-web-app');
  });

  it.each([
    ['react-vite', 'express', 'create-web-app'],
    ['next', 'nest', 'create-workspace'],
    ['none', 'express', 'create-workspace'],
    ['none', 'nest', 'create-workspace'],
  ] as const)('%s × %s: no step creates an e2e project', (frontend, backend, appStep) => {
    const plan = buildPlan({ ...baseInput, frontend, backend });
    expect(stepById(plan, appStep).args).toContain('--e2eTestRunner=none');
    const api = plan.steps.find((s) => s.id === 'create-api-app');
    if (api) expect(api.args).toContain('--e2eTestRunner=none');
  });

  it('a backend-only workspace gets vitest, like the api the other paths create', () => {
    const args = stepById(buildPlan({ ...baseInput, frontend: 'none', backend: 'express' }), 'create-workspace').args;
    expect(args).toEqual(expect.arrayContaining(['--preset=express', '--appName=api', '--e2eTestRunner=none', '--unitTestRunner=vitest']));
  });

  it('says --aiAgents=none when no AI host is picked, so Nx adds nothing on its own', () => {
    const args = stepById(buildPlan({ ...baseInput, aiHosts: [] }), 'create-workspace').args;
    expect(args.filter((a) => a.startsWith('--aiAgents'))).toEqual(['--aiAgents=none']);
  });

  it('attaches no failure hint to the create step for any package manager', () => {
    for (const packageManager of ['pnpm', 'npm', 'yarn', 'bun'] as const) {
      expect(buildPlan({ ...baseInput, packageManager }).steps[0].failureHint).toBeUndefined();
    }
  });
});

describe('buildPlan — validated create-nx-workspace pin (E2E CI finding)', () => {
  it('pins create-nx-workspace to the version the E2E gate validated, never @latest', () => {
    for (const packageManager of ['pnpm', 'npm'] as const) {
      const plan = buildPlan({ name: 'my-app', preset: 'solo', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], packageManager });
      const step = plan.steps.find((s) => s.id === 'create-workspace');
      const spec = step?.args.find((a) => a.startsWith('create-nx-workspace@'));
      expect(spec).toBe('create-nx-workspace@24.0.1');
    }
  });

  it('create-api-app resolves --frontendProject to the PROJECT name, not the directory (scoped templates)', () => {
    const plan = buildPlan({ name: 'my-app', preset: 'solo', frontend: 'react-vite', backend: 'express', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    const step = plan.steps.find((s) => s.id === 'create-api-app');
    const ctx = {
      workspacePath: '/w',
      readFile: (p: string) =>
        p === 'apps/web/package.json' ? JSON.stringify({ name: '@org/web' }) : undefined,
      listDir: (p: string) => (p === 'apps' ? ['web'] : []),
    };
    const finalized = step?.finalizeArgs?.(ctx);
    expect(Array.isArray(finalized) ? finalized : []).toContain('--frontendProject=@org/web');
  });

  it('falls back to the directory name when no project file is readable', () => {
    const plan = buildPlan({ name: 'my-app', preset: 'solo', frontend: 'react-vite', backend: 'express', locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    const step = plan.steps.find((s) => s.id === 'create-api-app');
    const ctx = { workspacePath: '/w', readFile: () => undefined, listDir: (p: string) => (p === 'apps' ? ['web'] : []) };
    const finalized = step?.finalizeArgs?.(ctx);
    expect(Array.isArray(finalized) ? finalized : []).toContain('--frontendProject=web');
  });
});

describe('buildPlan — pnpm 11 build decisions (2026-10-14)', () => {
  const ctx = (files: Record<string, string>): StepContext => ({
    workspacePath: '/w',
    readFile: (rel) => files[rel],
    listDir: () => [],
  });

  it('pnpm plans run every step with strict dependency builds off; npm plans carry no env', () => {
    expect(buildPlan(baseInput).env).toEqual({ pnpm_config_strict_dep_builds: 'false' });
    expect(buildPlan({ ...baseInput, packageManager: 'npm' }).env).toBeUndefined();
  });

  it('pnpm plans end with settle-build-approvals; npm plans never have it', () => {
    for (const backend of ['none', 'express'] as const) {
      const ids = buildPlan({ ...baseInput, backend }).steps.map((s) => s.id);
      expect(ids[ids.length - 1]).toBe('settle-build-approvals');
      expect(ids[ids.length - 2]).toBe('run-init');
    }
    expect(buildPlan({ ...baseInput, packageManager: 'npm' }).steps.some((s) => s.id === 'settle-build-approvals')).toBe(false);
  });

  it('denies exactly the entries pnpm left pending, through pnpm approve-builds', () => {
    const step = buildPlan(baseInput).steps.find((s) => s.id === 'settle-build-approvals')!;
    expect(step.command).toBe('pnpm');
    expect(step.cwd).toBe('my-app');
    const yaml = [
      'packages:',
      "  - 'apps/*'",
      'allowBuilds:',
      "  '@parcel/watcher': set this to true or false",
      '  nx: true',
      '  sharp: set this to true or false',
      '  esbuild: false',
      '',
    ].join('\n');
    expect(step.finalizeArgs!(ctx({ 'pnpm-workspace.yaml': yaml }))).toEqual(['approve-builds', '!@parcel/watcher', '!sharp']);
  });

  it('is skipped when nothing is pending or the file is absent', () => {
    const step = buildPlan(baseInput).steps.find((s) => s.id === 'settle-build-approvals')!;
    expect(step.finalizeArgs!(ctx({ 'pnpm-workspace.yaml': 'allowBuilds:\n  nx: true\n' }))).toHaveProperty('skip');
    expect(step.finalizeArgs!(ctx({}))).toHaveProperty('skip');
  });

  it('its success note names the denied packages and the one command that re-allows one (pnpm 11.9)', () => {
    const step = buildPlan(baseInput).steps.find((s) => s.id === 'settle-build-approvals')!;
    const note = step.successNote!(['approve-builds', '!@parcel/watcher', '!sharp']);
    expect(note).toContain('@parcel/watcher, sharp');
    // once denied, `pnpm approve-builds` no longer lists a package — allow-builds flips it and rebuilds
    expect(note).toContain('pnpm nx g @clearlydev/nx-archweave:allow-builds --packages=<package> --apply');
    expect(note).not.toContain('Run "pnpm approve-builds"');
    expect(note).toContain('my-app');
    expect(step.description).not.toContain('approve-builds can allow');
  });

  it('a failed settle step says the workspace itself is complete and how to settle the entries by hand', () => {
    const step = buildPlan(baseInput).steps.find((s) => s.id === 'settle-build-approvals')!;
    expect(step.failureHint).toContain('workspace itself is complete');
    expect(step.failureHint).toContain('set this to true or false');
  });
});

describe('pendingBuildDecisions', () => {
  it('reads quoted and unquoted keys holding the placeholder, CRLF included', () => {
    const yaml = "allowBuilds:\r\n  \"@swc/core\": set this to true or false\r\n  unrs-resolver: 'set this to true or false'\r\n  nx: true\r\n";
    expect(pendingBuildDecisions(yaml)).toEqual(['@swc/core', 'unrs-resolver']);
  });

  it('keeps keys that contain a colon whole (file:, git: and tarball dependencies)', () => {
    const yaml = "allowBuilds:\n  foo@file:../foo: set this to true or false\n  'bar@git+https://x/y.git#a:b': set this to true or false\n";
    expect(pendingBuildDecisions(yaml)).toEqual(['foo@file:../foo', 'bar@git+https://x/y.git#a:b']);
  });

  it('reads the single-line flow form pnpm keeps when the file had allowBuilds: {}', () => {
    expect(pendingBuildDecisions("allowBuilds: { core-js-pure: set this to true or false, nx: true, '@swc/core': set this to true or false }\n")).toEqual([
      'core-js-pure',
      '@swc/core',
    ]);
    expect(pendingBuildDecisions('allowBuilds: {}\n')).toEqual([]);
  });

  it('never reads a comment line as a package', () => {
    expect(pendingBuildDecisions('allowBuilds:\n  # x: set this to true or false\n  y: set this to true or false\n')).toEqual(['y']);
  });

  it('a column-0 comment inside allowBuilds does not end the block', () => {
    const yaml = 'allowBuilds:\n  a: set this to true or false\n# a note\n  b: set this to true or false\npackages:\n  - x\n';
    expect(pendingBuildDecisions(yaml)).toEqual(['a', 'b']);
  });

  it('ignores the placeholder text outside allowBuilds and stops at the next top-level key', () => {
    const yaml = [
      'catalog:',
      '  foo: set this to true or false',
      'allowBuilds:',
      '  sharp: set this to true or false',
      'packages:',
      '  - set this to true or false',
    ].join('\n');
    expect(pendingBuildDecisions(yaml)).toEqual(['sharp']);
    expect(pendingBuildDecisions("packages:\n  - 'apps/*'\n")).toEqual([]);
  });
});

describe('buildPlan — yarn', () => {
  const yarnInput: CreatePlanInput = { ...baseInput, packageManager: 'yarn', backend: 'express' };
  const files = (entries: Record<string, string>): StepContext => ({
    workspacePath: '/work/my-app',
    readFile: (rel) => entries[rel],
    listDir: (rel) => (rel === 'apps' ? ['web'] : []),
  });

  it('creates through npx with --pm=yarn, runs nx through yarn, and turns off immutable installs for every step', () => {
    const plan = buildPlan(yarnInput);
    expect(plan.steps[0]).toMatchObject({ command: 'npx', args: expect.arrayContaining(['-y', '--pm=yarn']) });
    const init = plan.steps.find((step) => step.id === 'run-init')!;
    expect(init.command).toBe('yarn');
    expect(init.args.slice(0, 3)).toEqual(['nx', 'g', '@clearlydev/nx-archweave:init']);
    expect(init.args).toContain('--packageManager=yarn');
    expect(plan.env).toEqual({ YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' });
    // pnpm's build-approval step is pnpm-only
    expect(plan.steps.some((step) => step.id === 'settle-build-approvals')).toBe(false);
  });

  it('adds the plugin at the root with -W on classic and without it on berry, as the created workspace says', () => {
    const install = buildPlan(yarnInput).steps.find((step) => step.id === 'install-plugin')!;
    expect(install.command).toBe('yarn');
    expect(install.finalizeArgs!(files({ 'yarn.lock': '# yarn lockfile v1\n' }))).toEqual(['add', '-D', '-W', PLUGIN_SPEC]);
    expect(install.finalizeArgs!(files({ '.yarnrc.yml': 'nodeLinker: node-modules\n' }))).toEqual(['add', '-D', PLUGIN_SPEC]);
  });

  it('the official backend steps use yarn too, with the flavor read the same way', () => {
    const plan = buildPlan({ ...yarnInput, backend: 'nest' });
    const backendPlugin = plan.steps.find((step) => step.id === 'install-backend-plugin')!;
    const pkg = JSON.stringify({ devDependencies: { nx: '23.2.0' } });
    expect(backendPlugin.finalizeArgs!(files({ 'package.json': pkg, '.yarnrc.yml': '' }))).toEqual(['add', '-D', '@nx/nest@23.2.0']);
    const api = plan.steps.find((step) => step.id === 'create-api-app')!;
    expect(api.command).toBe('yarn');
    expect(api.finalizeArgs!(files({}))).toEqual(['nx', 'g', '@nx/nest:application', 'apps/api', '--frontendProject=web', '--unitTestRunner=vitest', '--e2eTestRunner=none']);
  });

  it('isYarnBerry: .yarnrc.yml or a __metadata lockfile', () => {
    expect(isYarnBerry({ readFile: (rel) => (rel === '.yarnrc.yml' ? '' : undefined) })).toBe(true);
    expect(isYarnBerry({ readFile: (rel) => (rel === 'yarn.lock' ? '__metadata:\n  version: 8\n' : undefined) })).toBe(true);
    expect(isYarnBerry({ readFile: (rel) => (rel === 'yarn.lock' ? '# yarn lockfile v1\n' : undefined) })).toBe(false);
  });
});


describe('buildPlan — bun', () => {
  const bunInput: CreatePlanInput = { ...baseInput, packageManager: 'bun', backend: 'express' };
  const files = (entries: Record<string, string>): StepContext => ({
    workspacePath: '/work/my-app',
    readFile: (rel) => entries[rel],
    listDir: (rel) => (rel === 'apps' ? ['web'] : []),
  });

  it('creates through npx with --pm=bun, adds the plugin at the root with bun add -d, runs nx through bun — no plan env', () => {
    const plan = buildPlan(bunInput);
    expect(plan.steps[0]).toMatchObject({ command: 'npx', args: expect.arrayContaining(['-y', '--pm=bun']) });
    expect(plan.steps[0].failureHint).toBeUndefined();
    expect(plan.steps.find((step) => step.id === 'install-plugin')).toMatchObject({
      command: 'bun',
      args: ['add', '-d', PLUGIN_SPEC],
    });
    const init = plan.steps.find((step) => step.id === 'run-init')!;
    expect(init.command).toBe('bun');
    expect(init.args.slice(0, 3)).toEqual(['nx', 'g', '@clearlydev/nx-archweave:init']);
    expect(init.args).toContain('--packageManager=bun');
    expect(plan.env).toBeUndefined();
    expect(plan.steps.some((step) => step.id === 'settle-build-approvals')).toBe(false);
    expect(plan.nextSteps).toContain('bun install   (links the new shared-types workspace package — do this before the first commit)');
  });

  it('the official backend steps use bun too', () => {
    const plan = buildPlan({ ...bunInput, backend: 'nest' });
    const backendPlugin = plan.steps.find((step) => step.id === 'install-backend-plugin')!;
    expect(backendPlugin.finalizeArgs!(files({ 'package.json': JSON.stringify({ devDependencies: { nx: '23.2.0' } }) }))).toEqual(['add', '-d', '@nx/nest@23.2.0']);
    const api = plan.steps.find((step) => step.id === 'create-api-app')!;
    expect(api.command).toBe('bun');
    expect(api.finalizeArgs!(files({}))).toEqual(['nx', 'g', '@nx/nest:application', 'apps/api', '--frontendProject=web', '--unitTestRunner=vitest', '--e2eTestRunner=none']);
  });

  it('ends with a read-only bun pm untrusted, whose note names the way back (bun pm trust)', () => {
    const plan = buildPlan(bunInput);
    const last = plan.steps[plan.steps.length - 1];
    expect(last).toMatchObject({ id: 'list-blocked-scripts', command: 'bun', args: ['pm', 'untrusted'], cwd: 'my-app' });
    expect(last.finalizeArgs).toBeUndefined();
    expect(last.successNote!(last.args)).toMatch(/bun blocks the install scripts.*stay blocked.*inside "my-app": bun pm trust <package>/);
    expect(last.failureHint).toMatch(/The workspace itself is complete/);
    // the other managers never get it
    for (const packageManager of ['npm', 'pnpm', 'yarn'] as const) {
      expect(buildPlan({ ...bunInput, packageManager }).steps.some((step) => step.id === 'list-blocked-scripts')).toBe(false);
    }
  });
});

describe('buildPlan — AI hosts', () => {
  it('one --aiAgents per host on the create step (Nx rejects a comma list), and the ids to init as --aiHosts', () => {
    for (const packageManager of ['pnpm', 'npm'] as const) {
      const plan = buildPlan({ ...baseInput, packageManager, frontend: 'next', aiHosts: ['gemini-cli', 'claude-code', 'codex'] });
      const create = plan.steps[0].args;
      expect(create.filter((arg) => arg.startsWith('--aiAgents'))).toEqual(['--aiAgents=gemini', '--aiAgents=claude', '--aiAgents=codex']);
      const init = plan.steps.find((step) => step.id === 'run-init')!;
      expect(init.args).toContain('--aiHosts=gemini-cli,claude-code,codex');
    }
  });
});

describe('buildPlan — plugins', () => {
  const ponytail = PLUGIN_CHOICES[0];

  it('none: no plugin step', () => {
    expect(buildPlan(baseInput).steps.map((step) => step.id)).not.toContain('install-ai-plugin');
    expect(buildPlan({ ...baseInput, plugins: [] }).steps.map((step) => step.id)).not.toContain('install-ai-plugin');
  });

  it('one optional install-integration step per plugin, at project scope, after everything else', () => {
    const plan = buildPlan({ ...baseInput, plugins: [ponytail] });
    const last = plan.steps[plan.steps.length - 1];
    expect(plan.steps.map((step) => step.id)).toEqual(['create-workspace', 'add-react-plugin', 'create-web-app', 'install-plugin', 'run-init', 'settle-build-approvals', 'install-ai-plugin']);
    expect(last).toMatchObject({
      id: 'install-ai-plugin',
      description: 'Install the ponytail plugin for Claude Code (project scope)',
      command: 'pnpm',
      args: ['nx', 'g', '@clearlydev/nx-archweave:install-integration', '--tool=ponytail', '--target=claude-code', '--scope=project', '--apply'],
      cwd: 'my-app',
      optional: true,
    });
    expect(last.failureHint).toBe(
      'The workspace itself is complete. To retry inside "my-app": pnpm nx g @clearlydev/nx-archweave:install-integration --tool=ponytail --target=claude-code --scope=project --apply',
    );
    expect(last.successNote?.(last.args)).toContain('the ponytail report above says whether it was installed and recorded');
  });

  it("runs through the workspace's own manager (npm needs exec … --)", () => {
    const plan = buildPlan({ ...baseInput, packageManager: 'npm', plugins: [ponytail] });
    expect(plan.steps[plan.steps.length - 1].args.slice(0, 5)).toEqual(['exec', 'nx', '--', 'g', '@clearlydev/nx-archweave:install-integration']);
    expect(nxGenerateCommand('npm')).toBe('npm exec nx -- g');
    expect(nxGenerateCommand('bun')).toBe('bun nx g');
  });
});

describe('buildPlan — review provider', () => {
  const initArgs = (input: Partial<CreatePlanInput>) => buildPlan({ ...baseInput, ...input }).steps.find((step) => step.id === 'run-init')?.args ?? [];

  it('passes --reviewProvider to init when one was chosen, never with --no-review, and nothing otherwise', () => {
    expect(initArgs({ reviewProvider: 'gemini' })).toContain('--reviewProvider=gemini');
    expect(initArgs({ reviewProvider: 'gemini', review: false })).not.toContain('--reviewProvider=gemini');
    expect(initArgs({}).some((arg) => arg.startsWith('--reviewProvider'))).toBe(false);
  });
});

describe('buildPlan — backend-only (frontend none)', () => {
  it.each(['express', 'nest'] as const)("%s: Nx's own preset builds apps/api; no official backend steps; init gets --frontend=none", (backend) => {
    const plan = buildPlan({ name: 'my-api', preset: 'solo', frontend: 'none', backend, locale: 'en', aiHosts: ['claude-code'], packageManager: 'pnpm' });
    const create = plan.steps.find((s) => s.id === 'create-workspace')!;
    expect(create.args).toEqual(expect.arrayContaining([`--preset=${backend}`, '--appName=api']));
    expect(plan.steps.map((s) => s.id)).not.toContain('install-backend-plugin');
    expect(plan.steps.map((s) => s.id)).not.toContain('create-api-app');
    const init = plan.steps.find((s) => s.id === 'run-init')!;
    expect(init.args).toEqual(expect.arrayContaining(['--frontend=none', `--backend=${backend}`, '--applyEslint=true']));
  });
});
