import {
  buildRecordPlan,
  getCatalogEntry,
  loadManifest,
  recordMetadataFor,
  verifyClaudeMarketplacePlugin,
  writeManifestAtomic,
  type CommandRunner,
  type IntegrationManifestEntry,
  type VerificationResult,
} from '@nx-archweave/integrations';

export interface RecordPipelineOutcome {
  verificationSource: 'claude-cli' | 'package-json';
  verification: VerificationResult;
  existingEntry: IntegrationManifestEntry | undefined;
  proposedEntry: IntegrationManifestEntry | undefined;
  hasConflict: boolean;
  wasWritten: boolean;
}

/**
 * Live verify → manifest record, shared by record-integration and install-integration.
 * Always a fresh call — never a cached result. Only a
 * claude-cli-sourced verified:true is recordable (buildRecordPlan enforces it); the write
 * is the atomic manifest write and happens only when `write` is set.
 */
export async function runRecordPipeline(input: {
  id: string;
  runner: CommandRunner;
  workspaceRoot: string;
  target: string;
  write: boolean;
}): Promise<RecordPipelineOutcome> {
  const entry = getCatalogEntry(input.id);
  // Where it came from comes from the catalog entry.
  const metadata = entry === undefined ? undefined : recordMetadataFor(entry);
  if (!entry || !metadata) {
    throw new Error(`No manifest metadata is defined for "${input.id}".`);
  }
  const { result: verification, source: verificationSource } = await verifyClaudeMarketplacePlugin(
    entry,
    { runner: input.runner },
    { workspaceRoot: input.workspaceRoot, targetEnvironment: input.target },
  );

  const manifest = loadManifest(input.workspaceRoot);
  const existingEntry = manifest.integrations[input.id];
  const plan = buildRecordPlan({ id: input.id, target: input.target, verificationSource, verification, existingEntry, metadata });

  let wasWritten = false;
  if (input.write && plan.proposedEntry) {
    writeManifestAtomic(input.workspaceRoot, {
      integrations: { ...manifest.integrations, [input.id]: plan.proposedEntry },
    });
    wasWritten = true;
  }

  return {
    verificationSource,
    verification,
    existingEntry,
    proposedEntry: plan.proposedEntry,
    hasConflict: plan.hasConflict,
    wasWritten,
  };
}
