import { renderUserCommand, type InstallPlan, type DetectionResult, type VerificationResult } from '@nx-archweave/integrations';

export interface IntegrationPlanView {
  tool: string;
  /** The Claude Code scope the previewed command uses, carried explicitly (not parsed back out of args). */
  scope: 'user' | 'project' | 'local';
  /** The user passed --scope. Only then does the install-integration hint carry it — an
   * explicit scope makes install-integration strict about an install at another scope. */
  scopeExplicit: boolean;
  /** The workspace's own nx (`pnpm nx`, `npm exec nx --`, …) for the printed command. */
  runNx: string;
  /** Project scope: the command install-integration runs first to declare the marketplace
   * in the workspace's .claude/settings.json; null otherwise. */
  teamMarketplaceCommand: string | null;
  plan: InstallPlan;
  detection: DetectionResult;
  verification: VerificationResult;
  /** The chat path — always shown, as the primary path or as an alternative. */
  manualSteps: string[];
  uninstallSteps: string[];
  manifestWritable: false;
}

export function renderIntegrationPlan(view: IntegrationPlanView): string {
  const command = view.plan.officialCommand;
  const scopeFlag = view.scopeExplicit ? ` --scope=${view.scope}` : '';
  const lines: string[] = [
    `Integration: ${view.tool}`,
    `Source repository: ${view.plan.sourceRepository}`,
    `Official homepage: ${view.plan.officialHomepage}`,
    `License: ${view.plan.license}`,
    `Resolved version: ${view.plan.resolvedVersion}`,
    `Official install method: ${command === null ? 'manual (no scriptable command for this target)' : renderUserCommand(command)}`,
    ...(command !== null && view.teamMarketplaceCommand !== null
      ? [`For teammates (project scope), install-integration first declares the marketplace in .claude/settings.json: ${view.teamMarketplaceCommand}`]
      : []),
    ...(command === null
      ? []
      : [
          `Run it for you (verifies and records afterwards): ${view.runNx} g @clearlydev/nx-archweave:install-integration --tool=${view.tool} --apply${scopeFlag}`,
        ]),
    '',
    command === null ? 'Manual steps:' : 'Manual alternative (inside a Claude Code session):',
    ...view.manualSteps.map((step) => `  - ${step}`),
    '',
    'Uninstall instructions:',
    ...view.uninstallSteps.map((step) => `  - ${step}`),
    '',
    `Current detection: ${view.detection.installed ? 'installed' : 'not installed'}`,
    `Current verification: ${view.verification.verified ? 'passed' : 'not verified'}`,
    ...view.verification.problems.map((problem) => `  ! ${problem}`),
    '',
    'Manifest write: none here — install-integration records it after installing; record-integration records an install done elsewhere.',
  ];
  return lines.join('\n');
}
