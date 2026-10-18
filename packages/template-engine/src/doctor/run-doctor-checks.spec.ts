import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runDoctorChecks } from './run-doctor-checks.ts';
import { join } from 'node:path';

const FIXTURES = join(__dirname, '../../../../tools/fixtures/doctor');

describe('runDoctorChecks', () => {
  it('returns unsupported for a non-Nx repo, with the rest not-applicable', () => {
    const report = runDoctorChecks(join(FIXTURES, 'non-nx-repo'));
    expect(report.overallStatus).toBe('unsupported');
    const nxCheck = report.checks.find((c) => c.id === 'nx-workspace-detected');
    expect(nxCheck?.status).toBe('error');
    expect(report.checks.filter((c) => c.status === 'not-applicable').length).toBeGreaterThan(0);
  });

  it('returns safe for an empty Nx workspace', () => {
    const report = runDoctorChecks(join(FIXTURES, 'empty-nx-workspace'));
    expect(report.overallStatus).toBe('safe');
    expect(report.checks.find((c) => c.id === 'nx-workspace-detected')?.status).toBe('pass');
    expect(report.checks.find((c) => c.id === 'existing-config')?.status).toBe('pass');
    expect(report.checks.find((c) => c.id === 'review-workflow-present')?.status).toBe('not-applicable');
    expect(report.checks.find((c) => c.id === 'review-alt-file-coexistence')?.status).toBe('not-applicable');
    expect(report.checks.find((c) => c.id === 'review-config-consistency')?.status).toBe('not-applicable');
  });

  it('a workspace with existing config/rules/workflow: nx-archweave\'s own files are not a conflict', () => {
    const report = runDoctorChecks(join(FIXTURES, 'existing-config-workspace'));
    expect(report.checks.find((c) => c.id === 'existing-config')).toMatchObject({
      status: 'pass',
      message: expect.stringContaining('managed by nx-archweave'),
    });
    // existing CLAUDE.md / AGENTS.md are not a conflict: only our marked block is ever written
    expect(report.checks.find((c) => c.id === 'agent-rules-files')).toMatchObject({
      status: 'pass',
      message: expect.stringContaining('only its own marked block'),
    });
    // The fixture's claude-code-review.yml exists (content unrelated to the review
    // module) — review-workflow-present only checks presence, so it passes even
    // though toolkit.config.json ({"preset":"team"}) has no `review` field at all.
    expect(report.checks.find((c) => c.id === 'review-workflow-present')?.status).toBe('pass');
    expect(report.checks.find((c) => c.id === 'review-config-consistency')?.status).toBe('not-applicable');
  });

  it('never includes secret values in evidence or message', () => {
    const report = runDoctorChecks(join(FIXTURES, 'existing-config-workspace'));
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN=/);
  });

  it('does not crash on a malformed root package.json — reports affected checks as error instead', () => {
    expect(() => runDoctorChecks(join(FIXTURES, 'malformed-package-json'))).not.toThrow();
    const report = runDoctorChecks(join(FIXTURES, 'malformed-package-json'));
    expect(report.overallStatus).toBe('conflict');
    expect(report.checks.find((c) => c.id === 'nx-version')?.status).toBe('error');
    expect(report.checks.find((c) => c.id === 'framework-react-vite')?.status).toBe('error');
    expect(report.checks.find((c) => c.id === 'framework-next')?.status).toBe('error');
    // Checks that don't depend on package.json parsing keep working normally.
    expect(report.checks.find((c) => c.id === 'nx-workspace-detected')?.status).toBe('pass');
  });

  it('reports React+Vite as not-applicable when the dependency is only in a sub-package, not the root (root-only detection)', () => {
    const report = runDoctorChecks(join(FIXTURES, 'monorepo-subpackage-react-vite'));
    expect(report.checks.find((c) => c.id === 'framework-react-vite')?.status).toBe('not-applicable');
  });
});

describe('nx-version range judgment', () => {
  const mkWorkspace = (nxVersion?: string) => {
    const root = mkdtempSync(join(tmpdir(), 'nxver-'));
    writeFileSync(join(root, 'nx.json'), '{}\n');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify(nxVersion ? { devDependencies: { nx: nxVersion } } : {}, null, 2),
    );
    return root;
  };
  const nxCheck = (root: string) => runDoctorChecks(root).checks.find((c) => c.id === 'nx-version');

  it.each([
    ['23.2.0', 'pass'],
    ['^23.1.0', 'pass'],
    ['>=23 <24', 'pass'],
    ['22.9.1', 'warning'],
    ['24.0.0', 'warning'],
  ])('%s → %s', (version, status) => {
    const root = mkWorkspace(version);
    try {
      expect(nxCheck(root)?.status).toBe(status);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('below range says upgrade, above range says unvalidated', () => {
    const low = mkWorkspace('22.0.0');
    const high = mkWorkspace('24.1.0');
    try {
      expect(nxCheck(low)?.message).toContain('below');
      expect(nxCheck(high)?.message).toContain('above');
    } finally {
      rmSync(low, { recursive: true, force: true });
      rmSync(high, { recursive: true, force: true });
    }
  });

  it('a garbage version string degrades to warning, never throws', () => {
    const root = mkWorkspace('latest');
    try {
      expect(nxCheck(root)?.status).toBe('warning');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

it('a non-Nx repo reports fsd-like-structure as not-applicable too — the check set is mode-stable', () => {
  const report = runDoctorChecks(join(FIXTURES, 'non-nx-repo'));
  expect(report.checks.find((c) => c.id === 'fsd-like-structure')?.status).toBe('not-applicable');
});

describe('package-manager check', () => {
  const check = (files: string[]) => {
    const root = mkdtempSync(join(tmpdir(), 'pm-check-'));
    try {
      writeFileSync(join(root, 'nx.json'), '{}\n');
      for (const file of files) writeFileSync(join(root, file), '');
      return runDoctorChecks(root).checks.find((c) => c.id === 'package-manager');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it.each([
    ['bun.lock', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'],
  ])('%s passes as %s, with nothing to do', (lockfile, pm) => {
    const result = check([lockfile]);
    expect(result).toMatchObject({ status: 'pass', message: `${pm} detected` });
    expect(result?.suggestedAction).toBeUndefined();
  });

  it('no lockfile is a warning', () => {
    expect(check([])).toMatchObject({ status: 'warning', message: 'Unknown package manager' });
  });
});

describe('runDoctorChecks — a workspace init just set up has nothing to review', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'doctor-managed-'));
    writeFileSync(join(root, 'nx.json'), '{}');
    writeFileSync(join(root, 'package.json'), '{"devDependencies":{"nx":"23.2.0"}}');
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const status = (id: string) => runDoctorChecks(root).checks.find((c) => c.id === id)?.status;

  it('existing templates warn before init (ours would be skipped) and pass once toolkit-managed', () => {
    mkdirSync(join(root, '.github'));
    writeFileSync(join(root, '.github', 'PULL_REQUEST_TEMPLATE.md'), '# PR');
    expect(status('github-templates')).toBe('warning');
    writeFileSync(join(root, 'toolkit.config.json'), '{}');
    expect(status('github-templates')).toBe('pass');
  });

  it('the integration manifest is nx-archweave\'s own record: never a warning', () => {
    writeFileSync(join(root, 'archweave-integrations.json'), '{"integrations":{}}');
    expect(status('integration-manifest')).toBe('pass');
  });
});
