import type { ToolkitBackend, ToolkitFrontendChoice, ToolkitPreset } from '@nx-archweave/shared';
import { packageManagerCommands } from '@nx-archweave/template-engine';
import { renderAddFsdLiteReport, type AddFsdLiteReport } from '../add-fsd-lite/render.ts';
import { renderAddAgentRulesReport, type AddAgentRulesReport } from '../add-agent-rules/render.ts';
import { renderAddGithubTemplatesReport, type AddGithubTemplatesReport } from '../add-github-templates/render.ts';
import { renderAddReviewReport, type AddReviewReport } from '../add-review/render.ts';
import { renderAddBackendBody, type AddBackendReport } from '../add-backend/render.ts';
import { leftForYou, renderLeftForYou } from './left-for-you.ts';

export type InitSectionId = 'fsd' | 'agentRules' | 'githubTemplates' | 'review' | 'backend';

/** Tagged union over the four sub-generators' own report shapes — render.ts composes
 * their existing render functions rather than re-describing their
 * content here. */
export type InitSectionReport =
  | { kind: 'fsd'; report: AddFsdLiteReport }
  | { kind: 'agentRules'; report: AddAgentRulesReport }
  | { kind: 'githubTemplates'; report: AddGithubTemplatesReport }
  | { kind: 'review'; report: AddReviewReport }
  | { kind: 'backend'; report: AddBackendReport };

export interface InitSection {
  id: InitSectionId;
  enabled: boolean;
  /** null when the section is disabled for this run. */
  report: InitSectionReport | null;
  /** Set only for a disabled 'review' section: the review files already in the workspace,
   * which init leaves as they are (turning review off never removes them). */
  keptFiles?: string[];
  /** Set only for the 'fsd' section when `runAddFsdLite` threw — the raw throw is caught
   * and folded into an aborted-style section instead of failing the whole run, so the
   * rest of the pipeline still gets a chance to proceed. */
  thrownError?: string;
}

export type InitConfigAction = 'created' | 'updated' | 'unchanged' | 'unrecognized' | 'skipped';

/** Init records the preset choices its sub-generators do not
 * persist themselves (`fsd.enforcement`, `agentRules.teamRules`) so a bare standalone rerun
 * resolves the same values. `fields` lists what this run recorded (or would have);
 * 'unrecognized' = toolkit.config.json is not a JSON object and was left untouched;
 * 'skipped' = nothing was eligible (both sections off or not applied). */
export interface InitConfigOutcome {
  action: InitConfigAction;
  fields: string[];
  /** Fields whose section ran but did not apply cleanly this run (aborted, or an alternate
   * file was written), so the choice is deliberately NOT recorded — with the standalone
   * rerun that records it once the workspace is resolved. */
  notRecorded: { field: string; rerun: string }[];
}

export interface InitReport {
  preset: ToolkitPreset;
  frontend: ToolkitFrontendChoice;
  /** 'none' keeps the header identical to the frontend-only era (silence guarantee). */
  backend: ToolkitBackend;
  dryRun: boolean;
  /** True when the working tree was clean, or the check was skipped because dryRun never
   * writes anything either way. False alongside `refused: true`, or alongside
   * `allowDirty: true` when the opt-out let a dirty-tree run proceed anyway. */
  cleanTree: boolean;
  /** True when the caller explicitly opted out of the clean-tree refusal (`--allowDirty`).
   * When the tree was in fact dirty, the report warns that restoring a modified file also reverts
   * the pre-existing changes. */
  allowDirty?: boolean;
  /** True when the caller says the uncommitted changes are its own preceding step's (the create
   * CLI's plugin install), so there are no earlier user changes to warn about. Only the note
   * reads it; the refusal never does. */
  dirtyFromCaller?: boolean;
  /** Resolved package manager (option > detection > pnpm) — absent on a
   * refused run, where nothing was resolved. Rendered only in the "record it with"
   * commands; otherwise carried for callers and tests. */
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
  /** True when the run was refused outright because the (non-dryRun) tree was dirty —
   * `sections` is empty in that case. */
  refused: boolean;
  /** On a refused run, the uncommitted files `git status` listed; absent when git could
   * not be run. */
  dirtyFiles?: string[];
  sections: InitSection[];
  /** Absent on a refused run. */
  config?: InitConfigOutcome;
  /** What this run wrote, for the rollback guidance. Absent on a dry or refused run. */
  written?: { created: string[]; modified: string[] };
}

