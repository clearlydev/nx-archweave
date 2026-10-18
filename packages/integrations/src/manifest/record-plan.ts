import type { VerificationResult } from '../contracts/integration.ts';
import type { IntegrationManifestEntry } from './manifest.ts';

export interface RecordIntegrationPlan {
  id: string;
  target: string;
  verificationSource: 'claude-cli' | 'package-json';
  currentVerification: VerificationResult;
  existingEntry: IntegrationManifestEntry | undefined;
  proposedEntry: IntegrationManifestEntry | undefined;
  hasConflict: boolean;
}

export interface BuildRecordPlanInput {
  id: string;
  target: string;
  verificationSource: 'claude-cli' | 'package-json';
  verification: VerificationResult;
  existingEntry: IntegrationManifestEntry | undefined;
  metadata: { source: string; repository: string; method: string };
}

function entriesEqual(a: IntegrationManifestEntry, b: IntegrationManifestEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Pure — no I/O. The single most safety-sensitive branch in this file:
// proposedEntry is only ever defined when BOTH verification.verified is true
// AND verificationSource is 'claude-cli'. A package.json-sourced
// verified:true is informationally correct for add-integration's existing
// display purposes, but must never gate a manifest write.
export function buildRecordPlan(input: BuildRecordPlanInput): RecordIntegrationPlan {
  const isRecordable = input.verification.verified && input.verificationSource === 'claude-cli';

  const proposedEntry: IntegrationManifestEntry | undefined = isRecordable
    ? {
        source: input.metadata.source,
        repository: input.metadata.repository,
        version: input.verification.resolvedVersion,
        method: input.metadata.method,
        managedBy: 'nx-archweave',
        verification: 'passed',
        target: input.target,
        evidenceKind: 'claude-cli',
      }
    : undefined;

  const hasConflict =
    input.existingEntry !== undefined &&
    proposedEntry !== undefined &&
    !entriesEqual(input.existingEntry, proposedEntry);

  return {
    id: input.id,
    target: input.target,
    verificationSource: input.verificationSource,
    currentVerification: input.verification,
    existingEntry: input.existingEntry,
    proposedEntry,
    hasConflict,
  };
}
