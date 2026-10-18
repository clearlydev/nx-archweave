export type GithubTemplateFileAction = 'created' | 'unchanged' | 'skipped';

export interface GithubTemplateFileResult {
  filePath: string;
  action: GithubTemplateFileAction;
  content: string;
}

export interface AddGithubTemplatesReport {
  dryRun: boolean;
  files: GithubTemplateFileResult[];
}

const ACTION_LINES: Record<GithubTemplateFileAction, string> = {
  created: 'created',
  unchanged: 'unchanged (already matches the generated version)',
  skipped: 'left as-is (a different file already exists there — never overwritten)',
};

export function renderAddGithubTemplatesReport(report: AddGithubTemplatesReport): string {
  const lines: string[] = [];

  if (report.files.length === 0) {
    lines.push('add-github-templates: nothing selected (issue/pr/codeowners all false) — no files to install.');
    return lines.join('\n');
  }

  if (report.dryRun) {
    lines.push('add-github-templates dry-run — no files were written.');
    lines.push('');
    for (const file of report.files) {
      lines.push(`${file.filePath}:`);
      lines.push(file.content);
      lines.push('');
    }
    lines.push('Effective decision:');
  }

  for (const file of report.files) {
    lines.push(`  ${file.filePath}: ${ACTION_LINES[file.action]}`);
  }

  return lines.join('\n');
}
