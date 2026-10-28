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
    ['24.0.1', 'pass'],
    ['^24.0.0', 'pass'],
    ['22.9.1', 'warning'],
    ['25.0.0', 'warning'],
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
    const high = mkWorkspace('25.1.0');
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

describe('runDoctorChecks — reads the projects it is given, not fixed paths', () => {
  function workspace(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-ws-'));
    writeFileSync(join(dir, 'nx.json'), '{}');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'ws', devDependencies: { nx: '23.1.0' } }));
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
    return dir;
  }
  const WEB = { name: 'web', root: 'web', sourceRoot: 'web', tags: ['scope:frontend'] };
  const API = { name: 'api', root: 'api', sourceRoot: 'api/src', tags: ['scope:backend'] };

  it('counts FSD layers in a root-level app whose source root is the app itself', () => {
    const dir = workspace({ 'web/features/a/index.ts': '', 'web/app/page.tsx': '' });
    try {
      expect(runDoctorChecks(dir, [WEB]).checks.find((c) => c.id === 'fsd-like-structure')).toMatchObject({ status: 'warning', evidence: ['web/app', 'web/features'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds the boundary tags on root-level projects', () => {
    const dir = workspace({
      'toolkit.config.json': JSON.stringify({ backend: 'express' }),
      'eslint.config.mjs': "export default [{ rules: { '@nx/enforce-module-boundaries': ['error', { depConstraints: [{ sourceTag: 'scope:frontend', onlyDependOnLibsWithTags: ['scope:frontend', 'scope:shared'] }, { sourceTag: 'scope:backend', onlyDependOnLibsWithTags: ['scope:backend', 'scope:shared'] }] }] } }];\n",
    });
    try {
      const check = runDoctorChecks(dir, [WEB, API]).checks.find((c) => c.id === 'boundary-tags-exist');
      expect(check?.status).not.toBe('warning');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns when the FSD rule is wired without cwd (an editor or a root-level eslint would check nothing)", () => {
    const dir = workspace({
      'toolkit.config.json': JSON.stringify({ frontend: 'next' }),
      'web/eslint.config.mjs': "import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';\nexport default [...fsdBoundaries({ severity: 'warn' })];\n",
    });
    try {
      const checks = runDoctorChecks(dir, [WEB]).checks;
      expect(checks.find((c) => c.id === 'fsd-enforcement-applied')).toMatchObject({ status: 'pass', evidence: ['web/eslint.config.mjs'] });
      expect(checks.find((c) => c.id === 'fsd-rule-anchored')).toMatchObject({ status: 'warning', evidence: ['web/eslint.config.mjs'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runDoctorChecks — review workflows', () => {
  function workspace(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-review-'));
    writeFileSync(join(dir, 'nx.json'), '{}');
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
    return dir;
  }
  const MARKER = '<!-- archweave-review-round -->';

  it('a workflow without the review marker is the user\'s own, and says so', () => {
    const dir = workspace({ 'package.json': '{}', '.github/workflows/claude-code-review.yml': 'name: our review\n' });
    try {
      expect(runDoctorChecks(dir).checks.find((c) => c.id === 'review-workflow-present')?.message).toContain('not generated by nx-archweave');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('two providers\' nx-archweave workflows both run on every PR — warns', () => {
    const dir = workspace({
      'package.json': '{}',
      '.github/workflows/claude-code-review.yml': `x ${MARKER}\n`,
      '.github/workflows/gpt-code-review.yml': `x ${MARKER}\n`,
    });
    try {
      expect(runDoctorChecks(dir).checks.find((c) => c.id === 'review-workflow-providers')).toMatchObject({ status: 'warning', evidence: ['.github/workflows/claude-code-review.yml', '.github/workflows/gpt-code-review.yml'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a pinned pnpm version next to a packageManager field fails action-setup — warns', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ packageManager: 'pnpm@10.12.1' }),
      '.github/workflows/claude-code-review.yml': `x ${MARKER}\n      - uses: pnpm/action-setup@v4\n        with:\n          version: 10\n`,
    });
    try {
      expect(runDoctorChecks(dir).checks.find((c) => c.id === 'review-workflow-pnpm')).toMatchObject({ status: 'warning' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runDoctorChecks — a workspace with its own boundary tags', () => {
  it('judges the constraints and the tags by boundaries.tags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-tags-'));
    try {
      const files: Record<string, string> = {
        'nx.json': '{}',
        'package.json': '{}',
        'toolkit.config.json': JSON.stringify({ backend: 'nest', boundaries: { tags: { frontend: 'type:web', backend: 'type:api', shared: 'type:shared' } } }),
        'eslint.config.mjs': "export default [{ rules: { x: ['error', { depConstraints: [{ sourceTag: 'type:web', notDependOnLibsWithTags: ['type:api'] }] }] } }];\n",
      };
      for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
      const projects = [
        { name: 'web', root: 'web', sourceRoot: 'web/src', tags: ['type:web'] },
        { name: 'api', root: 'api', sourceRoot: 'api/src', tags: ['type:api'] },
      ];
      const checks = runDoctorChecks(dir, projects).checks;
      expect(checks.find((c) => c.id === 'boundary-constraints-applied')?.status).toBe('pass');
      expect(checks.find((c) => c.id === 'boundary-tags-exist')).toMatchObject({ status: 'pass', message: expect.stringContaining('type:web') });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('nx-version against the nx majors the plugin\'s @nx/devkit supports', () => {
  const support = (installedVersion: string | undefined, inRange: boolean | undefined) => ({
    devkitVersion: '23.3.1',
    supportedMajors: { min: 22, max: 24 },
    installedVersion,
    inRange,
  });
  const withWorkspace = (declared: string, run: (root: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'nxsupport-'));
    writeFileSync(join(root, 'nx.json'), '{}\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { nx: declared } }));
    try {
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it('an installed nx outside them is an error that names both versions, the majors and the way out', () => {
    withWorkspace('25.0.0', (root) => {
      const report = runDoctorChecks(root, undefined, support('25.0.0', false));
      const check = report.checks.find((c) => c.id === 'nx-version');
      expect(check?.status).toBe('error');
      expect(check?.message).toContain('Nx 25.0.0 is installed, outside the majors');
      expect(check?.message).toContain('@nx/devkit 23.3.1');
      expect(check?.message).toContain('nx 22.x–24.x');
      expect(check?.suggestedAction).toContain('built for Nx 25.x');
      expect(report.overallStatus).not.toBe('safe');
    });
  });

  it('inside them, the validated-major judgment still applies (nx 22: a warning, not an error)', () => {
    withWorkspace('22.6.0', (root) => {
      const check = runDoctorChecks(root, undefined, support('22.6.0', true)).checks.find((c) => c.id === 'nx-version');
      expect(check?.status).toBe('warning');
      expect(check?.message).toContain('below the toolkit-validated range (23.x–24.x)');
    });
  });

  it('nx not installed yet, or no support info: the declared version alone decides', () => {
    withWorkspace('23.3.0', (root) => {
      expect(runDoctorChecks(root, undefined, support(undefined, undefined)).checks.find((c) => c.id === 'nx-version')?.status).toBe('pass');
      expect(runDoctorChecks(root).checks.find((c) => c.id === 'nx-version')?.status).toBe('pass');
    });
  });
});
