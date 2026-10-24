import type { Tree } from '@nx/devkit';
import { composeReviewSetup, judgeReviewFileConflict } from '@nx-archweave/template-engine';
import type { AddReviewGeneratorSchema } from './schema.d.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import { generatorFilesDir, renderTemplateFiles } from '../shared/template-files.ts';
import { treePackageManager } from '../shared/toolkit-config-file.ts';
import { applyJsonEdits } from '../shared/json-edit.ts';
import {
  renderAddReviewReport,
  renderLineDiff,
  type AddReviewReport,
  type ConfigAction,
  type DependabotAction,
  type WorkflowAction,
  DEPENDABOT_PATH,
} from './render.ts';

const CONFIG_PATH = 'toolkit.config.json';

/** Derives the alternate-filename path `--onConflict=alternate-filename` writes by
 * inserting `.archweave` before the extension of the *resolved* main workflow path —
 * e.g. `claude-code-review.yml` -> `claude-code-review.archweave.yml`,
 * `gemini-code-review.yml` -> `gemini-code-review.archweave.yml`. Mirrors the
 * derivation in the doctor layer (review-checks.ts's `deriveAltWorkflowPath`) so
 * both sides agree on the naming scheme without importing doctor code here. This
 * is a file *path* derivation, not workflow content.*/
function deriveAltWorkflowPath(mainWorkflowPath: string): string {
  return mainWorkflowPath.replace(/\.yml$/, '.archweave.yml');
}

interface ConfigState {
  raw: string | null;                        // null = file absent
  parsed: Record<string, unknown> | null;    // null = absent or unusable
  error: string | null;                      // non-null = unusable (abort)
}

function readConfig(tree: Tree): ConfigState {
  const raw = tree.read(CONFIG_PATH, 'utf-8');
  if (raw === null) return { raw: null, parsed: null, error: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { raw, parsed: null, error: `${CONFIG_PATH} must contain a top-level JSON object` };
    }
    return { raw, parsed: parsed as Record<string, unknown>, error: null };
  } catch {
    return { raw, parsed: null, error: `${CONFIG_PATH} is not valid JSON` };
  }
}

function resolveLocale(option: 'ko' | 'en' | undefined, config: ConfigState): 'ko' | 'en' {
  if (option) return option;
  const fromConfig = config.parsed?.['locale'];
  return fromConfig === 'ko' || fromConfig === 'en' ? fromConfig : 'en';
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => deepEqual(value, b[index]))
    );
  }
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) return false;
  return aKeys.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

const PROVIDERS = ['claude', 'gemini', 'gpt', 'cursor'] as const;
const MODES = ['fast', 'standard', 'thorough'] as const;

/** The review settings add-review / init recorded, each only when it is a known value. */
export function recordedReview(config: Record<string, unknown> | null): {
  provider?: (typeof PROVIDERS)[number];
  mode?: (typeof MODES)[number];
  maxRounds?: 1 | 2 | 3 | 4 | 5;
} {
  const review = config?.['review'];
  if (typeof review !== 'object' || review === null || Array.isArray(review)) return {};
  const record = review as Record<string, unknown>;
  const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
  const rounds = record['maxRounds'];
  return {
    provider: pick(record['provider'], PROVIDERS),
    mode: pick(record['mode'], MODES),
    maxRounds: rounds === 1 || rounds === 2 || rounds === 3 || rounds === 4 || rounds === 5 ? rounds : undefined,
  };
}

