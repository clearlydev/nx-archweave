import type { IntegrationManifestEntry, VerificationResult } from '@nx-archweave/integrations';

export interface RecordIntegrationView {
  tool: string;
  target: string;
  sourceRepository: string;
  license: string;
  verificationSource: 'claude-cli' | 'package-json';
  verification: VerificationResult;
  existingEntry: IntegrationManifestEntry | undefined;
  proposedEntry: IntegrationManifestEntry | undefined;
  hasConflict: boolean;
  wasWritten: boolean;
}

// Never renders installPath or any absolute/home-directory path — the
// manifest entry types used here already exclude installPath by
// construction, and this function only ever reads from
// those already-narrowed values.
export function renderRecordIntegrationView(view: RecordIntegrationView): string {
  const lines: string[] = [
    `Integration: ${view.tool}`,
    `Target: ${view.target}`,
    `Source repository: ${view.sourceRepository}`,
    `License: ${view.license}`,
    `Verification source: ${view.verificationSource}`,
    `Current verification: ${view.verification.verified ? 'passed' : 'not verified'}`,
    ...view.verification.problems.map((problem) => `  ! ${problem}`),
    '',
  ];

  if (view.hasConflict && view.existingEntry) {
    lines.push(
      'Conflict: an existing manifest entry differs from what would be recorded.',
      `  Existing: ${JSON.stringify(view.existingEntry)}`,
      `  Proposed: ${JSON.stringify(view.proposedEntry)}`,
      '',
    );
  }

  if (view.proposedEntry) {
    lines.push(
      view.wasWritten
        ? 'Recorded — the following manifest entry was written:'
        : 'The following manifest entry would be recorded:',
      `  ${JSON.stringify(view.proposedEntry)}`,
    );
  } else {
    lines.push(
      'Nothing would be recorded — verification did not succeed via the authoritative claude-cli signal.',
    );
  }

  lines.push(
    '',
    view.wasWritten
      ? '(recorded — the manifest was written)'
      : '(dry-run — no files were changed, no installer was executed, manifest was not written)',
  );

  return lines.join('\n');
}
