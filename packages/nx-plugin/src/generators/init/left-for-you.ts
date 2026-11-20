import { packageManagerCommands } from '@nx-archweave/template-engine';
import type { InitReport } from './render.ts';

/** What init left for the user after a run that did not abort: printed at the end of the
 * report, and what `--strict` fails on. An aborted section (or a toolkit.config.json init
 * could not record into) is not listed here; it fails the run on its own. A choice the user made (no `--applyEslint`, so the ESLint rule comes as a
 * snippet) is not left over either. */
export interface LeftForYou {
  /** Files init left as they were, so the user's own changes stay. */
  kept: string[];
  /** Things init was asked for but could not do; the user finishes them by hand. */
  manual: string[];
}

const PLUGIN = '@clearlydev/nx-archweave';

export function leftForYou(report: InitReport): LeftForYou {
  const runNx = packageManagerCommands(report.packageManager ?? 'pnpm').runNx;
  const kept: string[] = [];
  const manual: string[] = [];

  for (const section of report.sections) {
    if (!section.enabled || section.report === null) continue;
    const sectionReport = section.report;
    switch (sectionReport.kind) {
      case 'fsd': {
        const fsd = sectionReport.report;
        if (fsd.aborted) break;
        if (fsd.eslint === 'degraded-unrecognized') {
          manual.push(
            fsd.eslintPath === null
              ? `${fsd.project ?? 'the app'}: no ESLint config found — add the archweave/fsd-boundaries rule to one (the snippet is above)`
              : `${fsd.eslintPath}: not recognized — add the archweave/fsd-boundaries rule yourself (the snippet is above)`,
          );
        }
        const steiger = fsd.steiger;
        if (steiger !== null) {
          if (steiger.config === 'kept') kept.push(`${steiger.configPath}: an existing steiger config with other content — left as it is`);
          if (steiger.target === 'unrecognized') manual.push(`${fsd.project ?? 'the app'}: add the fsd-check target yourself (no parseable project.json or package.json)`);
          if (steiger.dependencies === 'unrecognized') {
            manual.push('package.json: could not be parsed — add steiger and @feature-sliced/steiger-plugin to devDependencies yourself');
          }
        }
        break;
      }
      case 'agentRules':
        for (const file of sectionReport.report.files) {
          if (file.action === 'user-modified') {
            kept.push(`${file.filePath}: its nx-archweave block was edited by hand — to replace it: ${runNx} g ${PLUGIN}:add-agent-rules --overwriteBlock`);
          } else if (file.action === 'unrecognized') {
            kept.push(`${file.filePath}: left untouched (${file.reason ?? 'its nx-archweave markers could not be placed'}) — fix the file, then rerun init`);
          }
        }
        break;
      case 'githubTemplates':
        for (const file of sectionReport.report.files) {
          if (file.action === 'skipped') {
            kept.push(`${file.filePath}: a different file is already there — to use the generated one, delete it and run ${runNx} g ${PLUGIN}:add-github-templates`);
          }
        }
        break;
      case 'review': {
        const review = sectionReport.report;
        if (review.workflowAction === 'aborted') break;
        if (review.workflowAction === 'proposed' || review.workflowAction === 'skipped') {
          kept.push(`${review.workflowPath}: differs from the generated workflow — to replace it: ${runNx} g ${PLUGIN}:add-review --onConflict=overwrite`);
        } else if (review.workflowAction === 'alternate') {
          manual.push(`${review.workflowPath}: written alongside the existing workflow — replace the main workflow file with it yourself`);
        }
        if (review.dependabot === 'proposed') manual.push('.github/dependabot.yml: add the github-actions entry shown above');
        break;
      }
      case 'backend': {
        const backend = sectionReport.report;
        if (backend.refused !== undefined) break;
        if (backend.eslint === 'degraded-unrecognized') manual.push('ESLint boundaries: your config was not recognized — merge the constraints shown above yourself');
        if (backend.tsconfigPaths === 'unrecognized') {
          manual.push(`tsconfig.base.json: could not be parsed — add the ${backend.sharedTypesPackage ?? 'shared-types'} path yourself`);
        }
        // An integrated layout has no workspace list: the tsconfig paths alias links the lib.
        const linkedByPaths = backend.tsconfigPaths === 'added' || backend.tsconfigPaths === 'present';
        if (backend.workspaceGlob === 'unrecognized' && !linkedByPaths) {
          const registry = packageManagerCommands(backend.packageManager ?? 'pnpm').workspaceRegistration;
          manual.push(`${registry}: shape not recognized — add '${backend.sharedTypesRoot ?? 'libs/shared-types'}' to its workspace list yourself`);
        }
        break;
      }
    }
  }

  return { kept, manual };
}

/** The summary printed last in the report; empty when nothing is left. */
export function renderLeftForYou(left: LeftForYou): string[] {
  const lines: string[] = [];
  if (left.kept.length > 0) {
    lines.push('', 'Skipped to keep your changes:', ...left.kept.map((item) => `  ${item}`));
  }
  if (left.manual.length > 0) {
    lines.push('', 'Needs a manual step:', ...left.manual.map((item) => `  ${item}`));
  }
  return lines;
}