const SECTION_TITLES: Record<InitSectionId, string> = {
  fsd: 'add-fsd-lite',
  agentRules: 'add-agent-rules',
  githubTemplates: 'add-github-templates',
  review: 'add-review',
  backend: 'add-backend',
};

function renderSectionReport(report: InitSectionReport): string {
  switch (report.kind) {
    case 'fsd':
      return renderAddFsdLiteReport(report.report);
    case 'agentRules':
      return renderAddAgentRulesReport(report.report);
    case 'githubTemplates':
      return renderAddGithubTemplatesReport(report.report);
    case 'review':
      return renderAddReviewReport(report.report);
    case 'backend':
      return renderAddBackendBody(report.report);
  }
}

/** Whether a section left the run half applied — i.e. it aborted outright, so the user may
 * want the rollback guidance. Sections that merely proposed/skipped a file (no
 * write happened) do not count: there is nothing of theirs to roll back. */
function sectionAborted(section: InitSection): boolean {
  if (section.thrownError !== undefined) return true;
  if (section.report === null) return false;
  if (section.report.kind === 'fsd') return section.report.report.aborted;
  if (section.report.kind === 'review') return section.report.report.workflowAction === 'aborted';
  if (section.report.kind === 'backend') return section.report.report.refused !== undefined;
  return false;
}

/** The sections that aborted or were refused, by generator name — what makes init fail. A
 * toolkit.config.json that is not a JSON object counts too: init could not record its choices,
 * and the generators run later (slices, reruns) resolve the frontend and locale from it. */
export function failedSections(report: InitReport): string[] {
  const failed = report.sections.filter(sectionAborted).map((section) => SECTION_TITLES[section.id]);
  return report.config?.action === 'unrecognized' ? [...failed, 'toolkit.config.json'] : failed;
}

