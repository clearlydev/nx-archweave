import type { DetectionResult, IntegrationContext, ToolIntegration } from '../contracts/integration.ts';
import { loadManifest, type IntegrationManifestEntry } from '../manifest/manifest.ts';

export type IntegrationDriftStatus =
  | 'not-installed'
  | 'configured'
  | 'declared-missing' // ①: declared, but no install record
  | 'undeclared-leftover' // ②: install record remains after the declaration went away
  | 'verification-failed' // ③: declared and recorded, but the last verification failed
  | 'externally-installed'; // ④: found live, but neither declared nor recorded

export interface IntegrationDriftResult {
  id: string;
  status: IntegrationDriftStatus;
  reason: string;
  /** One-sentence recommended action (doctor prints it; never auto-repairs). */
  suggestedAction?: string;
  source?: string;
  verification?: 'passed' | 'failed';
}

export interface ClassifyIntegrationDriftInput {
  id: string;
  /** True when the registry has an adapter for this id — only then is install-integration
   * a valid suggestion (a typo or an unsupported tool would be rejected by its schema). */
  installable?: boolean;
  declared: boolean;
  manifestEntry: IntegrationManifestEntry | undefined;
  detected: DetectionResult;
  /** How the workspace runs its own nx (`pnpm nx`, `npm exec nx --`, …) for the suggested
   * commands; the caller detects it. Default `pnpm nx`. */
  runNx?: string;
}

// Pure classifier — no I/O, no side effects, no automatic repair. Reports the
// four drift states ①~④ individually, plus
// the two uncontested states: not-installed and configured.
export function classifyIntegrationDrift(input: ClassifyIntegrationDriftInput): IntegrationDriftResult {
  const { id, declared, manifestEntry, detected } = input;
  const nxG = `${input.runNx ?? 'pnpm nx'} g`;

  if (!declared && !manifestEntry && !detected.installed) {
    return {
      id,
      status: 'not-installed',
      reason: 'Not declared in ToolkitConfig.integrations.enabled, no manifest entry, and not detected in this workspace.',
    };
  }

  if (!declared) {
    if (manifestEntry) {
      return {
        id,
        status: 'undeclared-leftover',
        reason: 'The configuration no longer declares this integration, but its install record remains.',
        suggestedAction:
          'Either re-declare it in ToolkitConfig.integrations.enabled or clean up the leftover installation and manifest entry.',
        source: manifestEntry.source,
        verification: manifestEntry.verification,
      };
    }
    return {
      id,
      status: 'externally-installed',
      reason: 'Detected live, but neither declared in ToolkitConfig.integrations.enabled nor recorded in the manifest — installed outside nx-archweave.',
      suggestedAction:
        'Adopt it by declaring it in ToolkitConfig.integrations.enabled, or leave it unmanaged (doctor will keep noting it).',
    };
  }

  if (manifestEntry && manifestEntry.verification === 'passed') {
    return {
      id,
      status: 'configured',
      reason: 'Declared and installed; the last verification passed.',
      source: manifestEntry.source,
      verification: 'passed',
    };
  }

  if (manifestEntry) {
    return {
      id,
      status: 'verification-failed',
      reason: `Declared and an install record exists, but the last verification did not pass (status: ${manifestEntry.verification}).`,
      suggestedAction: 'Inspect the tool installation and re-run its verification (or reinstall the integration).',
      source: manifestEntry.source,
      verification: manifestEntry.verification,
    };
  }

  if (detected.installed) {
    // Still ① (no install RECORD), but the tool itself is present — the
    // right move is to record it, not reinstall it.
    return {
      id,
      status: 'declared-missing',
      reason: 'Declared and detected as installed, but no install record exists — the installation happened outside nx-archweave bookkeeping.',
      suggestedAction: `Adopt the existing installation into the manifest: ${nxG} @clearlydev/nx-archweave:record-integration --tool=${id} --apply`,
    };
  }
  return {
    id,
    status: 'declared-missing',
    reason: 'Declared in ToolkitConfig.integrations.enabled, but no install record exists — the installation never happened or was removed.',
    suggestedAction: input.installable
      ? `Install it: ${nxG} @clearlydev/nx-archweave:install-integration --tool=${id} --apply — or remove the declaration if it is no longer wanted.`
      : 'Re-install the integration, or remove the declaration if it is no longer wanted (nx-archweave has no installer for this id — check it for a typo).',
  };
}

export interface DetectIntegrationsDriftInput {
  workspaceRoot: string;
  targetEnvironment: string;
  declaredIds: string[];
  integrations: ToolIntegration[];
  /** See ClassifyIntegrationDriftInput.runNx. */
  runNx?: string;
}

// Orchestrates classifyIntegrationDrift across every id that appears in either
// the declared config, the manifest, or the provided registry — read-only
// (detect() itself must be read-only;
// nothing here writes to the manifest or the filesystem).
export async function detectIntegrationsDrift(input: DetectIntegrationsDriftInput): Promise<IntegrationDriftResult[]> {
  const manifest = loadManifest(input.workspaceRoot);
  const ids = new Set<string>([
    ...input.declaredIds,
    ...Object.keys(manifest.integrations),
    ...input.integrations.map((integration) => integration.id),
  ]);

  const context: IntegrationContext = {
    workspaceRoot: input.workspaceRoot,
    targetEnvironment: input.targetEnvironment,
  };

  const results: IntegrationDriftResult[] = [];
  for (const id of ids) {
    const integration = input.integrations.find((candidate) => candidate.id === id);
    const detected: DetectionResult = integration
      ? await integration.detect(context)
      : { installed: false, managedBy: 'unknown', evidence: [] };

    results.push(
      classifyIntegrationDrift({
        id,
        installable: integration !== undefined,
        declared: input.declaredIds.includes(id),
        manifestEntry: manifest.integrations[id],
        detected,
        ...(input.runNx === undefined ? {} : { runNx: input.runNx }),
      }),
    );
  }
  return results;
}
