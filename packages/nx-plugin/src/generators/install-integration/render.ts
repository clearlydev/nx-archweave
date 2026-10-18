import type {
  DeclareEnabledIntegrationAction,
  IntegrationInstallScope,
  ClaudePluginInstallDetail,
} from '@nx-archweave/integrations';
import type { RecordPipelineOutcome } from '../shared/record-pipeline.ts';

/** What the live pre-install check found. */
export type InstallCurrentState =
  | { kind: 'absent' }
  | { kind: 'already-installed'; version?: string; scope: string }
  | { kind: 'installed-other-scope'; installedScope: string }
  | { kind: 'disabled' }
  | { kind: 'ambiguous' }
  | { kind: 'cli-not-found' }
  | { kind: 'cli-error'; reason: string };

export type InstallDeclaration =
  | { action: DeclareEnabledIntegrationAction }
  | { action: 'write-failed'; message: string };

export interface InstallIntegrationView {
  tool: string;
  target: string;
  scope: IntegrationInstallScope;
  /** True unless --apply was given (and Nx's --dry-run was not). */
  preview: boolean;
  applyIgnoredForNxDryRun: boolean;
  sourceRepository: string;
  officialHomepage: string;
  license: string;
  /** --versionRange, shown as requested-but-not-enforced; null when not given. */
  requestedVersion: string | null;
  /** Files Claude Code changes inside the workspace for this scope. */
  workspaceFiles: string[];
  /** The official command as a person would type it. */
  command: string;
  /** The command that applies this exact request (carries --scope). */
  rerunCommand: string;
  currentState: InstallCurrentState;
  /** Set only when the official command was run. */
  install: { detail: ClaudePluginInstallDetail; manualStepsRemaining: string[] } | null;
  /** Set when the verify → record pipeline ran. */
  record: Omit<RecordPipelineOutcome, 'verificationSource'> | null;
  /** Set when a toolkit.config.json declaration was attempted (only after a recordable verification). */
  declaration: InstallDeclaration | null;
  /** Project scope: Claude Code's command declaring the marketplace in the workspace's.
   * claude/settings.json; detail is set once it ran. Null when nothing is declared. */
  teamMarketplace: { command: string; detail: ClaudePluginInstallDetail | null } | null;
  /** Next steps for the person, printed verbatim in order. */
  guidance: string[];
}

function describeState(state: InstallCurrentState): string {
  switch (state.kind) {
    case 'absent':
      return 'not installed';
    case 'already-installed':
      return `already installed and enabled at ${state.scope} scope${state.version ? ` (version ${state.version})` : ''}`;
    case 'installed-other-scope':
      return `installed and enabled, but at ${state.installedScope} scope`;
    case 'disabled':
      return 'installed but disabled';
    case 'ambiguous':
      return 'more than one installed plugin matches exactly';
    case 'cli-not-found':
      return 'unknown — the claude CLI was not found';
    case 'cli-error':
      return `unknown — the claude CLI could not list plugins (${state.reason})`;
  }
}

function describeInstall(detail: ClaudePluginInstallDetail): string {
  switch (detail.kind) {
    case 'executed':
      return 'the official command exited successfully';
    case 'manual-only':
      return 'no scriptable command exists for this target — nothing was executed';
    case 'cli-not-found':
      return 'not executed — the claude CLI was not found';
    case 'failed-to-start':
      return `not executed — the claude CLI could not be started (${detail.code})`;
    case 'cli-unsupported':
      return 'not executed — this claude CLI does not support scriptable plugin install';
    case 'confirmation-required':
      return 'stopped — the marketplace declares a command that a person must confirm';
    case 'failed':
      return `failed${detail.failureCode ? ` (${detail.failureCode})` : ''}`;
    case 'timeout':
      return 'stopped — the command timed out';
    case 'output-too-large':
      return 'stopped — the command produced too much output';
  }
}

function describeDeclaration(declaration: InstallDeclaration, tool: string, preview: boolean): string {
  switch (declaration.action) {
    case 'updated':
      return `toolkit.config.json: "${tool}" ${preview ? 'would be added' : 'added'} to integrations.enabled`;
    case 'unchanged':
      return `toolkit.config.json: "${tool}" is already declared in integrations.enabled (unchanged)`;
    case 'no-config':
      return (
        `toolkit.config.json: not declared — this workspace has no toolkit.config.json (it was not set up with init). ` +
        `Add "${tool}" to integrations.enabled there if you want doctor to track the declaration.`
      );
    case 'unrecognized':
      return (
        'toolkit.config.json: not updated — the file is not in a shape nx-archweave recognizes, so it was left alone. ' +
        `Add "${tool}" to integrations.enabled by hand.`
      );
    case 'write-failed':
      return `toolkit.config.json: not updated — writing it failed (${declaration.message}). Add "${tool}" to integrations.enabled by hand.`;
  }
}