export function renderInitReport(report: InitReport): string {
  const lines: string[] = [];
  const backendSuffix = report.backend === 'none' ? '' : `, backend: ${report.backend}`;
  const header = `init (preset: ${report.preset}, frontend: ${report.frontend}${backendSuffix})`;
  lines.push(report.dryRun ? `${header} — dry run` : header);
  if (report.preset === 'solo') {
    lines.push('Note: solo is now an alias of quick-start — AI PR review stays off unless you pass --review.');
  }

  if (report.refused) {
    lines.push('', ...renderRefusal(report.dirtyFiles));
    return lines.join('\n');
  }

  for (const section of report.sections) {
    // backend 'none' must leave the output byte-identical to the frontend-only
    // era (silence guarantee) — a disabled backend section is omitted
    // entirely, not shown as skipped.
    if (section.id === 'backend' && !section.enabled) continue;
    lines.push('');
    lines.push(`## ${SECTION_TITLES[section.id]}`);
    if (!section.enabled) {
      lines.push(
        section.id === 'fsd' && report.frontend === 'none'
          ? '  skipped (backend-only workspace — no frontend to structure)'
          : '  skipped (disabled for this run)',
      );
      if (section.keptFiles !== undefined && section.keptFiles.length > 0) {
        lines.push(`  Kept as they are: ${section.keptFiles.join(', ')}. To update them, run add-review.`);
      }
      continue;
    }
    if (section.thrownError !== undefined) {
      lines.push(`  aborted — unexpected error: ${section.thrownError}`);
      lines.push('  Nothing was written for this section. Rerun add-fsd-lite directly once resolved.');
      continue;
    }
    if (section.report !== null) {
      lines.push(renderSectionReport(section.report));
    }
  }

  if (report.config !== undefined && (report.config.action !== 'skipped' || report.config.notRecorded.length > 0)) {
    lines.push('');
    lines.push('## toolkit.config.json');
    const fieldList = report.config.fields.join(', ');
    switch (report.config.action) {
      case 'created':
      case 'updated':
        lines.push(`  ${report.dryRun ? 'would record' : 'recorded'} ${fieldList} (${report.config.action})`);
        break;
      case 'unchanged':
        lines.push(`  already records ${fieldList} (unchanged)`);
        break;
      case 'unrecognized':
        lines.push(`  aborted — the file is not a JSON object, so init left it alone (it never rewrites a shape it`);
        lines.push(`  does not recognize) and could not record ${fieldList}. The generators you run next read`);
        lines.push('  them from here: make the file a JSON object (or delete it), then rerun init.');
        break;
      case 'skipped':
        break;
    }
    if (report.config.notRecorded.length > 0) {
      lines.push(`  not recorded: ${report.config.notRecorded.map((n) => n.field).join(', ')} — that section did not apply cleanly`);
      lines.push('  this run (aborted, or written as an alternate file). Once resolved, record it with:');
      const runNx = packageManagerCommands(report.packageManager ?? 'pnpm').runNx;
      for (const entry of report.config.notRecorded) lines.push(`    ${runNx} g @clearlydev/nx-archweave:${entry.rerun}`);
    }
  }

  const ranDirty = report.allowDirty === true && !report.cleanTree && !report.dryRun;
  if (ranDirty && report.dirtyFromCaller !== true) {
    lines.push('');
    lines.push('Note: --allowDirty was set and the working tree already had uncommitted changes —');
    lines.push('restoring the files this run modified also reverts your earlier changes to them.');
  }

  const hadAbort = failedSections(report).length > 0;
  if (!report.dryRun && hadAbort) {
    lines.push('');
    lines.push('One or more sections aborted. To undo what this run wrote:');
    const written = report.written ?? { created: [], modified: [] };
    if (written.modified.length > 0) {
      lines.push(`  git restore -- ${written.modified.join(' ')}`);
      if (ranDirty) lines.push('  (--allowDirty: this also reverts the uncommitted changes those files already had.)');
    }
    if (written.created.length > 0) {
      lines.push('  Created by this run (untracked — delete them yourself; `git clean -n` lists them):');
      for (const path of written.created) lines.push(`    ${path}`);
    }
  }

  lines.push(...renderLeftForYou(leftForYou(report)));

  return lines.join('\n');
}

const SHOWN_DIRTY_FILES = 20;
const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb']);

/** The dirty-tree refusal: which files are uncommitted and the two ways forward. Only the plugin
 * install's own files get a command to copy: anything else may hold a file that must not be
 * committed (an untracked .env), so the user checks it first. */
function renderRefusal(dirtyFiles: string[] | undefined): string[] {
  const lines = ['Refused: the working tree has uncommitted changes.'];
  lines.push('  init only runs against a clean working tree, so a partial run can be rolled back exactly');
  if (dirtyFiles === undefined || dirtyFiles.length === 0) {
    lines.push('  to what was committed — commit or stash your changes, then rerun.');
  } else {
    lines.push('  to what was committed. Uncommitted:');
    for (const path of dirtyFiles.slice(0, SHOWN_DIRTY_FILES)) lines.push(`    ${path}`);
    if (dirtyFiles.length > SHOWN_DIRTY_FILES) lines.push(`    … and ${dirtyFiles.length - SHOWN_DIRTY_FILES} more`);
    // Right after `add -D @clearlydev/nx-archweave`, only the manifest and the lockfile changed.
    const pluginInstall = dirtyFiles.includes('package.json') && dirtyFiles.every((path) => path === 'package.json' || LOCKFILES.has(path));
    if (pluginInstall) {
      lines.push('  These are the plugin install. Commit them, then rerun init:');
      lines.push(`    git add ${dirtyFiles.join(' ')} && git commit -m "chore: add @clearlydev/nx-archweave"`);
    } else {
      lines.push('  Check them with `git status`, then commit or stash them, and rerun init.');
    }
  }
  lines.push('  Or pass --allowDirty to run anyway: restoring a file this run modifies then also reverts');
  lines.push('  the changes you had made to it.');
  return lines;
}
