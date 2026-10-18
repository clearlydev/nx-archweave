import type { ToolkitAiHost } from '@nx-archweave/shared';

/** What happened to each rules file: only nx-archweave's
 * marked block is ever written — never the text around it. */
export type AgentRuleFileAction = 'created' | 'appended' | 'updated' | 'unchanged' | 'unrecognized';

export interface AgentRuleFileResult {
  filePath: string;
  action: AgentRuleFileAction;
  /** Set only when action is 'unrecognized' — why the markers could not be placed. */
  reason: string | null;
  /** Populated only in dryRun (the whole file as it was — or would be — written). */
  content: string | null;
}

export interface AddAgentRulesReport {
  dryRun: boolean;
  locale: 'ko' | 'en';
  /** The AI hosts the files were chosen for (option → toolkit.config.json → Claude Code). */
  hosts: ToolkitAiHost[];
  /** Whether the Team Rules section was composed in — resolved
   * from the option, then toolkit.config.json, then false. */
  teamRules: boolean;
  files: AgentRuleFileResult[];
  /** toolkit.config.json `aiHosts` after an explicit --hosts: written (created/updated),
   * already equal, an unusable file left alone, skipped because a file was not applied,
   * or no --hosts given. */
  hostsRecord: 'created' | 'updated' | 'unchanged' | 'unrecognized' | 'not-applied' | 'not-requested';
}

const ACTION_LINE: Record<AgentRuleFileAction, (result: AgentRuleFileResult) => string> = {
  created: (result) => `${result.filePath}: created`,
  appended: (result) => `${result.filePath}: nx-archweave block added after the existing content (nothing else changed)`,
  updated: (result) => `${result.filePath}: nx-archweave block updated (nothing outside it changed)`,
  unchanged: (result) => `${result.filePath}: unchanged`,
  unrecognized: (result) => `${result.filePath}: not written — ${result.reason ?? 'the nx-archweave markers could not be placed'}`,
};

export function renderAddAgentRulesReport(report: AddAgentRulesReport): string {
  const lines: string[] = [];

  lines.push(report.dryRun ? 'add-agent-rules dry-run — no files were written.' : 'add-agent-rules:');
  lines.push(`  hosts: ${report.hosts.join(', ')}`);
  lines.push(`  locale: ${report.locale}`);
  lines.push(`  teamRules: ${report.teamRules}`);
  lines.push('');
  for (const file of report.files) {
    lines.push(`  ${ACTION_LINE[file.action](file)}`);
  }

  const RECORD_LINE: Record<AddAgentRulesReport['hostsRecord'], string | null> = {
    created: 'toolkit.config.json: aiHosts recorded (file created)',
    updated: 'toolkit.config.json: aiHosts recorded',
    unchanged: 'toolkit.config.json: aiHosts already recorded',
    unrecognized: 'toolkit.config.json: not a JSON object — aiHosts not recorded (fix the file, then rerun)',
    'not-applied': 'toolkit.config.json: aiHosts not recorded — a file above was not written',
    'not-requested': null,
  };
  const recordLine = RECORD_LINE[report.hostsRecord];
  if (recordLine !== null) lines.push(`  ${recordLine}`);

  if (report.files.some((file) => file.action === 'unrecognized')) {
    lines.push('');
    lines.push('Manual fix needed: keep exactly one "<!-- nx-archweave:agent-rules start -->" … "<!-- nx-archweave:agent-rules end -->"');
    lines.push('pair in the file (or remove both markers), then rerun add-agent-rules.');
  }

  if (report.dryRun) {
    lines.push('');
    lines.push('Generated content preview:');
    for (const file of report.files) {
      if (file.content === null) continue;
      lines.push('');
      lines.push(`--- ${file.filePath} ---`);
      lines.push(file.content);
    }
  }

  return lines.join('\n');
}
