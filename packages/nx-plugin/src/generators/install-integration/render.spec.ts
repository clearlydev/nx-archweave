import { renderInstallIntegrationView, type InstallIntegrationView } from './render.ts';

const RERUN = 'pnpm nx g @clearlydev/nx-archweave:install-integration --tool=ponytail --apply';

function view(overrides: Partial<InstallIntegrationView> = {}): InstallIntegrationView {
  return {
    tool: 'ponytail',
    target: 'claude-code',
    scope: 'user',
    preview: true,
    applyIgnoredForNxDryRun: false,
    sourceRepository: 'https://github.com/DietrichGebert/ponytail',
    officialHomepage: 'https://ponytail.dev',
    license: 'MIT',
    requestedVersion: null,
    workspaceFiles: [],
    command: 'claude plugin install ponytail --marketplace DietrichGebert/ponytail --scope user',
    rerunCommand: RERUN,
    currentState: { kind: 'absent' },
    install: null,
    record: null,
    declaration: null,
    teamMarketplace: null,
    guidance: [],
    ...overrides,
  };
}

const RECORDED = {
  verification: { verified: true, resolvedVersion: '4.8.4', problems: [] },
  proposedEntry: { source: 'DietrichGebert/ponytail', repository: 'r', method: 'm', managedBy: 'nx-archweave' as const, verification: 'passed' as const },
  existingEntry: undefined,
  hasConflict: false,
  wasWritten: true,
};

describe('renderInstallIntegrationView', () => {
  it('preview: names source, license, version policy and command, says what (did not) run, and how to apply', () => {
    const out = renderInstallIntegrationView(view());
    expect(out).toContain('Source repository: https://github.com/DietrichGebert/ponytail');
    expect(out).toContain('License: MIT');
    expect(out).toContain('decided by the marketplace');
    expect(out).toContain('claude plugin install ponytail --marketplace DietrichGebert/ponytail --scope user');
    expect(out).toContain(`To run it: ${RERUN}`);
    expect(out).toMatch(/preview/i);
    expect(out).not.toMatch(/Recorded/);
  });

  it('a requested version is shown as not enforced', () => {
    expect(renderInstallIntegrationView(view({ requestedVersion: '4.7.0' }))).toMatch(/Requested version: 4\.7\.0 .*not enforced/);
  });

  it('workspace files Claude Code will change are listed', () => {
    expect(renderInstallIntegrationView(view({ workspaceFiles: ['.claude/settings.json'] }))).toContain('.claude/settings.json');
  });

  it('executed + recorded + declared: every outcome is stated separately', () => {
    const out = renderInstallIntegrationView(
      view({ preview: false, install: { detail: { kind: 'executed' }, manualStepsRemaining: [] }, record: RECORDED, declaration: { action: 'updated' } }),
    );
    expect(out).toContain('Recorded');
    expect(out).toContain('toolkit.config.json');
    expect(out).toMatch(/applied/i);
  });

  it('a non-success install that a fresh check shows installed says so explicitly', () => {
    const out = renderInstallIntegrationView(view({ preview: false, install: { detail: { kind: 'timeout' }, manualStepsRemaining: [] }, record: RECORDED }));
    expect(out).toMatch(/reported.*timeout.*fresh check/is);
  });

  it.each([
    ['no-config', /no toolkit\.config\.json/],
    ['unrecognized', /not updated/],
    ['unchanged', /already declared/],
  ] as const)('declaration %s is explained', (action, pattern) => {
    expect(renderInstallIntegrationView(view({ preview: false, record: RECORDED, declaration: { action } }))).toMatch(pattern);
  });

  it('a failed declaration write is explained with its reason', () => {
    const out = renderInstallIntegrationView(view({ preview: false, record: RECORDED, declaration: { action: 'write-failed', message: 'EACCES' } }));
    expect(out).toContain('EACCES');
    expect(out).toMatch(/not updated/);
  });

  it('guidance lines are printed verbatim, in order', () => {
    const out = renderInstallIntegrationView(view({ preview: false, guidance: ['first', 'second'] }));
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'));
  });

  it('notes when --apply was ignored because of Nx --dry-run', () => {
    expect(renderInstallIntegrationView(view({ applyIgnoredForNxDryRun: true }))).toMatch(/--apply was ignored/);
  });

  it('is deterministic', () => {
    const input = view();
    expect(renderInstallIntegrationView(input)).toBe(renderInstallIntegrationView(input));
  });
});

describe('renderInstallIntegrationView — the project-scope marketplace declaration', () => {
  const TEAM = 'claude plugin marketplace add DietrichGebert/ponytail --scope project';

  it('preview of an already-installed project plugin names the backfill it would run', () => {
    const text = renderInstallIntegrationView(
      view({ scope: 'project', currentState: { kind: 'already-installed', scope: 'project' }, teamMarketplace: { command: TEAM, detail: null } }),
    );
    expect(text).toContain(`Would run: ${TEAM}`);
  });

  it('a timed-out declaration says so', () => {
    const text = renderInstallIntegrationView(view({ preview: false, teamMarketplace: { command: TEAM, detail: { kind: 'timeout' } } }));
    expect(text).toContain('Marketplace declaration: stopped — the command timed out');
  });
});
