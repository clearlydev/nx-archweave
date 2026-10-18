import { detectWorkspacePackageManager } from '../environment/package-manager.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDoctorCheck, type DoctorCheck } from '@nx-archweave/shared';
import { REVIEW_MODES, type ReviewLocale, type ReviewMaxRounds, type ReviewMode } from '@nx-archweave/review-policy';
import {
  judgeReviewFileConflict,
  REVIEW_PROVIDERS,
  type ReviewProviderId,
  type ReviewWorkflowInput,
} from '../review/index.ts';

const CONFIG_PATH = 'toolkit.config.json';

// Default provider when toolkit.config.json is absent/unusable or doesn't declare
// a recognized `review.provider` — the pre-config existence questions ("is anything
// installed at all") still need a concrete path to check, and Claude is the
// long-standing default provider.
const DEFAULT_PROVIDER_ID: ReviewProviderId = 'claude';

/** Derives the alternate-filename path `add-review`'s `onConflict=alternate-filename`
 * writes by inserting `.archweave` before the extension of the *resolved*
 * main workflow path — e.g. `claude-code-review.yml` -> `claude-code-review.archweave.yml`,
 * `gemini-code-review.yml` -> `gemini-code-review.archweave.yml`. The nx-plugin
 * generator derives its alternate path the same provider-agnostic way (a deliberate
 * small duplication — importing doctor code from the generator would invert the
 * layering), so both layers stay in step as providers are added. This is a file *path* derivation, not workflow
 * content, so it does not violate the "no workflow-content string literals in
 * doctor code" constraint — no YAML/prompt text is duplicated. */
function deriveAltWorkflowPath(mainWorkflowPath: string): string {
  return mainWorkflowPath.replace(/\.yml$/, '.archweave.yml');
}

/** Resolves which provider's workflow path to check against: the `review.provider`
 * declared in toolkit.config.json when present and recognized, otherwise the
 * default provider. Deliberately looser than `validateReviewConfig` below — only
 * the `provider` field needs to be valid to resolve a path; an otherwise-broken
 * `review` shape is still reported by the config-consistency check. */
function resolveProviderId(config: ToolkitConfigState): ReviewProviderId {
  if (config.parseError || typeof config.review !== 'object' || config.review === null) {
    return DEFAULT_PROVIDER_ID;
  }
  const provider = (config.review as Record<string, unknown>)['provider'];
  if (typeof provider === 'string' && provider in REVIEW_PROVIDERS) {
    return provider as ReviewProviderId;
  }
  return DEFAULT_PROVIDER_ID;
}

const REVIEW_MODE_IDS = Object.keys(REVIEW_MODES) as ReviewMode[];
const REVIEW_LOCALES: ReviewLocale[] = ['ko', 'en'];
const REVIEW_MAX_ROUNDS: ReviewMaxRounds[] = [1, 2, 3, 4, 5];

interface ToolkitConfigState {
  /** true when toolkit.config.json fails to parse as a JSON object — the
   * config is unusable and no claim can be read from it. */
  parseError: boolean;
  /** The raw `review` field value, or undefined when the file/field is absent. */
  review: unknown;
}

function readToolkitConfigState(root: string): ToolkitConfigState {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) return { parseError: false, review: undefined };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { parseError: true, review: undefined };
    }
    return { parseError: false, review: (parsed as Record<string, unknown>)['review'] };
  } catch {
    return { parseError: true, review: undefined };
  }
}

function isReviewEnabledTrue(review: unknown): boolean {
  return typeof review === 'object' && review !== null && (review as Record<string, unknown>)['enabled'] === true;
}

// packageManager is deliberately absent here: the config records options, but
// the expected workflow is rendered for the DETECTED package manager — the
// caller supplies it at the buildWorkflowYaml call site.
interface ValidatedReviewConfig extends Omit<ReviewWorkflowInput, 'packageManager'> {
  provider: ReviewProviderId;
}

/** Validates the shape the review module needs to regenerate a workflow
 * (provider/mode/locale/maxRounds). Returns null for anything unrecognized —
 * treated as "unparseable" by the caller, same as a JSON syntax error. */
