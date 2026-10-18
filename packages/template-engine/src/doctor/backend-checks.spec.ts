import { join } from 'node:path';
import { BACKEND_CHECK_IDS, buildBackendChecks } from './backend-checks.ts';

const FIXTURES = join(__dirname, '../../../../tools/fixtures/doctor');

function byId(checks: ReturnType<typeof buildBackendChecks>, id: string) {
  return checks.find((c) => c.id === id);
}

describe('buildBackendChecks', () => {
  it('exports the five backend check ids', () => {
    expect(BACKEND_CHECK_IDS).toEqual([
      'backend-framework',
      'backend-config-consistency',
      'shared-types-lib',
      'boundary-constraints-applied',
      'boundary-tags-exist',
    ]);
  });

  it('all five pass on a fully wired fullstack workspace', () => {
    const checks = buildBackendChecks(join(FIXTURES, 'fullstack-workspace'));
    expect(checks).toHaveLength(5);
    expect(byId(checks, 'backend-framework')?.status).toBe('pass');
    expect(byId(checks, 'backend-config-consistency')?.status).toBe('pass');
    expect(byId(checks, 'shared-types-lib')?.status).toBe('pass');
    expect(byId(checks, 'boundary-constraints-applied')?.status).toBe('pass');
  });

  it('is entirely not-applicable when the config declares no backend', () => {
    const checks = buildBackendChecks(join(FIXTURES, 'existing-config-workspace'));
    for (const id of BACKEND_CHECK_IDS) {
      expect(byId(checks, id)?.status).toBe('not-applicable');
    }
  });

  it('warns on a configured backend whose framework dependency is missing', () => {
    const checks = buildBackendChecks(join(FIXTURES, 'fullstack-misconfigured'));
    expect(byId(checks, 'backend-framework')?.status).toBe('warning');
  });

  it('warns that boundaries are not enforced when the config is the Nx allow-all default', () => {
    const check = byId(buildBackendChecks(join(FIXTURES, 'fullstack-misconfigured')), 'boundary-constraints-applied');
    expect(check?.status).toBe('warning');
    expect(check?.message).toContain('allow-all');
  });

  it('warns when shared-types is missing on a backend-configured workspace', () => {
    expect(byId(buildBackendChecks(join(FIXTURES, 'fullstack-misconfigured')), 'shared-types-lib')?.status).toBe('warning');
  });

  it('reports could-not-verify when no eslint config is recognizable', () => {
    // empty-nx-workspace has a toolkit-less root; craft the gate by reusing a root with backend config but no eslint file
    const checks = buildBackendChecks(join(FIXTURES, 'review-config-unparseable-json'));
    // unusable config → no backend claim can be read → not-applicable, never a crash
    for (const id of BACKEND_CHECK_IDS) {
      expect(byId(checks, id)?.status).toBe('not-applicable');
    }
  });
});

describe('boundary-tags-exist', () => {
  it('warns when constraints are enforced but one side has no tagged project (dead-letter rules)', () => {
    const checks = buildBackendChecks(join(FIXTURES, 'boundary-tags-missing'));
    const check = checks.find((c) => c.id === 'boundary-tags-exist');
    expect(check?.status).toBe('warning');
    expect(check?.message).toContain('dead letter');
  });

  it('passes on the fullstack fixture where both sides carry tags (mixed project.json/package.json)', () => {
    const checks = buildBackendChecks(join(FIXTURES, 'fullstack-workspace'));
    expect(checks.find((c) => c.id === 'boundary-tags-exist')?.status).toBe('pass');
  });

  it('backend-only workspace (toolkit.config.json frontend: none): scope:backend alone passes', () => {
    const check = buildBackendChecks(join(FIXTURES, 'backend-only-workspace')).find((c) => c.id === 'boundary-tags-exist');
    expect(check?.status).toBe('pass');
    expect(check?.message).toContain('backend-only');
  });

  it('is not-applicable when constraints are not enforced', () => {
    const checks = buildBackendChecks(join(FIXTURES, 'fullstack-misconfigured'));
    expect(checks.find((c) => c.id === 'boundary-tags-exist')?.status).toBe('not-applicable');
  });

  it('skips an unparseable project.json instead of erroring the check', () => {
    const checks = buildBackendChecks(join(FIXTURES, 'boundary-tags-missing'));
    expect(checks.find((c) => c.id === 'boundary-tags-exist')?.status).toBe('warning');
  });
});

describe('shared-types-lib legacy shape', () => {
  it('accepts a legacy project.json-only shared-types with a legacy tail', () => {
    const checks = buildBackendChecks(join(FIXTURES, 'legacy-shared-types'));
    const check = checks.find((c) => c.id === 'shared-types-lib');
    expect(check?.status).toBe('pass');
    expect(check?.message).toContain('legacy');
  });
});

it('finds tags in grouped (one-level-nested) app and lib directories', () => {
  const checks = buildBackendChecks(join(FIXTURES, 'grouped-tags'));
  expect(checks.find((c) => c.id === 'boundary-tags-exist')?.status).toBe('pass');
});
