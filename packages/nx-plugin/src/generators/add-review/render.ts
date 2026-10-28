export type WorkflowAction =
  | 'created'
  | 'overwritten'
  | 'unchanged'
  | 'proposed'
  | 'skipped'
  | 'alternate'
  | 'aborted';
export type ConfigAction = 'created' | 'updated' | 'unchanged' | 'not-updated' | 'aborted';
/** `.github/dependabot.yml`: written only when absent; an existing file is the user's and is
 * only shown what to add. */
export type DependabotAction = 'created' | 'present' | 'proposed' | 'not-applied';
export const DEPENDABOT_PATH = '.github/dependabot.yml';

const PROVIDER_STATUS_URL = 'https://github.com/clearlydev/nx-archweave/blob/main/docs/pr-review.md#provider-status';

export interface AddReviewReport {
  dryRun: boolean;
  workflowPath: string;
  workflowAction: WorkflowAction;
  configAction: ConfigAction;
  requiredSecretName: string;
  diff: string | null;
  workflowYaml: string | null;
  configSnippetJson: string | null;
  configError: string | null;
  /** Present only when the package manager was a blind pnpm fallback. */
  packageManagerNote?: string;
  /** The chosen provider, when it is still in beta. */
  betaProvider?: string;
  dependabot: DependabotAction;
  /** The generated dependabot.yml, shown when the existing file lacks a github-actions entry. */
  dependabotProposal: string | null;
}

/** Line-level LCS diff — small generated files, no diff library. */
export function renderLineDiff(existing: string, generated: string): string {
  const a = existing.split('\n');
  const b = generated.split('\n');
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = ['--- existing', '+++ generated'];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(`- ${a[i]}`);
      i++;
    } else {
      out.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < m) out.push(`- ${a[i++]}`);
  while (j < n) out.push(`+ ${b[j++]}`);
  return out.join('\n');
}

const WORKFLOW_ACTION_LINES: Record<WorkflowAction, string> = {
  created: 'created',
  overwritten: 'overwritten with the generated version (per --onConflict=overwrite)',
  unchanged: 'unchanged (already matches the generated version)',
  proposed: 'NOT written — differs from the generated version (merge proposal below)',
  skipped: 'left as-is (per --onConflict=skip)',
  alternate: 'generated alongside the existing file',
  aborted: 'NOT written',
};

const CONFIG_ACTION_LINES: Record<ConfigAction, string> = {
  created: 'created with the review field',
  updated: 'review field updated',
  unchanged: 'review field unchanged',
  'not-updated': 'NOT updated — kept consistent with the workflow file that is actually in effect',
  aborted: 'NOT updated',
};

export function renderAddReviewReport(report: AddReviewReport): string {
  const lines: string[] = [];
  if (report.packageManagerNote !== undefined) {
    lines.push(`Note: ${report.packageManagerNote}`);
  }

  if (report.workflowAction === 'aborted') {
    lines.push('add-review aborted — nothing was written.');
    lines.push(`  toolkit.config.json: ${report.configError ?? 'unusable'}`);
    lines.push('  Fix the config file manually, then rerun the generator.');
    return lines.join('\n');
  }

  if (report.dryRun) {
    lines.push('add-review dry-run — no files were written.');
    lines.push('');
    lines.push('Generated workflow YAML:');
    lines.push(report.workflowYaml ?? '');
    lines.push('');
    lines.push('toolkit.config.json review field:');
    lines.push(report.configSnippetJson ?? '');
    lines.push('');
    lines.push('Effective decision:');
  }

  lines.push(`  ${report.workflowPath}: ${WORKFLOW_ACTION_LINES[report.workflowAction]}`);
  lines.push(`  toolkit.config.json: ${CONFIG_ACTION_LINES[report.configAction]}`);

  if (report.workflowAction === 'proposed' && report.diff) {
    lines.push('');
    lines.push(report.diff);
    lines.push('');
    lines.push('To resolve, rerun with one of:');
    lines.push('  --onConflict=overwrite            replace the existing file with the generated version');
    lines.push('  --onConflict=skip                 keep the existing file');
    lines.push('  --onConflict=alternate-filename   write the generated version alongside it');
  }

  if (report.dependabot === 'created') {
    lines.push(`  ${DEPENDABOT_PATH}: created — Dependabot proposes newer pins for the workflow's actions`);
  } else if (report.dependabot === 'present') {
    lines.push(`  ${DEPENDABOT_PATH}: already updates github-actions`);
  } else if (report.dependabot === 'proposed') {
    lines.push(`  ${DEPENDABOT_PATH}: NOT changed — it has no github-actions entry. The workflow pins each action`);
    lines.push('  to a commit SHA; add this entry under `updates:` so those pins get update pull requests:');
    lines.push('');
    lines.push(report.dependabotProposal ?? '');
  }

  if (report.workflowAction === 'alternate') {
    lines.push('');
    lines.push('  Review the generated file, then replace the main workflow file with it yourself;');
    lines.push('  the config stays pointing at the workflow that is actually in effect until you do.');
  }

  lines.push('');
  lines.push(`Note: the review workflow stays green-skipped until you register the ${report.requiredSecretName} secret.`);
  if (report.betaProvider !== undefined) {
    lines.push(`Note: the ${report.betaProvider} provider is in beta — its workflow hasn't finished a review end to end on`);
    lines.push(`GitHub Actions yet. Status, costs and known issues: ${PROVIDER_STATUS_URL}`);
  }
  lines.push('Note: this workflow runs with elevated permissions only after it is merged to the default branch —');
  lines.push('merging is the first real validation.');

  return lines.join('\n');
}
