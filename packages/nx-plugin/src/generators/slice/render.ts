import type { FsdSliceLayer } from '@nx-archweave/template-engine';

export type SliceAction = 'created' | 'unchanged' | 'skipped';
export type SliceRefusalReason =
  | 'invalid-name'
  | 'invalid-public-api-name'
  | 'segment-by-essence'
  | 'invalid-segment'
  | 'segments-on-shared'
  | 'project-not-found'
  | 'ambiguous-frontend'
  | 'no-frontend-app'
  | 'invalid-project-json'
  | 'group-on-shared'
  | 'invalid-group';

export interface SliceFileResult {
  filePath: string;
  content: string;
}

export interface SliceReport {
  dryRun: boolean;
  layer: FsdSliceLayer;
  name: string;
  /** The frontend app the slice goes into; null until one is picked. */
  project: string | null;
  /** `<app sourceRoot>/<layer>` (`<app>/src/<layer>` before an app is picked). */
  layerDir: string;
  /** `<layerDir>/<name>`. */
  directory: string;
  /** ambiguous-frontend: the frontend apps to choose from with --project; no-frontend-app: the
   * projects that were not taken for one. */
  candidates?: string[];
  /** ambiguous-frontend: the apps toolkit.config.json's `frontends` records (init --project). */
  recordedFrontends?: string[];
  /** invalid-project-json: the file devkit could not parse; invalid-segment / segment-by-essence
   * (from --segments): the offending segment name. */
  detail?: string;
  /** null only when `refused` is true. */
  publicApiName: string | null;
  refused: boolean;
  /** null when `refused` is false. */
  refusalReason: SliceRefusalReason | null;
  /** null when `refused` is true. */
  action: SliceAction | null;
  /** Empty when `refused` is true. */
  files: SliceFileResult[];
  /** Why the slice has no .spec.ts: no jest or vitest was found, or the run (or
   * toolkit.config.json) asked for none. Absent when the spec was written. */
  specSkipped?: 'no-test-runner' | 'none-requested';
}

const ACTION_LINES: Record<SliceAction, string> = {
  created: 'created',
  unchanged: 'unchanged (already matches the generated content)',
  skipped: 'skipped — a slice with this name already exists with different content',
};

export function renderSliceReport(report: SliceReport): string {
  const lines: string[] = [];
  const label = `${report.layer} "${report.name}"`;

  if (report.refused) {
    lines.push(`${label}: refused — nothing was written.`);
    lines.push('');
    if (report.refusalReason === 'invalid-name') {
      lines.push(`  "${report.name}" is not a valid kebab-case slice name.`);
      lines.push('  Use lowercase letters, digits, and single hyphens, starting with a letter (e.g. "add-to-cart").');
    } else if (report.refusalReason === 'invalid-public-api-name') {
      lines.push('  The public API name is not a usable JavaScript identifier (or is a reserved word).');
      lines.push('  Pass --publicApiName with a valid identifier, e.g. "addToCart" (this also happens when');
      lines.push('  the slice name camelCases into a reserved word, like "class" or "delete").');
    } else if (report.refusalReason === 'project-not-found') {
      lines.push(`  --project=${report.project} names no project in this workspace.`);
    } else if (report.refusalReason === 'ambiguous-frontend') {
      lines.push('  More than one frontend app was found — rerun with --project=<one of them>:');
      for (const name of report.candidates ?? []) lines.push(`    - ${name}`);
      if ((report.recordedFrontends ?? []).length > 0) lines.push(`  (toolkit.config.json records: ${(report.recordedFrontends ?? []).join(', ')})`);
    } else if (report.refusalReason === 'invalid-project-json') {
      lines.push(`  A project.json could not be parsed (${report.detail ?? 'unknown'}) — fix it, then rerun.`);
    } else if (report.refusalReason === 'no-frontend-app' && (report.candidates ?? []).length > 0) {
      lines.push('  No project was recognised as a frontend app. If one of these is it, rerun with --project=<name>:');
      for (const name of report.candidates ?? []) lines.push(`    - ${name}`);
    } else if (report.refusalReason === 'no-frontend-app') {
      lines.push('  The workspace has no projects to hold FSD layers — create a frontend app first.');
    } else if (report.refusalReason === 'invalid-segment') {
      lines.push(`  --segments: "${report.detail ?? ''}" is not a valid segment name.`);
      lines.push('  Use lowercase letters, digits, and single hyphens, starting with a letter (e.g. ui, api, lib).');
    } else if (report.refusalReason === 'group-on-shared') {
      lines.push('  --group does not apply to shared: shared holds segments, not slices.');
    } else if (report.refusalReason === 'invalid-group') {
      lines.push(`  --group: "${report.detail ?? ''}" is not a usable group name.`);
      lines.push('  Use kebab-case (e.g. "mypage"), and not a segment name (ui, model, api, lib, config).');
    } else if (report.refusalReason === 'segments-on-shared') {
      lines.push('  --segments does not apply to shared: a shared segment holds no segments of its own.');
      lines.push('  Run the generator once per segment instead (e.g. --name=ui, then --name=api).');
    } else {
      const offender = report.detail ?? report.name;
      lines.push(`  "${offender}" names what a segment contains, not what it is for.`);
      lines.push('  Canonical FSD names segments by purpose — ui, api, model, lib, config — so the code stays');
      lines.push('  findable by what it does (e.g. a date helper lives in shared/lib, a Button in shared/ui).');
    }
    return lines.join('\n');
  }

  if (report.dryRun) {
    lines.push('dry-run — no files were written.');
    lines.push('');
  }

  lines.push(`${label}: ${ACTION_LINES[report.action as SliceAction]}`);

  if (report.action === 'skipped') {
    lines.push(`  ${report.directory} already exists and does not exactly match the generated content.`);
    lines.push('  Pick a new slice name (a name collision is a signal to rename, not to merge)');
    lines.push('  — or remove the existing directory manually first if you intended to replace it.');
    return lines.join('\n');
  }

  if (report.specSkipped === 'no-test-runner') {
    lines.push('  no test runner found (jest or vitest) — no .spec.ts was written; pass --unitTestRunner=jest|vitest to add one.');
  } else if (report.specSkipped === 'none-requested') {
    lines.push('  no .spec.ts was written (unitTestRunner: none).');
  }

  if (report.dryRun) {
    for (const file of report.files) {
      lines.push('');
      lines.push(`${file.filePath}:`);
      lines.push(file.content);
    }
  }

  return lines.join('\n');
}
