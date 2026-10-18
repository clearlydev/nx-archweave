import { buildIntegrationDoctorChecks } from './integration-doctor-checks.ts';
import type { IntegrationDriftResult } from './detect-drift.ts';

function result(overrides: Partial<IntegrationDriftResult>): IntegrationDriftResult {
  return { id: 'ponytail', status: 'not-installed', reason: 'test reason', ...overrides };
}

describe('buildIntegrationDoctorChecks', () => {
  it('maps not-installed to not-applicable', () => {
    const [check] = buildIntegrationDoctorChecks([result({ status: 'not-installed' })]);
    expect(check.status).toBe('not-applicable');
    expect(check.id).toBe('integration-ponytail');
  });

  it('maps externally-installed (no record at all) to warning', () => {
    const [check] = buildIntegrationDoctorChecks([
      result({ status: 'externally-installed', source: undefined, reason: 'installed outside nx-archweave' }),
    ]);
    expect(check.status).toBe('warning');
  });

  it('maps undeclared-leftover (manifest entry remains) to warning', () => {
    const [check] = buildIntegrationDoctorChecks([
      result({ status: 'undeclared-leftover', source: 'DietrichGebert/ponytail', verification: 'passed' }),
    ]);
    expect(check.status).toBe('warning');
  });

  it('maps declared-missing to warning', () => {
    const [check] = buildIntegrationDoctorChecks([
      result({ status: 'declared-missing', source: undefined }),
    ]);
    expect(check.status).toBe('warning');
  });

  it('maps verification-failed to error', () => {
    const [check] = buildIntegrationDoctorChecks([
      result({ status: 'verification-failed', source: 'DietrichGebert/ponytail', verification: 'failed' }),
    ]);
    expect(check.status).toBe('error');
  });

  it('maps configured to pass', () => {
    const [check] = buildIntegrationDoctorChecks([
      result({ status: 'configured', source: 'DietrichGebert/ponytail', verification: 'passed' }),
    ]);
    expect(check.status).toBe('pass');
  });

  it('uses the drift result reason as the check message, verbatim', () => {
    const [check] = buildIntegrationDoctorChecks([result({ status: 'not-installed', reason: 'exact reason text' })]);
    expect(check.message).toBe('exact reason text');
  });

  it('never includes an absolute path or a secret-looking value in evidence', () => {
    const [check] = buildIntegrationDoctorChecks([
      result({ status: 'configured', source: 'DietrichGebert/ponytail', verification: 'passed' }),
    ]);
    const serialized = JSON.stringify(check.evidence);
    expect(serialized).not.toMatch(/\/Users\/|\/home\/|^\/|TOKEN|SECRET/i);
  });
});

describe('drift state → doctor status mapping', () => {
  const toCheck = (r: IntegrationDriftResult) => buildIntegrationDoctorChecks([r])[0];

  it.each([
    ['declared-missing', 'warning'],
    ['undeclared-leftover', 'warning'],
    ['externally-installed', 'warning'],
    ['verification-failed', 'error'],
    ['configured', 'pass'],
    ['not-installed', 'not-applicable'],
  ] as const)('%s → %s', (status, expected) => {
    const check = toCheck({ id: 'p', status, reason: 'r', suggestedAction: 'act' });
    expect(check.status).toBe(expected);
    if (expected !== 'not-applicable') expect(check.suggestedAction).toBe('act');
  });
});