function validateReviewConfig(review: unknown): ValidatedReviewConfig | null {
  if (typeof review !== 'object' || review === null) return null;
  const r = review as Record<string, unknown>;
  const { provider, mode, locale, maxRounds } = r;
  if (typeof provider !== 'string' || !(provider in REVIEW_PROVIDERS)) return null;
  if (typeof mode !== 'string' || !REVIEW_MODE_IDS.includes(mode as ReviewMode)) return null;
  if (typeof locale !== 'string' || !REVIEW_LOCALES.includes(locale as ReviewLocale)) return null;
  if (typeof maxRounds !== 'number' || !REVIEW_MAX_ROUNDS.includes(maxRounds as ReviewMaxRounds)) return null;
  return {
    provider: provider as ReviewProviderId,
    mode: mode as ReviewMode,
    locale: locale as ReviewLocale,
    maxRounds: maxRounds as ReviewMaxRounds,
  };
}

export const REVIEW_CHECK_IDS = [
  'review-workflow-present',
  'review-alt-file-coexistence',
  'review-config-consistency',
] as const;

/** Read-only review-state diagnostics: whether the main review workflow is installed,
 * whether an alternate-filename file coexists with (or is orphaned without) it, and whether
 * the installed workflow still matches what toolkit.config.json's `review` field
 * would generate today. */
export function buildReviewChecks(root: string): DoctorCheck[] {
  const config = readToolkitConfigState(root);
  const mainWorkflowPath = REVIEW_PROVIDERS[resolveProviderId(config)].workflowFileName;
  const altWorkflowPath = deriveAltWorkflowPath(mainWorkflowPath);
  const mainExists = existsSync(join(root, mainWorkflowPath));
  const altExists = existsSync(join(root, altWorkflowPath));

  return [
    buildReviewWorkflowPresentCheck(mainWorkflowPath, mainExists, config),
    buildReviewAltFileCoexistenceCheck(mainWorkflowPath, altWorkflowPath, mainExists, altExists),
    buildReviewConfigConsistencyCheck(root, mainWorkflowPath, mainExists, config),
  ];
}

function buildReviewWorkflowPresentCheck(
  mainWorkflowPath: string,
  mainExists: boolean,
  config: ToolkitConfigState,
): DoctorCheck {
  if (mainExists) {
    return createDoctorCheck({
      id: 'review-workflow-present',
      label: 'Review workflow installed',
      status: 'pass',
      message: `${mainWorkflowPath} found`,
      evidence: [mainWorkflowPath],
    });
  }

  const claimsEnabled = !config.parseError && isReviewEnabledTrue(config.review);
  if (claimsEnabled) {
    return createDoctorCheck({
      id: 'review-workflow-present',
      label: 'Review workflow installed',
      status: 'warning',
      message: `${CONFIG_PATH} declares review.enabled: true, but ${mainWorkflowPath} was not found`,
      evidence: [CONFIG_PATH],
      suggestedAction: `Run the add-review generator to install ${mainWorkflowPath}, or remove the review.enabled claim from ${CONFIG_PATH} if review is no longer intended.`,
    });
  }

  return createDoctorCheck({
    id: 'review-workflow-present',
    label: 'Review workflow installed',
    status: 'not-applicable',
    message: `${mainWorkflowPath} not found — review is not installed`,
    evidence: [],
  });
}

