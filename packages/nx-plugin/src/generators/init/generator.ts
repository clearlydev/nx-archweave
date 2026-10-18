import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GeneratorCallback, Tree } from '@nx/devkit';
import { buildPresetConfig } from '@nx-archweave/template-engine';
import { runAddFsdLite } from '../add-fsd-lite/generator.ts';
import { runAddAgentRules } from '../add-agent-rules/generator.ts';
import { runAddGithubTemplates } from '../add-github-templates/generator.ts';
import { recordedReview, runAddReview } from '../add-review/generator.ts';
import { runAddBackend } from '../add-backend/generator.ts';
import type { InitGeneratorSchema } from './schema.d.ts';
import { renderInitReport, type InitConfigOutcome, type InitReport, type InitSection } from './render.ts';
import { createProcessExec, runPostInitValidation } from './validation.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import {
  detectIndent,
  readToolkitConfigFile,
  recordedChoice,
  RECORDED_BACKENDS,
  RECORDED_FRONTENDS,
  RECORDED_PACKAGE_MANAGERS,
  RECORDED_PRESETS,
  resolveAiHostsOption,
  resolveInitFrontend,
  resolveLocaleOption,
  TOOLKIT_CONFIG_PATH,
  treePackageManager,
} from '../shared/toolkit-config-file.ts';

export interface InitDeps {
  isWorkingTreeClean(root: string): boolean;
}

/**
 * Record the preset choices whose sub-generators do not
 * persist them (`fsd.enforcement`, `agentRules.teamRules`) so a bare standalone rerun on
 * this workspace resolves the same values instead of silently degrading to the defaults.
 * Same contract as add-review's / add-backend's config writes: merge-preserving (unrelated
 * keys and sibling keys under `fsd` / `agentRules` survive), indent-preserving, idempotent,
 * and a file that is not a JSON object is never rewritten — reported as 'unrecognized'.
 */
function recordPresetChoices(
  tree: Tree,
  choices: {
    locale?: 'ko' | 'en';
    preset?: (typeof RECORDED_PRESETS)[number];
    frontend?: (typeof RECORDED_FRONTENDS)[number];
    packageManager?: (typeof RECORDED_PACKAGE_MANAGERS)[number];
    enforcement?: string;
    teamRules?: boolean;
    aiHosts?: string[];
  },
  notRecorded: InitConfigOutcome['notRecorded'],
  write: boolean,
): InitConfigOutcome {
  const fields: string[] = [];
  const topLevel = (['locale', 'preset', 'frontend', 'packageManager'] as const).filter((key) => choices[key] !== undefined);
  fields.push(...topLevel);
  if (choices.enforcement !== undefined) fields.push('fsd.enforcement');
  if (choices.teamRules !== undefined) fields.push('agentRules.teamRules');
  if (choices.aiHosts !== undefined) fields.push('aiHosts');
  if (fields.length === 0) return { action: 'skipped', fields, notRecorded };

  const { raw, parsed } = readToolkitConfigFile(tree);
  if (raw !== null && parsed === null) return { action: 'unrecognized', fields, notRecorded };
  const existing: Record<string, unknown> = parsed ?? {};

  const asObject = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...existing };
  let changed = false;
  for (const key of topLevel) {
    if (existing[key] !== choices[key]) {
      next[key] = choices[key];
      changed = true;
    }
  }
  if (choices.enforcement !== undefined) {
    const fsd = asObject(existing['fsd']);
    if (fsd['enforcement'] !== choices.enforcement) {
      next['fsd'] = { ...fsd, enforcement: choices.enforcement };
      changed = true;
    }
  }
  if (choices.teamRules !== undefined) {
    const agentRules = asObject(existing['agentRules']);
    if (agentRules['teamRules'] !== choices.teamRules) {
      next['agentRules'] = { ...agentRules, teamRules: choices.teamRules };
      changed = true;
    }
  }
  if (choices.aiHosts !== undefined) {
    const recorded = existing['aiHosts'];
    if (!Array.isArray(recorded) || recorded.join('\u0000') !== choices.aiHosts.join('\u0000')) {
      next['aiHosts'] = [...choices.aiHosts];
      changed = true;
    }
  }
  if (!changed) return { action: 'unchanged', fields, notRecorded };

  if (write) {
    const indent = raw === null ? '  ' : detectIndent(raw);
    const trailingNewline = raw === null || raw.endsWith('\n');
    const body = JSON.stringify(next, null, indent);
    tree.write(TOOLKIT_CONFIG_PATH, trailingNewline ? `${body}\n` : body);
  }
  return { action: raw === null ? 'created' : 'updated', fields, notRecorded };
}

