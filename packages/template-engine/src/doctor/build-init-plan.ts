import { createEmptyInitPlan, type DoctorReport, type InitPlan } from '@nx-archweave/shared';

export interface BuildInitPlanOptions {
  preset?: 'quick-start' | 'solo' | 'team';
  frontend?: 'react-vite' | 'next';
}

export function buildInitPlan(doctorReport: DoctorReport, options: BuildInitPlanOptions): InitPlan {
  const plan = createEmptyInitPlan();

  if (doctorReport.overallStatus === 'unsupported') {
    plan.warnings.push('workspace unsupported');
    return plan;
  }

  if (!options.preset) {
    plan.warnings.push('No preset specified — there is no default, an explicit preset is required');
    return plan;
  }

  const frontend = options.frontend ?? 'react-vite';
  const reviewMode = options.preset === 'team' ? 'standard' : 'fast';
  const prOnly = options.preset === 'quick-start';

  plan.commands.push(`nx g @clearlydev/nx-archweave:add-fsd-lite --frontend=${frontend}`);
  plan.commands.push(`nx g @clearlydev/nx-archweave:add-review --mode=${reviewMode}`);
  plan.commands.push(
    prOnly
      ? 'nx g @clearlydev/nx-archweave:add-github-templates --pr=true'
      : 'nx g @clearlydev/nx-archweave:add-github-templates --issue=true --pr=true --codeowners=true',
  );
  plan.commands.push('nx g @clearlydev/nx-archweave:add-agent-rules');

  const conflictPolicyByCheckId: Record<string, 'skip' | 'merge-proposal'> = {
    'existing-config': 'merge-proposal',
    'agent-rules-files': 'merge-proposal',
    'github-templates': 'skip',
  };

  for (const check of doctorReport.checks) {
    const resolution = conflictPolicyByCheckId[check.id];
    if (check.status === 'warning' && resolution) {
      for (const path of check.evidence) {
        plan.conflicts.push({ path, reason: check.message, resolution });
      }
    }
  }
  plan.requiresApproval = plan.conflicts.length > 0;

  return plan;
}