function buildReviewAltFileCoexistenceCheck(
  mainWorkflowPath: string,
  altWorkflowPath: string,
  mainExists: boolean,
  altExists: boolean,
): DoctorCheck {
  if (!altExists) {
    return createDoctorCheck({
      id: 'review-alt-file-coexistence',
      label: 'Review alternate workflow file',
      status: 'not-applicable',
      message: `${altWorkflowPath} not found`,
      evidence: [],
    });
  }

  if (mainExists) {
    return createDoctorCheck({
      id: 'review-alt-file-coexistence',
      label: 'Review alternate workflow file',
      status: 'warning',
      message: `Both ${mainWorkflowPath} and ${altWorkflowPath} exist`,
      evidence: [mainWorkflowPath, altWorkflowPath],
      suggestedAction: `Review ${altWorkflowPath} and, if it reflects the options you want, manually swap it in for ${mainWorkflowPath} — then delete the alternate file. Do not let both run side by side.`,
    });
  }

  return createDoctorCheck({
    id: 'review-alt-file-coexistence',
    label: 'Review alternate workflow file',
    status: 'warning',
    message: `${altWorkflowPath} exists without ${mainWorkflowPath} — orphaned alternate file`,
    evidence: [altWorkflowPath],
    suggestedAction: `Review ${altWorkflowPath} and either rename it to ${mainWorkflowPath} to use it, or delete it.`,
  });
}

function buildReviewConfigConsistencyCheck(
  root: string,
  mainWorkflowPath: string,
  mainExists: boolean,
  config: ToolkitConfigState,
): DoctorCheck {
  if (!mainExists) {
    return createDoctorCheck({
      id: 'review-config-consistency',
      label: 'Review config/workflow consistency',
      status: 'not-applicable',
      message: `${mainWorkflowPath} not found — nothing to compare against ${CONFIG_PATH}`,
      evidence: [],
    });
  }

  if (config.parseError) {
    return createDoctorCheck({
      id: 'review-config-consistency',
      label: 'Review config/workflow consistency',
      status: 'error',
      message: `${CONFIG_PATH} could not be parsed — cannot verify it matches ${mainWorkflowPath}`,
      evidence: [CONFIG_PATH],
      suggestedAction: `Fix the JSON syntax in ${CONFIG_PATH} before running add-review, then re-run doctor.`,
    });
  }

  if (config.review === undefined) {
    return createDoctorCheck({
      id: 'review-config-consistency',
      label: 'Review config/workflow consistency',
      status: 'not-applicable',
      message: `${CONFIG_PATH} has no review field — nothing to compare against ${mainWorkflowPath}`,
      evidence: [],
    });
  }

  const validated = validateReviewConfig(config.review);
  if (validated === null) {
    return createDoctorCheck({
      id: 'review-config-consistency',
      label: 'Review config/workflow consistency',
      status: 'warning',
      message: `${CONFIG_PATH}'s review field has an unrecognized shape — cannot verify it matches ${mainWorkflowPath}`,
      evidence: [CONFIG_PATH],
      suggestedAction: `Fix the review field (provider/mode/locale/maxRounds) in ${CONFIG_PATH} and re-run doctor.`,
    });
  }

  const workflowContent = readFileSync(join(root, mainWorkflowPath), 'utf8');
  const generated = REVIEW_PROVIDERS[validated.provider].buildWorkflowYaml({
    ...validated,
    // The expected workflow is rendered for the DETECTED
    // package manager — detection is the truth, config drift is its own check.
    packageManager: detectWorkspacePackageManager(
      (p) => existsSync(join(root, p)),
      (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf-8') : undefined),
    ) ?? 'pnpm',
  });
  // Same idempotency basis as add-review's own conflict check.
  const verdict = judgeReviewFileConflict(workflowContent, generated);

  if (verdict.kind === 'unchanged') {
    return createDoctorCheck({
      id: 'review-config-consistency',
      label: 'Review config/workflow consistency',
      status: 'pass',
      message: `${mainWorkflowPath} matches ${CONFIG_PATH}'s review options`,
      evidence: [mainWorkflowPath, CONFIG_PATH],
    });
  }

  return createDoctorCheck({
    id: 'review-config-consistency',
    label: 'Review config/workflow consistency',
    status: 'warning',
    message: `${mainWorkflowPath} differs from what ${CONFIG_PATH}'s review options would generate`,
    evidence: [mainWorkflowPath, CONFIG_PATH],
    suggestedAction: `Re-run the add-review generator with --onConflict=overwrite to re-sync ${mainWorkflowPath} with ${CONFIG_PATH}, or update ${CONFIG_PATH} to match the installed file.`,
  });
}
