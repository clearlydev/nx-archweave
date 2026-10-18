import type { Tree } from '@nx/devkit';
import { serializeDoctorReport } from '@nx-archweave/shared';
import { renderDoctorReport } from './render.ts';
import { buildDoctorReportWithIntegrations } from './integration-report.ts';
import type { DoctorGeneratorSchema } from './schema.d.ts';

export async function doctorGenerator(tree: Tree, options: DoctorGeneratorSchema): Promise<void> {
  const report = await buildDoctorReportWithIntegrations(tree.root, {
    liveIntegrations: options.liveIntegrations ?? false,
  });
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
