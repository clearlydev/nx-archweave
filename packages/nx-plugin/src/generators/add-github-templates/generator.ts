import { join } from 'node:path';
import type { Tree } from '@nx/devkit';
import type { ToolkitLocale } from '@nx-archweave/shared';
import type { AddGithubTemplatesGeneratorSchema } from './schema.d.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import { readToolkitConfig, resolveLocaleOption } from '../shared/toolkit-config-file.ts';
import { generatorFilesDir, renderTemplateFiles, type RenderedFile } from '../shared/template-files.ts';
import {
  renderAddGithubTemplatesReport,
  type AddGithubTemplatesReport,
  type GithubTemplateFileAction,
  type GithubTemplateFileResult,
} from './render.ts';

export const BUG_REPORT_PATH = '.github/ISSUE_TEMPLATE/bug-report.yml';
export const FEATURE_REQUEST_PATH = '.github/ISSUE_TEMPLATE/feature-request.yml';
export const PULL_REQUEST_TEMPLATE_PATH = '.github/PULL_REQUEST_TEMPLATE.md';
export const CODEOWNERS_PATH = '.github/CODEOWNERS';

/** The files to write, from `files/<locale>/<group>/` — issue forms, then the PR template,
 * then CODEOWNERS, whatever order the flags came in. */
function composeGithubTemplates(groups: { issue: boolean; pr: boolean; codeowners: boolean }, locale: ToolkitLocale): RenderedFile[] {
  const files = generatorFilesDir('add-github-templates', import.meta.url);
  return (['issue', 'pr', 'codeowners'] as const)
    .filter((group) => groups[group])
    .flatMap((group) => renderTemplateFiles(join(files, locale, group), '.', {}));
}

/** Adapter core: Tree read/write + option parsing + report only. The text of every file
 * lives in this generator's `files/` directory.
 *
 * Conflict policy (no `onConflict` option): a differing existing file
 * is always left as-is ("skipped"); an absent file is created; an identical
 * file is reported unchanged. Because skip is unconditional, a run can
 * legitimately create some files while skipping others in the same pass — the
 * per-file report line is the atomicity unit here, not the whole run. */
export function runAddGithubTemplates(tree: Tree, options: AddGithubTemplatesGeneratorSchema): AddGithubTemplatesReport {
  // Never aborts on a broken config this generator does not own — the default falls through.
  const locale = resolveLocaleOption(options.locale, readToolkitConfig(tree));
  const plan = composeGithubTemplates(
    { issue: options.issue ?? false, pr: options.pr ?? true, codeowners: options.codeowners ?? false },
    locale,
  );

  const dryRun = options.dryRun ?? false;
  const files: GithubTemplateFileResult[] = plan.map(({ filePath, content }) => {
    const existing = tree.read(filePath, 'utf-8');
    let action: GithubTemplateFileAction;
    if (existing === null) {
      action = 'created';
      if (!dryRun) tree.write(filePath, content);
    } else if (existing === content) {
      action = 'unchanged';
    } else {
      action = 'skipped';
    }
    return { filePath, action, content };
  });

  return { dryRun, files };
}

export async function addGithubTemplatesGenerator(tree: Tree, options: AddGithubTemplatesGeneratorSchema): Promise<void> {
  console.log(renderAddGithubTemplatesReport(runAddGithubTemplates(tree, { ...options, dryRun: resolveDryRun(options) })));
}

export default addGithubTemplatesGenerator;
