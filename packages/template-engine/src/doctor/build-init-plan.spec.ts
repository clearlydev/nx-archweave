import { buildInitPlan } from './build-init-plan.ts';
import type { DoctorReport } from '@nx-archweave/shared';

describe('buildInitPlan', () => {
  it('returns an empty plan with a warning when the workspace is unsupported', () => {
    const report: DoctorReport = { checks: [], overallStatus: 'unsupported' };
    const plan = buildInitPlan(report, {});
    expect(plan.commands).toEqual([]);
    expect(plan.filesToCreate).toEqual([]);
    expect(plan.warnings).toContain('workspace unsupported');
  });

  it('adds a warning when no preset is specified, without assuming a default', () => {
    const report: DoctorReport = { checks: [], overallStatus: 'safe' };
    const plan = buildInitPlan(report, {});
    expect(plan.warnings).toContain('No preset specified — there is no default, an explicit preset is required');
    expect(plan.commands).toEqual([]);
  });

  it('lists all 4 generator commands for quick-start (fsd + review fast + minimal templates + agent-rules)', () => {
    const report: DoctorReport = { checks: [], overallStatus: 'safe' };
    const plan = buildInitPlan(report, { preset: 'quick-start', frontend: 'react-vite' });
    expect(plan.commands).toEqual([
      'nx g @clearlydev/nx-archweave:add-fsd-lite --frontend=react-vite',
      'nx g @clearlydev/nx-archweave:add-review --mode=fast',
      'nx g @clearlydev/nx-archweave:add-github-templates --pr=true',
      'nx g @clearlydev/nx-archweave:add-agent-rules',
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it('lists standard-mode review for team preset', () => {
    const report: DoctorReport = { checks: [], overallStatus: 'safe' };
    const plan = buildInitPlan(report, { preset: 'team', frontend: 'next' });
    expect(plan.commands).toContain('nx g @clearlydev/nx-archweave:add-review --mode=standard');
    expect(plan.commands).toContain('nx g @clearlydev/nx-archweave:add-fsd-lite --frontend=next');
  });

  it('maps warning checks to conflicts with the right resolution and sets requiresApproval', () => {
    const report: DoctorReport = {
      overallStatus: 'manual-review-required',
      checks: [
        {
          id: 'existing-config',
          label: 'x',
          status: 'warning',
          message: 'toolkit.config.json already exists',
          evidence: ['toolkit.config.json'],
        },
        {
          id: 'github-templates',
          label: 'x',
          status: 'warning',
          message: '.github/ISSUE_TEMPLATE already exists',
          evidence: ['.github/ISSUE_TEMPLATE'],
        },
      ],
    };
    const plan = buildInitPlan(report, { preset: 'solo' });
    expect(plan.conflicts).toEqual([
      { path: 'toolkit.config.json', reason: 'toolkit.config.json already exists', resolution: 'merge-proposal' },
      { path: '.github/ISSUE_TEMPLATE', reason: '.github/ISSUE_TEMPLATE already exists', resolution: 'skip' },
    ]);
    expect(plan.requiresApproval).toBe(true);
  });

  it('maps every evidence path to its own conflict when a check has more than one (e.g. both CLAUDE.md and AGENTS.md exist)', () => {
    const report: DoctorReport = {
      overallStatus: 'manual-review-required',
      checks: [
        {
          id: 'agent-rules-files',
          label: 'x',
          status: 'warning',
          message: 'Existing agent rules file(s) found',
          evidence: ['CLAUDE.md', 'AGENTS.md'],
        },
      ],
    };
    const plan = buildInitPlan(report, { preset: 'solo' });
    expect(plan.conflicts).toEqual([
      { path: 'CLAUDE.md', reason: 'Existing agent rules file(s) found', resolution: 'merge-proposal' },
      { path: 'AGENTS.md', reason: 'Existing agent rules file(s) found', resolution: 'merge-proposal' },
    ]);
  });

  it('is deterministic: calling twice with the same report and options gives a deep-equal plan', () => {
    const report: DoctorReport = {
      overallStatus: 'safe',
      checks: [
        {
          id: 'agent-rules-files',
          label: 'x',
          status: 'warning',
          message: 'Existing agent rules file(s) found',
          evidence: ['CLAUDE.md'],
        },
      ],
    };
    const first = buildInitPlan(report, { preset: 'team', frontend: 'next' });
    const second = buildInitPlan(report, { preset: 'team', frontend: 'next' });
    expect(first).toEqual(second);
  });
});
