import type { DoctorReport } from '@nx-archweave/shared';

export function renderDoctorReport(report: DoctorReport): string {
  const lines = [`Overall status: ${report.overallStatus}`, ''];
  for (const check of report.checks) {
    lines.push(`[${check.status.toUpperCase()}] ${check.label}: ${check.message}`);
    if (check.suggestedAction) {
      lines.push(`  → ${check.suggestedAction}`);
    }
  }
  return lines.join('\n');
}
