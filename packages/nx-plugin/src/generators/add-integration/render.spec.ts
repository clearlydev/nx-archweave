import { renderIntegrationPlan } from './render.ts';
import type { IntegrationPlanView } from './render.ts';

function view(overrides: Partial<IntegrationPlanView> = {}): IntegrationPlanView {
  return {
    tool: 'ponytail',
    plan: {
      officialCommand: { executable: 'claude', args: ['plugin', 'install', 'ponytail', '--marketplace', 'DietrichGebert/ponytail', '--scope', 'project', '--json'] },
      resolvedVersion: '4.8.4',
      filesCreated: [],
      filesModified: [],
      conflicts: [],
      sourceRepository: 'https://github.com/DietrichGebert/ponytail',
      officialHomepage: 'https://ponytail.dev',
      license: 'MIT',
      requiresManualExecution: false,
    },
    detection: { installed: false, managedBy: 'unknown', evidence: [] },
    verification: { verified: false, problems: ['not found'] },
    scope: 'project',
    scopeExplicit: false,
    teamMarketplaceCommand: null,
    runNx: 'pnpm nx',
    manualSteps: ['step one', 'step two'],
    uninstallSteps: ['uninstall step one'],
    manifestWritable: false,
    ...overrides,
  };
}

describe('renderIntegrationPlan', () => {
  it('includes source repository, license, and resolved version', () => {
    const output = renderIntegrationPlan(view());
    expect(output).toContain('https://github.com/DietrichGebert/ponytail');
    expect(output).toContain('MIT');
    expect(output).toContain('4.8.4');
  });

  it('always shows the manual (chat) alternative, scriptable command or not', () => {
    const output = renderIntegrationPlan(view());
    expect(output).toContain('step one');
    expect(output).toContain('step two');
    const manualOnly = renderIntegrationPlan(view({ plan: { ...view().plan, officialCommand: null, requiresManualExecution: true } }));
    expect(manualOnly).toContain('step one');
    expect(manualOnly).toContain('manual (no scriptable command for this target)');
  });

  it('shows the official command as a person would type it and points at install-integration to run it', () => {
    const output = renderIntegrationPlan(view());
    expect(output).toContain('claude plugin install ponytail --marketplace DietrichGebert/ponytail --scope project');
    expect(output).not.toContain('--json');
    expect(output).toContain('install-integration --tool=ponytail --apply');
  });

  it('carries an explicit --scope into the hint from the view, not by parsing args', () => {
    expect(renderIntegrationPlan(view({ scope: 'user', scopeExplicit: true }))).toContain('install-integration --tool=ponytail --apply --scope=user');
    // the default scope stays out of the hint: an explicit --scope makes install-integration strict
    // about an install at another scope, so a plain preview must not add one
    expect(renderIntegrationPlan(view())).toMatch(/install-integration --tool=ponytail --apply$/m);
  });

  it('names where recording happens instead of calling it unsupported', () => {
    const output = renderIntegrationPlan(view());
    expect(output).not.toContain('not supported in this milestone');
    expect(output).toContain('record-integration');
  });

  it('shows uninstall instructions', () => {
    const output = renderIntegrationPlan(view());
    expect(output).toContain('uninstall step one');
  });

  it('states the manifest was not written', () => {
    const output = renderIntegrationPlan(view());
    expect(output.toLowerCase()).toContain('manifest');
    expect(output.toLowerCase()).toContain('not');
  });

  it('reports current verification problems', () => {
    const output = renderIntegrationPlan(view());
    expect(output).toContain('not found');
  });

  it('produces byte-identical output for identical input (determinism)', () => {
    const input = view();
    expect(renderIntegrationPlan(input)).toBe(renderIntegrationPlan(input));
  });
});

it('project scope names the marketplace declaration install-integration runs first', () => {
  const team = 'claude plugin marketplace add DietrichGebert/ponytail --scope project';
  expect(renderIntegrationPlan(view({ scope: 'project', teamMarketplaceCommand: team }))).toContain(
    `For teammates (project scope), install-integration first declares the marketplace in .claude/settings.json: ${team}`,
  );
  expect(renderIntegrationPlan(view({ scope: 'user' }))).not.toContain('For teammates');
});

it("the install-integration hint runs the workspace's own nx", () => {
  expect(renderIntegrationPlan(view({ runNx: 'npm exec nx --' }))).toContain(
    'Run it for you (verifies and records afterwards): npm exec nx -- g @clearlydev/nx-archweave:install-integration --tool=ponytail --apply',
  );
});