// Every value here is a tool id, a URL, a command, a classification, a manifest
// entry (installPath excluded by construction) or a
// CLI message that was home-path-redacted where it was produced (install.ts).
export function renderInstallIntegrationView(view: InstallIntegrationView): string {
  const lines: string[] = [
    `Integration: ${view.tool} (a separate project — nx-archweave only runs its official installer)`,
    `Source repository: ${view.sourceRepository}`,
    `Official homepage: ${view.officialHomepage}`,
    `License: ${view.license}`,
    view.requestedVersion === null
      ? 'Version: latest (decided by the marketplace) — the version actually installed is the one recorded'
      : `Requested version: ${view.requestedVersion} (not enforced — the marketplace decides; the version actually installed is the one recorded)`,
    `Target: ${view.target}`,
    `Scope: ${view.scope}`,
    `Official command: ${view.command}`,
    ...(view.teamMarketplace
      ? [`For teammates (project scope), the marketplace is declared in .claude/settings.json first: ${view.teamMarketplace.command}`]
      : []),
    ...(view.workspaceFiles.length > 0 ? [`Claude Code will update in this workspace: ${view.workspaceFiles.join(', ')}`] : []),
    `Current state: ${describeState(view.currentState)}`,
  ];

  if (view.applyIgnoredForNxDryRun) {
    lines.push("Note: --apply was ignored because Nx's --dry-run is set.");
  }

  if (view.preview && view.currentState.kind === 'absent') {
    lines.push('', ...(view.teamMarketplace ? [`Would run: ${view.teamMarketplace.command}`] : []), `Would run: ${view.command}`, `To run it: ${view.rerunCommand}`);
  } else if (view.preview && view.teamMarketplace) {
    lines.push('', `Would run: ${view.teamMarketplace.command}`, `To run it: ${view.rerunCommand}`);
  }

  if (view.teamMarketplace?.detail) {
    const { detail } = view.teamMarketplace;
    lines.push(
      '',
      detail.kind === 'executed'
        ? 'Marketplace: declared in .claude/settings.json (extraKnownMarketplaces) — teammates get its source from the committed file'
        : `Marketplace declaration: ${describeInstall(detail)}${detail.kind === 'failed' ? ` — ${detail.message}` : ''}`,
    );
  }

  if (view.install) {
    lines.push('', `Install: ${describeInstall(view.install.detail)}`);
  }

  if (view.record) {
    const { record } = view;
    lines.push(
      '',
      `Verification: ${record.verification.verified ? 'passed' : 'not verified'}`,
      ...record.verification.problems.map((problem) => `  ! ${problem}`),
    );
    if (record.hasConflict && record.existingEntry) {
      lines.push(
        'Conflict: an existing manifest entry differs from what was verified now — the fresh result replaces it.',
        `  Existing: ${JSON.stringify(record.existingEntry)}`,
        `  Verified: ${JSON.stringify(record.proposedEntry)}`,
      );
    }
    const installKind = view.install?.detail.kind;
    if (record.proposedEntry) {
      if (installKind !== undefined && installKind !== 'executed') {
        lines.push(
          `The install command reported ${installKind}, but a fresh check shows the plugin installed and enabled.`,
        );
      }
      lines.push(
        record.wasWritten
          ? 'Recorded — the following manifest entry was written to archweave-integrations.json:'
          : 'archweave-integrations.json would get this entry:',
        `  ${JSON.stringify(record.proposedEntry)}`,
      );
    } else if (installKind === 'executed') {
      lines.push('The install command exited 0, but the fresh verification did not confirm the plugin — nothing was written.');
    } else {
      lines.push('Nothing was written — verification did not succeed via the authoritative claude-cli signal.');
    }
  }

  if (view.declaration) {
    lines.push(describeDeclaration(view.declaration, view.tool, view.preview));
  }

  if (view.guidance.length > 0) {
    lines.push('', 'Next steps:', ...view.guidance.map((step) => `  - ${step}`));
  }

  lines.push(
    '',
    view.preview
      ? '(preview — only read-only checks ran; nothing was installed and no file was written)'
      : '(applied — the lines above state exactly what was executed and written)',
  );
  return lines.join('\n');
}