/** The recorded review provider, kept unless this run's --aiHosts changes the first AI host
 * (the provider's default follows that host — a new first host re-derives it). */
function keptReviewProvider(option: InitGeneratorSchema['aiHosts'], config: Record<string, unknown> | null) {
  const recordedHosts = resolveAiHostsOption(undefined, config);
  const hosts = resolveAiHostsOption(option, config);
  return hosts[0] === recordedHosts[0] ? recordedReview(config).provider : undefined;
}

/**
 * Orchestration core: dependency-injected so tests never shell out to
 * git. Always returns successfully — mirroring the other four `run*` cores, a dirty tree
 * or an aborted sub-section is reported, never thrown.
 */
export function runInit(tree: Tree, options: InitGeneratorSchema, deps: InitDeps): InitReport {
  // What init recorded last time fills in what this run does not pass, so a standalone rerun
  // keeps the workspace's choices; everything resolved here is recorded again below.
  const recorded = readToolkitConfigFile(tree).parsed;
  const preset = options.preset ?? recordedChoice(recorded, 'preset', RECORDED_PRESETS);
  if (preset === undefined) {
    // Missing input, like a missing required flag — not a precondition this run reports.
    throw new Error('init: pass --preset=quick-start|solo|team (toolkit.config.json records none).');
  }
  const frontend = resolveInitFrontend(options.frontend, recorded);
  // option > the recorded backend (add-backend records it) > none: a bare rerun keeps it.
  const backend = options.backend ?? recordedChoice(recorded, 'backend', RECORDED_BACKENDS) ?? 'none';
  if (frontend === 'none' && backend === 'none') {
    throw new Error('init: --frontend=none is a backend-only workspace — pass --backend=express|nest.');
  }
  const dryRun = options.dryRun ?? false;
  // option > toolkit.config.json's locale > en: every later generator (slices, templates,
  // agent rules) resolves the recorded one.
  const locale = resolveLocaleOption(options.locale, recorded);

  // dryRun never writes anything either way, so the clean-tree precondition
  // (which exists to guarantee a `git restore .` rollback story) doesn't apply to it.
  // allowDirty is the explicit opt-out for orchestrators whose own preceding step
  // dirties the tree (create-nx-archweave installs this plugin right before init);
  // the report then warns that the rollback command covers more than this run.
  const allowDirty = options.allowDirty ?? false;
  const cleanTree = dryRun ? true : deps.isWorkingTreeClean(tree.root);
  if (!cleanTree && !allowDirty) {
    return { preset, frontend, backend, dryRun, cleanTree: false, allowDirty, refused: true, sections: [] };
  }

  // Explicit option > detection > recorded > pnpm. The CLI always passes
  // the flag; a standalone `nx g init` reads the workspace's own files.
  const knownPackageManager = options.packageManager ?? treePackageManager(tree, recorded);
  const packageManager = knownPackageManager ?? 'pnpm';
  const config = buildPresetConfig({
    preset,
    frontend,
    backend,
    locale,
    packageManager,
    reviewEnabled: options.review,
    // option > toolkit.config.json's aiHosts > Claude Code: a standalone `nx g init` on a
    // workspace set up for other hosts keeps them (and their review provider).
    aiHosts: resolveAiHostsOption(options.aiHosts, recorded),
    // option > the recorded review.provider (unless --aiHosts changes the first host) > the
    // first AI host's: a bare rerun keeps it.
    reviewProvider: options.reviewProvider ?? keptReviewProvider(options.aiHosts, recorded),
  });

  const sections: InitSection[] = [];

  // A backend-only workspace has no frontend for FSD to structure, whatever --fsd says.
  const fsdEnabled = frontend !== 'none' && (options.fsd ?? config.fsd.enabled);
  if (fsdEnabled) {
    // Fold any raw throw into an aborted-style
    // section instead of letting it kill the rest of the pipeline.
    try {
      // The preset's enforcement rides through as the option;
      // applyEslint as for add-backend: the create CLI passes true on a workspace it just made.
      const report = runAddFsdLite(tree, { frontend, locale, dryRun, enforcement: config.fsd.enforcement, applyEslint: options.applyEslint ?? false });
      sections.push({ id: 'fsd', enabled: true, report: { kind: 'fsd', report } });
    } catch (error) {
      sections.push({
        id: 'fsd',
        enabled: true,
        report: null,
        thrownError: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    sections.push({ id: 'fsd', enabled: false, report: null });
  }

  const agentRulesEnabled = options.agentRules ?? true;
  if (agentRulesEnabled) {
    const report = runAddAgentRules(
      tree,
      {
        hosts: config.aiHosts,
        teamRules: config.agentRules.teamRules,
        locale,
        dryRun,
      },
      // init records aiHosts below, with its other choices; the FSD section follows this run's
      // frontend axis
      { recordHosts: false, fsdStructure: fsdEnabled },
    );
    sections.push({ id: 'agentRules', enabled: true, report: { kind: 'agentRules', report } });
  } else {
    sections.push({ id: 'agentRules', enabled: false, report: null });
  }

  const githubTemplatesEnabled = options.githubTemplates ?? true;
  if (githubTemplatesEnabled) {
    const report = runAddGithubTemplates(tree, {
      issue: config.githubTemplates.issue,
      pr: config.githubTemplates.pr,
      codeowners: config.githubTemplates.codeowners,
      locale,
      dryRun,
    });
    sections.push({ id: 'githubTemplates', enabled: true, report: { kind: 'githubTemplates', report } });
  } else {
    sections.push({ id: 'githubTemplates', enabled: false, report: null });
  }

  // Backend section: enabled purely by the axis value;
  // applyEslint is forwarded from the caller (the create CLI passes true on
  // workspaces it just created).
  if (config.backend !== 'none') {
    const report = runAddBackend(tree, {
      backend: config.backend,
      applyEslint: options.applyEslint ?? false,
      dryRun,
    });
    sections.push({ id: 'backend', enabled: true, report: { kind: 'backend', report } });
  } else {
    sections.push({ id: 'backend', enabled: false, report: null });
  }

  if (config.review.enabled) {
    const report = runAddReview(tree, {
      mode: config.review.mode,
      locale,
      maxRounds: config.review.maxRounds,
      packageManager, // the resolved value reaches the workflow
      dryRun,
      // The first AI host's provider — buildPresetConfig
      // resolved it; claude when no host was picked.
      provider: config.review.provider,
    });
    sections.push({ id: 'review', enabled: true, report: { kind: 'review', report } });
  } else {
    sections.push({ id: 'review', enabled: false, report: null });
  }

  // Record only what was actually applied: an aborted fsd section or an agent-rules file
  // whose markers could not be placed means the workspace does not carry that choice yet,
  // so the config must not claim it does (same atomicity reading as add-review's config rule).
  const fsdSection = sections.find((s) => s.id === 'fsd');
  const fsdRan = fsdSection?.enabled === true;
  const fsdApplied = fsdSection?.report?.kind === 'fsd' && !fsdSection.report.report.aborted;
  const agentRulesSection = sections.find((s) => s.id === 'agentRules');
  const agentRulesRan = agentRulesSection?.enabled === true;
  const agentRulesApplied =
    agentRulesSection?.report?.kind === 'agentRules' &&
    agentRulesSection.report.report.files.every((f) => f.action !== 'unrecognized');
  const reviewSection = sections.find((s) => s.id === 'review');
  const reviewApplied =
    reviewSection?.report?.kind === 'review' && ['created', 'updated', 'unchanged'].includes(reviewSection.report.report.configAction);
  // The workspace's language is recorded with the other choices — once a section that
  // carries one applied (fsd, agent rules, or review, whose field is already in the file).
  // GitHub templates alone record nothing: init then has no other choice to record, and a
  // templates-only run (every other section turned off) keeps writing just the templates.
  const anyChoiceApplied = fsdApplied || agentRulesApplied || reviewApplied;
  const notRecorded: InitConfigOutcome['notRecorded'] = [];
  if (fsdRan && !fsdApplied) {
    notRecorded.push({ field: 'fsd.enforcement', rerun: `add-fsd-lite --enforcement=${config.fsd.enforcement}` });
  }
  if (agentRulesRan && !agentRulesApplied) {
    notRecorded.push({
      field: 'agentRules.teamRules',
      rerun: config.agentRules.teamRules ? 'add-agent-rules --teamRules' : 'add-agent-rules --teamRules=false',
    });
    notRecorded.push({ field: 'aiHosts', rerun: `add-agent-rules --hosts=${config.aiHosts.join(',')}` });
  }
  const configOutcome = recordPresetChoices(
    tree,
    {
      // Every later generator (slices, templates, agent rules, review) reads locale; a bare
      // rerun of init or add-fsd-lite reads preset / frontend; packageManager backs up
      // lockfile detection.
      locale: anyChoiceApplied ? locale : undefined,
      preset: anyChoiceApplied ? preset : undefined,
      frontend: anyChoiceApplied ? frontend : undefined,
      // Never the blind pnpm guess: recording it would silence add-review's "could not be
      // detected" note later. Only a flag, a lockfile or an earlier record is recorded.
      packageManager: anyChoiceApplied && knownPackageManager !== null ? knownPackageManager : undefined,
      enforcement: fsdApplied ? config.fsd.enforcement : undefined,
      teamRules: agentRulesApplied ? config.agentRules.teamRules : undefined,
      aiHosts: agentRulesApplied ? config.aiHosts : undefined,
    },
    notRecorded,
    !dryRun,
  );

  return {
    preset,
    frontend,
    backend,
    packageManager,
    dryRun,
    cleanTree,
    allowDirty,
    refused: false,
    sections,
    config: configOutcome,
  };
}

/** Real `isWorkingTreeClean`: a failed git invocation (not a repo, git missing, ...) is
 * treated as NOT clean — the safer default — with a distinct console note explaining why,
 * separate from `runInit`'s own dirty-tree refusal report. */
function gitIsWorkingTreeClean(root: string): boolean {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' });
    return output.trim().length === 0;
  } catch (error) {
    console.warn(
      'init: could not determine the working tree status (the git command failed) — treating it as dirty for safety.',
    );
    if (error instanceof Error) console.warn(`  ${error.message}`);
    return false;
  }
}

/** Workflow files (relative to `tree.root`) this run actually wrote — the only sub-call
 * that ever touches `.github/workflows/*.yml` is add-review's. Used to scope the
 * post-flush actionlint validation to files this run is responsible for, not every
 * workflow file that happens to already exist. */
function collectWrittenWorkflowPaths(report: InitReport): string[] {
  const paths: string[] = [];
  for (const section of report.sections) {
    if (section.report?.kind !== 'review') continue;
    const { workflowAction, workflowPath } = section.report.report;
    if (workflowAction === 'created' || workflowAction === 'overwritten' || workflowAction === 'alternate') {
      paths.push(workflowPath);
    }
  }
  return paths;
}

/** Nx calls this with `(tree, options)` only; `deps` exists so a test can prove what the
 * entry point does with the git check (e.g. that a dry run never invokes it). */
export async function initGenerator(
  tree: Tree,
  options: InitGeneratorSchema,
  deps: InitDeps = { isWorkingTreeClean: gitIsWorkingTreeClean },
): Promise<GeneratorCallback | void> {
  // A delta, not an absolute count: a real `Tree` normally starts a generator run with
  // zero pending changes, but nothing here assumes that — comparing against the count
  // measured just before `runInit` is what actually answers "did THIS run write
  // anything".
  const changesBefore = tree.listChanges().length;
  const report = runInit(tree, { ...options, dryRun: resolveDryRun(options) }, deps);
  console.log(renderInitReport(report));

  if (report.dryRun || report.refused) return;
  if (tree.listChanges().length === changesBefore) return;

  const workflowPaths = collectWrittenWorkflowPaths(report);
  const root = tree.root;
  const graphOutputFile = join(tmpdir(), `nx-archweave-init-graph-${Date.now()}.json`);

  return () => {
    runPostInitValidation({ root, workflowPaths, graphOutputFile }, createProcessExec());
  };
}

export default initGenerator;