export function runAddReview(tree: Tree, options: AddReviewGeneratorSchema): AddReviewReport {
  const config = readConfig(tree);

  // Explicit option (threaded from init) > detection > the one init
  // recorded > pnpm. A blind fallback gets a report note — the user must know their
  // workflow was rendered for a guessed package manager.
  const detectedPm = treePackageManager(tree, config.parsed);
  const packageManager = options.packageManager ?? detectedPm ?? 'pnpm';
  const packageManagerNote =
    options.packageManager === undefined && detectedPm === null
      ? 'the package manager could not be detected (no pnpm, yarn, bun or npm lockfile) — the workflow was rendered for pnpm; re-run with --packageManager=npm|yarn|bun if that is wrong.'
      : undefined;
  // option > the recorded review settings > defaults: a bare rerun keeps the workspace's
  // provider, mode and rounds instead of resetting them (no schema defaults, for that reason).
  const recorded = recordedReview(config.parsed);
  const plan = composeReviewSetup({
    enabled: true,
    provider: options.provider ?? recorded.provider ?? 'claude',
    mode: options.mode ?? recorded.mode ?? 'standard',
    locale: resolveLocale(options.locale, config),
    maxRounds: options.maxRounds ?? recorded.maxRounds ?? 3,
    packageManager,
  });
  if (plan === null) throw new Error('unreachable: add-review always composes with enabled: true');

  if (config.error !== null) {
    // Atomicity invariant: an unusable config aborts the whole run.
    return {
      dryRun: options.dryRun ?? false,
      workflowPath: plan.workflowFilePath,
      workflowAction: 'aborted',
      configAction: 'aborted',
      requiredSecretName: plan.requiredSecretName,
      diff: null,
      workflowYaml: null,
      configSnippetJson: null,
      configError: config.error,
      dependabot: 'not-applied',
      dependabotProposal: null,
    };
  }

  const existing = tree.read(plan.workflowFilePath, 'utf-8');
  const verdict = judgeReviewFileConflict(existing, plan.workflowYaml);

  // Decide the workflow outcome and whether the main file ends this run matching the new options.
  let workflowAction: WorkflowAction;
  let workflowPath = plan.workflowFilePath;
  let writeWorkflowTo: string | null = null;
  let diff: string | null = null;
  let mainFileMatchesOptions: boolean;

  if (verdict.kind === 'create') {
    workflowAction = 'created';
    writeWorkflowTo = plan.workflowFilePath;
    mainFileMatchesOptions = true;
  } else if (verdict.kind === 'unchanged') {
    workflowAction = 'unchanged';
    mainFileMatchesOptions = true;
  } else {
    switch (options.onConflict) {
      case 'overwrite':
        workflowAction = 'overwritten';
        writeWorkflowTo = plan.workflowFilePath;
        mainFileMatchesOptions = true;
        break;
      case 'skip':
        workflowAction = 'skipped';
        mainFileMatchesOptions = false;
        break;
      case 'alternate-filename': {
        const altWorkflowPath = deriveAltWorkflowPath(plan.workflowFilePath);
        workflowAction = 'alternate';
        workflowPath = altWorkflowPath;
        writeWorkflowTo = altWorkflowPath;
        mainFileMatchesOptions = false;
        break;
      }
      default:
        workflowAction = 'proposed';
        diff = renderLineDiff(verdict.existing, verdict.generated);
        mainFileMatchesOptions = false;
    }
  }

  // Config outcome (atomicity invariant): update only when the main file matches.
  let configAction: ConfigAction;
  let newConfigContent: string | null = null;
  if (!mainFileMatchesOptions) {
    configAction = 'not-updated';
  } else {
    const existingReview = config.parsed?.['review'];
    if (deepEqual(existingReview, plan.configSnippet)) {
      configAction = 'unchanged';
    } else {
      configAction = config.raw === null ? 'created' : 'updated';
      newConfigContent = applyJsonEdits(config.raw, [[['review'], plan.configSnippet]]);
    }
  }

  const [dependabotFile] = renderTemplateFiles(generatorFilesDir('add-review', import.meta.url), '.github', {});
  const existingDependabot = tree.read(DEPENDABOT_PATH, 'utf-8');
  const dependabot: DependabotAction =
    existingDependabot === null ? 'created' : /github-actions/.test(existingDependabot) ? 'present' : 'proposed';

  const dryRun = options.dryRun ?? false;
  if (!dryRun) {
    if (writeWorkflowTo !== null) tree.write(writeWorkflowTo, plan.workflowYaml);
    if (newConfigContent !== null) tree.write(CONFIG_PATH, newConfigContent);
    if (dependabot === 'created') tree.write(DEPENDABOT_PATH, dependabotFile.content);
  }

  return {
    dryRun,
    workflowPath,
    workflowAction,
    configAction,
    requiredSecretName: plan.requiredSecretName,
    diff,
    workflowYaml: dryRun ? plan.workflowYaml : null,
    configSnippetJson: dryRun ? JSON.stringify(plan.configSnippet, null, 2) : null,
    configError: null,
    dependabot,
    dependabotProposal: dependabot === 'proposed' ? dependabotFile.content : null,
    ...(packageManagerNote !== undefined ? { packageManagerNote } : {}),
  };
}

export async function addReviewGenerator(tree: Tree, options: AddReviewGeneratorSchema): Promise<void> {
  console.log(renderAddReviewReport(runAddReview(tree, { ...options, dryRun: resolveDryRun(options) })));
}

export default addReviewGenerator;
