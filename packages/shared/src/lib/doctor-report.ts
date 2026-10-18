export type CheckStatus = 'pass' | 'warning' | 'error' | 'not-applicable';

export interface DoctorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  evidence: string[];
  suggestedAction?: string;
}

export type OverallStatus = 'safe' | 'conflict' | 'manual-review-required' | 'unsupported';

export interface DoctorReport {
  checks: DoctorCheck[];
  overallStatus: OverallStatus;
}

export function createDoctorCheck(input: {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  evidence: string[];
  suggestedAction?: string;
}): DoctorCheck {
  return { suggestedAction: undefined, ...input };
}

// Relocated from template-engine/src/doctor/run-doctor-checks.ts so nx-plugin
// can reuse the same priority rule when merging integration checks into a
// DoctorReport, without duplicating it.
export function computeOverallStatus(checks: DoctorCheck[]): OverallStatus {
  if (checks.some((c) => c.status === 'error')) return 'conflict';
  if (checks.some((c) => c.status === 'warning')) return 'manual-review-required';
  return 'safe';
}

export const DOCTOR_REPORT_SCHEMA_ID = 'archweave/doctor-report@1';

/** Byte-stable machine output — fixed field order,
 * 2-space indent, one trailing newline, no timestamp (doctor is idempotent
 * by contract, so identical input must serialize to identical bytes). */
export function serializeDoctorReport(report: DoctorReport): string {
  const count = (status: CheckStatus) => report.checks.filter((c) => c.status === status).length;
  const body = {
    schema: DOCTOR_REPORT_SCHEMA_ID,
    overallStatus: report.overallStatus,
    summary: {
      pass: count('pass'),
      warning: count('warning'),
      error: count('error'),
      notApplicable: count('not-applicable'),
    },
    checks: report.checks.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      message: c.message,
      evidence: c.evidence,
      ...(c.suggestedAction !== undefined ? { suggestedAction: c.suggestedAction } : {}),
    })),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
