import type { DoctorReport } from '@nx-archweave/shared';
import { computeOverallStatus } from '@nx-archweave/shared';
import { runDoctorChecks, type DoctorProject } from '@nx-archweave/template-engine';
import {
  detectIntegrationsDrift,
  readEnabledIntegrationIds,
  buildIntegrationDoctorChecks,
  classifyIntegrationDrift,
  loadManifest,
  detectWorkspacePackage,
  verifyClaudeMarketplacePlugin,
  PLUGIN_CATALOG,
  type IntegrationDriftResult,
  type ReadOnlyCommandRunner,
} from '@nx-archweave/integrations';
import {
  createIntegrationsCompositionRoot,
  type IntegrationsCompositionRoot,
} from '../../runtime/integrations-composition-root.ts';
import { diskRunNx } from '../shared/run-nx.ts';

// Only claude-code is a supported target for now — doctor
// does not yet accept a --target option, so this is the one hardcoded value.
const DOCTOR_TARGET_ENVIRONMENT = 'claude-code';

export interface BuildDoctorReportOptions {
  liveIntegrations?: boolean;
  /** The workspace's projects (from its Nx configuration); without them the base checks scan
   * the conventional apps/ and libs/ folders. */
  projects?: DoctorProject[];
}

export async function buildDoctorReportWithIntegrations(
  root: string,
  options: BuildDoctorReportOptions = {},
  deps: { integrationsRoot?: IntegrationsCompositionRoot } = {},
): Promise<DoctorReport> {
  const integrationsRoot = deps.integrationsRoot ?? createIntegrationsCompositionRoot();
  const baseReport = runDoctorChecks(root, options.projects);
  const declaredIds = readEnabledIntegrationIds(root);
  const runNx = diskRunNx(root);
  const driftResults = await detectIntegrationsDrift({
    workspaceRoot: root,
    targetEnvironment: DOCTOR_TARGET_ENVIRONMENT,
    declaredIds,
    integrations: integrationsRoot.listIntegrations(),
    runNx,
  });

  // Without --live-integrations: no ReadOnlyCommandRunner call happens at
  // all — doctor stays fast and available even where the claude CLI is not
  // installed, trusting the recorded manifest state exactly as before.
  const finalDriftResults = options.liveIntegrations
    ? await applyLiveVerification(driftResults, {
        root,
        declaredIds,
        runner: integrationsRoot.runner,
        runNx,
      })
    : driftResults;

  const integrationChecks = buildIntegrationDoctorChecks(finalDriftResults);
  const checks = [...baseReport.checks, ...integrationChecks];
  return { checks, overallStatus: computeOverallStatus(checks) };
}

// Re-derives each catalog plugin's drift result using a live verification signal in
// place of the manifest's frozen `verification` field — every other input to
// classifyIntegrationDrift (declared, detected) is unchanged, so this never
// duplicates the classification logic itself, only substitutes one input to
// it. This is still fully read-only: no manifest or config write, no repair.
async function applyLiveVerification(
  driftResults: IntegrationDriftResult[],
  ctx: { root: string; declaredIds: string[]; runner: ReadOnlyCommandRunner; runNx: string },
): Promise<IntegrationDriftResult[]> {
  const context = { workspaceRoot: ctx.root, targetEnvironment: DOCTOR_TARGET_ENVIRONMENT };
  const manifest = loadManifest(ctx.root);
  const live = new Map<string, IntegrationDriftResult>();
  // Only the plugins doctor reports on, and only those this target can verify — each live
  // check is one `claude plugin list` call.
  const reported = new Set(driftResults.map((result) => result.id));
  for (const entry of PLUGIN_CATALOG) {
    if (!reported.has(entry.id) || entry.hosts[DOCTOR_TARGET_ENVIRONMENT] === undefined) continue;
    const existingEntry = manifest.integrations[entry.id];
    const detected = await detectWorkspacePackage(entry, context);
    const { result: liveVerification } = await verifyClaudeMarketplacePlugin(entry, { runner: ctx.runner }, context);

    // A stale recorded "passed" must never survive a current live failure —
    // the live result always wins over the recorded one
    // when --live-integrations is set, never the other way around.
    const liveEntry = existingEntry
      ? { ...existingEntry, verification: liveVerification.verified ? ('passed' as const) : ('failed' as const) }
      : existingEntry;

    live.set(
      entry.id,
      classifyIntegrationDrift({
        id: entry.id,
        installable: true,
        declared: ctx.declaredIds.includes(entry.id),
        manifestEntry: liveEntry,
        detected,
        runNx: ctx.runNx,
      }),
    );
  }

  return driftResults.map((result) => live.get(result.id) ?? result);
}
