import type { Tree } from '@nx/devkit';
import { computeOverallStatus, serializeDoctorReport } from '@nx-archweave/shared';
import { renderDoctorReport } from './render.ts';
import { buildDoctorReportWithIntegrations } from './integration-report.ts';
import type { DoctorGeneratorSchema } from './schema.d.ts';
import { buildWorkspaceChecks, doctorProjects } from './workspace-checks.ts';
import { readNxSupport } from './nx-support.ts';

export async function doctorGenerator(tree: Tree, options: DoctorGeneratorSchema): Promise<void> {
  const base = await buildDoctorReportWithIntegrations(tree.root, {
    liveIntegrations: options.liveIntegrations ?? false,
    projects: doctorProjects(tree),
    nxSupport: readNxSupport(tree.root),
  });
  // Outside an Nx workspace there is no project to read.
  const checks = base.overallStatus === 'unsupported' ? base.checks : [...base.checks, ...buildWorkspaceChecks(tree)];
  const report = { checks, overallStatus: base.overallStatus === 'unsupported' ? base.overallStatus : computeOverallStatus(checks) };
  if (options.json ?? false) {
    // Machine mode prints ONLY the serialized report, so
    // stdout stays pipe-pure (trimEnd: console.log adds the final newline).
    console.log(serializeDoctorReport(report).trimEnd());
    return;
  }
  console.log(renderDoctorReport(report));
  console.log('\n(read-only — no files were changed)');
}

export default doctorGenerator;
