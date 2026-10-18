import { buildDoctorReportWithIntegrations } from './integration-report.ts';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createFakeCommandRunner } from '@nx-archweave/integrations';
import { createIntegrationsCompositionRoot } from '../../runtime/integrations-composition-root.ts';

const FIXTURES = join(__dirname, '../../../../../tools/fixtures/doctor');

const ENABLED_MATCH_JSON = JSON.stringify([
  { id: 'ponytail@ponytail', version: '4.8.4', scope: 'user', enabled: true },
]);
const DISABLED_MATCH_JSON = JSON.stringify([
  { id: 'ponytail@ponytail', version: '4.8.4', scope: 'user', enabled: false },
]);

describe('buildDoctorReportWithIntegrations', () => {
  it('reports not-applicable when nothing is declared, recorded, or detected', async () => {
    const report = await buildDoctorReportWithIntegrations(join(FIXTURES, 'empty-nx-workspace'));
    const check = report.checks.find((c) => c.id === 'integration-ponytail');
    expect(check?.status).toBe('not-applicable');
  });

  it('reports warning when declared but manifest is missing', async () => {
    const report = await buildDoctorReportWithIntegrations(join(FIXTURES, 'integration-declared-not-installed'));
    expect(report.checks.find((c) => c.id === 'integration-ponytail')?.status).toBe('warning');
  });

  it('reports warning when installed/recorded but not declared', async () => {
    const report = await buildDoctorReportWithIntegrations(join(FIXTURES, 'integration-installed-not-declared'));
    expect(report.checks.find((c) => c.id === 'integration-ponytail')?.status).toBe('warning');
  });

  it('reports error when declared, recorded, and verification failed', async () => {
    const report = await buildDoctorReportWithIntegrations(join(FIXTURES, 'integration-verification-failed'));
    expect(report.checks.find((c) => c.id === 'integration-ponytail')?.status).toBe('error');
    expect(report.overallStatus).toBe('conflict');
  });

  it('reports warning when detected outside Archweave management', async () => {
    const report = await buildDoctorReportWithIntegrations(join(FIXTURES, 'integration-detected-outside-management'));
    expect(report.checks.find((c) => c.id === 'integration-ponytail')?.status).toBe('warning');
  });

  it('reports pass when declared, recorded, and verified', async () => {
    const report = await buildDoctorReportWithIntegrations(join(FIXTURES, 'integration-aligned-verified'));
    expect(report.checks.find((c) => c.id === 'integration-ponytail')?.status).toBe('pass');
  });

  it('still includes every base doctor check unchanged', async () => {
    const report = await buildDoctorReportWithIntegrations(join(FIXTURES, 'empty-nx-workspace'));
    expect(report.checks.find((c) => c.id === 'nx-workspace-detected')?.status).toBe('pass');
  });

  it('produces an identical report for two consecutive calls against the same fixture', async () => {
    const first = await buildDoctorReportWithIntegrations(join(FIXTURES, 'integration-aligned-verified'));
    const second = await buildDoctorReportWithIntegrations(join(FIXTURES, 'integration-aligned-verified'));
    expect(first).toEqual(second);
  });

  it('never leaks a secret-looking value or an absolute home path in the integration checks', async () => {
    const report = await buildDoctorReportWithIntegrations(join(FIXTURES, 'integration-aligned-verified'));
    const serialized = JSON.stringify(report.checks.filter((c) => c.id.startsWith('integration-')));
    expect(serialized).not.toMatch(/\/Users\/|\/home\/|CLAUDE_CODE_OAUTH_TOKEN=/);
  });
});

describe('buildDoctorReportWithIntegrations — --live-integrations', () => {
  it('never invokes the runner when liveIntegrations is not set (default)', async () => {
    const throwingRunner = {
      run: () => {
        throw new Error('runner must not be invoked without --live-integrations');
      },
    };
    const integrationsRoot = createIntegrationsCompositionRoot({ runner: throwingRunner });
    await expect(
      buildDoctorReportWithIntegrations(
        join(FIXTURES, 'integration-aligned-verified'),
        { liveIntegrations: false },
        { integrationsRoot },
      ),
    ).resolves.toBeDefined();
  });

  it('reports pass when live verification succeeds for an aligned, declared, recorded integration', async () => {
    const integrationsRoot = createIntegrationsCompositionRoot({
      runner: createFakeCommandRunner({ stdout: ENABLED_MATCH_JSON }),
    });
    const report = await buildDoctorReportWithIntegrations(
      join(FIXTURES, 'integration-aligned-verified'),
      { liveIntegrations: true },
      { integrationsRoot },
    );
    expect(report.checks.find((c) => c.id === 'integration-ponytail')?.status).toBe('pass');
  });

  it('never reports pass for a live-disabled plugin, even when the recorded manifest still says passed', async () => {
    const integrationsRoot = createIntegrationsCompositionRoot({
      runner: createFakeCommandRunner({ stdout: DISABLED_MATCH_JSON }),
    });
    const report = await buildDoctorReportWithIntegrations(
      join(FIXTURES, 'integration-aligned-verified'), // recorded manifest says verification: 'passed'
      { liveIntegrations: true },
      { integrationsRoot },
    );
    const check = report.checks.find((c) => c.id === 'integration-ponytail');
    // Declared + a manifest entry exists + live verification currently fails
    // -> the existing 'error' case (case 3), never silently kept as 'pass'.
    expect(check?.status).toBe('error');
  });

  it('reports a live CLI failure clearly rather than silently trusting the recorded state', async () => {
    const integrationsRoot = createIntegrationsCompositionRoot({
      runner: createFakeCommandRunner({ stdout: '', exitCode: 1 }),
    });
    const report = await buildDoctorReportWithIntegrations(
      join(FIXTURES, 'integration-aligned-verified'),
      { liveIntegrations: true },
      { integrationsRoot },
    );
    const check = report.checks.find((c) => c.id === 'integration-ponytail');
    expect(check?.status).toBe('error');
  });

  it('does not write the manifest or config, and does not repair drift, in live mode', async () => {
    const fixtureDir = join(FIXTURES, 'integration-aligned-verified');
    const manifestPath = join(fixtureDir, 'archweave-integrations.json');
    const configPath = join(fixtureDir, 'toolkit.config.json');
    const manifestBefore = readFileSync(manifestPath, 'utf8');
    const configBefore = readFileSync(configPath, 'utf8');

    const integrationsRoot = createIntegrationsCompositionRoot({
      runner: createFakeCommandRunner({ stdout: DISABLED_MATCH_JSON }),
    });
    await buildDoctorReportWithIntegrations(fixtureDir, { liveIntegrations: true }, { integrationsRoot });

    expect(readFileSync(manifestPath, 'utf8')).toBe(manifestBefore);
    expect(readFileSync(configPath, 'utf8')).toBe(configBefore);
  });
});
