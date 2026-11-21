import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLintCacheCheck, buildLintInputsSpreadCheck } from './lint-cache-check.ts';
import { runDoctorChecks } from './run-doctor-checks.ts';
import type { DoctorProject } from './doctor-projects.ts';

const FSD_CONFIG = "import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';\nexport default [...fsdBoundaries({ severity: 'warn', cwd: import.meta.dirname })];\n";
const PLAIN_CONFIG = 'export default [];\n';
const ESLINT_PLUGIN = { plugin: '@nx/eslint/plugin', options: { targetName: 'lint' } };
const SPREAD = ['...', '{workspaceRoot}/toolkit.config.json'];

const WEB: DoctorProject = { name: 'web', root: 'apps/web', sourceRoot: 'apps/web/src', tags: [] };
const API: DoctorProject = { name: 'api', root: 'apps/api', sourceRoot: 'apps/api/src', tags: [] };

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function workspace(nxJson: Record<string, unknown>, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-lint-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'nx.json'), JSON.stringify(nxJson, null, 2));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'ws', devDependencies: { nx: '24.0.1' } }));
  writeFileSync(join(dir, 'toolkit.config.json'), JSON.stringify({ frontend: 'react-vite' }));
  const all = { 'apps/web/eslint.config.mjs': FSD_CONFIG, 'apps/web/package.json': JSON.stringify({ name: 'web' }), ...files };
  for (const [file, content] of Object.entries(all)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

describe('buildLintCacheCheck — the FSD rule reads toolkit.config.json; does lint\'s cache see it?', () => {
  it('passes quietly when targetDefaults lists it after "..."', () => {
    const dir = workspace({ plugins: [ESLINT_PLUGIN], targetDefaults: { lint: { inputs: SPREAD } } });
    const check = buildLintCacheCheck(dir, [WEB]);
    expect(check).toMatchObject({ id: 'fsd-lint-cache', status: 'pass' });
    expect(check.suggestedAction).toBeUndefined();
  });

  it('passes quietly when a named input carries it', () => {
    const dir = workspace({
      namedInputs: { fsdPolicy: ['{workspaceRoot}/toolkit.config.json'] },
      plugins: [ESLINT_PLUGIN],
      targetDefaults: { lint: { inputs: ['...', 'fsdPolicy'] } },
    });
    expect(buildLintCacheCheck(dir, [WEB]).suggestedAction).toBeUndefined();
  });

  it('reads the lint target name from @nx/eslint/plugin', () => {
    const dir = workspace({ plugins: [{ plugin: '@nx/eslint/plugin', options: { targetName: 'eslint' } }], targetDefaults: { eslint: { inputs: SPREAD } } });
    expect(buildLintCacheCheck(dir, [WEB]).suggestedAction).toBeUndefined();
  });

  it('passes with the targetDefaults snippet, "..." kept and explained, when the input is missing and every lint target is inferred', () => {
    const dir = workspace({ plugins: [ESLINT_PLUGIN] });
    const check = buildLintCacheCheck(dir, [WEB]);
    expect(check.status).toBe('pass');
    expect(check.evidence).toEqual(['web']);
    expect(check.suggestedAction).toContain('"targetDefaults": { "lint": { "inputs": ["...", "{workspaceRoot}/toolkit.config.json"] } }');
    expect(check.suggestedAction).toMatch(/Keep "\.\.\.".*dropped/s);
    expect(check.suggestedAction).toContain('nx lint web --skip-nx-cache');
    expect(check.suggestedAction).toContain('from nx-archweave 0.5.0 on has it already');
  });

  it('gives a per-project snippet instead when any project in the workspace writes its own lint target', () => {
    const dir = workspace(
      { plugins: [ESLINT_PLUGIN] },
      { 'apps/api/project.json': JSON.stringify({ name: 'api', targets: { lint: { executor: '@nx/eslint:lint' } } }) },
    );
    const check = buildLintCacheCheck(dir, [WEB, API]);
    expect(check.status).toBe('pass');
    expect(check.suggestedAction).not.toContain('targetDefaults": {');
    expect(check.suggestedAction).toContain('apps/web/package.json');
    expect(check.suggestedAction).toContain('"default", "^default"');
    expect(check.suggestedAction).toContain('{workspaceRoot}/toolkit.config.json');
    expect(check.suggestedAction).toContain('--skip-nx-cache');
  });

  it("a project's own lint inputs win over targetDefaults: missing there is missing", () => {
    const dir = workspace(
      { plugins: [ESLINT_PLUGIN], targetDefaults: { lint: { inputs: SPREAD } } },
      { 'apps/web/package.json': JSON.stringify({ name: 'web', nx: { targets: { lint: { executor: '@nx/eslint:lint', inputs: ['default'] } } } }) },
    );
    const check = buildLintCacheCheck(dir, [WEB]);
    expect(check.status).toBe('pass');
    expect(check.suggestedAction).toContain('Add "{workspaceRoot}/toolkit.config.json" to the inputs of the lint target in apps/web/package.json');
  });

  it('a project at the workspace root already has toolkit.config.json among its files', () => {
    const dir = workspace({ plugins: [ESLINT_PLUGIN] }, { 'eslint.config.mjs': FSD_CONFIG });
    const check = buildLintCacheCheck(dir, [{ name: 'app', root: '.', sourceRoot: 'src', tags: [] }]);
    expect(check.status).toBe('pass');
    expect(check.suggestedAction).toBeUndefined();
  });

  it('nothing to check when no ESLint config wires the FSD rule', () => {
    const dir = workspace({ plugins: [ESLINT_PLUGIN] }, { 'apps/web/eslint.config.mjs': PLAIN_CONFIG });
    expect(buildLintCacheCheck(dir, [WEB])).toMatchObject({ status: 'not-applicable', suggestedAction: undefined });
  });

  it('never changes the overall status', () => {
    const dir = workspace({ plugins: [ESLINT_PLUGIN] });
    const before = runDoctorChecks(dir, [WEB]);
    expect(before.checks.find((c) => c.id === 'fsd-lint-cache')?.status).toBe('pass');
    expect(before.checks.some((c) => c.status === 'warning' && c.id === 'fsd-lint-cache')).toBe(false);
  });
});

describe('buildLintInputsSpreadCheck — "..." with nothing to keep', () => {
  it.each([
    ['project.json', 'apps/api/project.json', JSON.stringify({ name: 'api', targets: { lint: { executor: '@nx/eslint:lint' } } })],
    ['package.json nx.targets', 'apps/api/package.json', JSON.stringify({ name: 'api', nx: { targets: { lint: { executor: '@nx/eslint:lint' } } } })],
  ])('warns and names the project whose own lint target has no inputs (%s)', (_where, file, content) => {
    const dir = workspace({ plugins: [ESLINT_PLUGIN], targetDefaults: { lint: { inputs: SPREAD } } }, { [file]: content });
    const check = buildLintInputsSpreadCheck(dir, [WEB, API]);
    expect(check).toMatchObject({ id: 'lint-inputs-spread', status: 'warning', evidence: ['api'] });
    expect(check.message).toMatch(/source change/);
    expect(check.suggestedAction).toContain('apps/api');
  });

  it('a "..." in the middle spreads the same way (Nx expands it where it stands)', () => {
    const dir = workspace(
      { plugins: [ESLINT_PLUGIN], targetDefaults: { lint: { inputs: ['{workspaceRoot}/toolkit.config.json', '...'] } } },
      { 'apps/api/project.json': JSON.stringify({ name: 'api', targets: { lint: { executor: '@nx/eslint:lint' } } }) },
    );
    expect(buildLintInputsSpreadCheck(dir, [WEB, API])).toMatchObject({ status: 'warning', evidence: ['api'] });
  });

  it('warns for the executor key too, with the plugin not registered', () => {
    const dir = workspace(
      { targetDefaults: { '@nx/eslint:lint': { inputs: SPREAD } } },
      { 'apps/api/project.json': JSON.stringify({ name: 'api', targets: { lint: { executor: '@nx/eslint:lint' } } }) },
    );
    expect(buildLintInputsSpreadCheck(dir, [WEB, API])).toMatchObject({ status: 'warning', evidence: ['api'] });
  });

  it('passes when the own target has its own inputs (targetDefaults does not apply to it)', () => {
    const dir = workspace(
      { plugins: [ESLINT_PLUGIN], targetDefaults: { lint: { inputs: SPREAD } } },
      { 'apps/api/project.json': JSON.stringify({ name: 'api', targets: { lint: { executor: '@nx/eslint:lint', inputs: ['default'] } } }) },
    );
    expect(buildLintInputsSpreadCheck(dir, [WEB, API]).status).toBe('pass');
  });

  it('passes when targetDefaults lists the project files itself next to "..."', () => {
    const dir = workspace(
      { plugins: [ESLINT_PLUGIN], targetDefaults: { lint: { inputs: ['...', 'default', '^default', '{workspaceRoot}/toolkit.config.json'] } } },
      { 'apps/api/project.json': JSON.stringify({ name: 'api', targets: { lint: { executor: '@nx/eslint:lint' } } }) },
    );
    expect(buildLintInputsSpreadCheck(dir, [WEB, API]).status).toBe('pass');
  });

  it('passes when every lint target is inferred', () => {
    const dir = workspace({ plugins: [ESLINT_PLUGIN], targetDefaults: { lint: { inputs: SPREAD } } });
    expect(buildLintInputsSpreadCheck(dir, [WEB, API]).status).toBe('pass');
  });

  it('turns the overall status to manual-review-required', () => {
    const dir = workspace(
      { plugins: [ESLINT_PLUGIN], targetDefaults: { lint: { inputs: SPREAD } } },
      { 'apps/api/project.json': JSON.stringify({ name: 'api', targets: { lint: { executor: '@nx/eslint:lint' } } }) },
    );
    expect(runDoctorChecks(dir, [WEB, API]).overallStatus).toBe('manual-review-required');
  });

  it('scans apps/ and libs/ when no project list is given', () => {
    const dir = workspace(
      { plugins: [ESLINT_PLUGIN], targetDefaults: { lint: { inputs: SPREAD } } },
      { 'libs/shared/project.json': JSON.stringify({ name: 'shared', targets: { lint: { executor: '@nx/eslint:lint' } } }) },
    );
    expect(buildLintInputsSpreadCheck(dir)).toMatchObject({ status: 'warning', evidence: ['shared'] });
  });

  it('an nx.json that cannot be read is reported, never thrown', () => {
    const dir = workspace({});
    writeFileSync(join(dir, 'nx.json'), '{ not json');
    expect(buildLintInputsSpreadCheck(dir, [WEB]).status).toBe('not-applicable');
    expect(buildLintCacheCheck(dir, [WEB]).status).toBe('not-applicable');
  });
});
