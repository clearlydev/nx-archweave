import { createDoctorCheck, type DoctorCheck } from '@nx-archweave/shared';
import type { IntegrationDriftResult } from './detect-drift.ts';

// Pure mapping only — the drift classification itself (classifyIntegrationDrift /
// detectIntegrationsDrift) is not duplicated here. `source` is only ever set on a
// result when a manifest entry existed (see classifyIntegrationDrift), so its
// presence is used below to distinguish the two doctor cases each of
// the four drift states represent.
export function buildIntegrationDoctorChecks(results: IntegrationDriftResult[]): DoctorCheck[] {
  return results.map((result) => {
    const evidence = [
      result.source && `manifest source: ${result.source}`,
      result.verification && `verification: ${result.verification}`,
    ].filter(Boolean) as string[];

    // Exhaustive on purpose: a new drift state must
    // fail compilation here, never silently fall through.
    const status = ((): DoctorCheck['status'] => {
      switch (result.status) {
        case 'not-installed':
          return 'not-applicable';
        case 'declared-missing':
        case 'undeclared-leftover':
        case 'externally-installed':
          return 'warning';
        case 'verification-failed':
          return 'error';
        case 'configured':
          return 'pass';
        default:
          return result.status satisfies never;
      }
    })();

    return createDoctorCheck({
      id: `integration-${result.id}`,
      label: `Integration: ${result.id}`,
      status,
      message: result.reason,
      evidence,
      suggestedAction: result.suggestedAction,
    });
  });
}
