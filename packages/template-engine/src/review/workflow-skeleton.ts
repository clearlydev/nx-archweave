import type { SupportedPackageManager } from '../environment/package-manager.ts';
import {
  renderCommitLine,
  renderNotRunNotice,
  ROUND_MARKER,
  VERDICT_MARKER,
  type NotRunReason,
  type ReviewLocale,
  type ReviewMaxRounds,
} from '@nx-archweave/review-policy';
import { pinnedUses } from './action-pins.ts';
import type { ReviewWorkflowInput } from './provider.ts';

/** Marker every posted review summary must contain; the round gate counts
 * comments containing it. Owned by review-policy's verdict gate — re-exported here
 * for the workflow renderers. */
export { ROUND_MARKER };

export function indentBlock(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n');
}

export function renderTriggerBlock(): string {
  return ['on:', '  pull_request:', '    types: [opened, synchronize, ready_for_review, reopened]'].join('\n');
}

/** One review run per PR at a time (later pushes queue, the newest pending one wins): the round
 * gate's comment-id watermark then never sees another run's round land after it. */
export function renderConcurrencyBlock(): string {
  return [
    'concurrency:',
    '  group: archweave-review-${{ github.event.pull_request.number }}',
    '  cancel-in-progress: false',
  ].join('\n');
}

/** The step condition every review step after the two gates carries. */
export const REVIEW_GATE_CONDITION = "steps.secret-gate.outputs.enabled == 'true' && steps.round-gate.outputs.allowed == 'true'";

/** The review job's permissions. `idToken`: the provider's action exchanges a GitHub OIDC token
 * (Claude's GitHub App sign-in); no other job ever gets one. */
export function renderReviewPermissions(idToken: boolean): string {
  return ['permissions:', '  contents: read', '  pull-requests: write', ...(idToken ? ['  id-token: write'] : [])].join('\n');
}

/** The repository checkout every job that reads the tree starts from. The token stays out of
 * `.git/config`: the jobs only read the tree, and a persisted token would be readable by every
 * later step, including the AI agent's shell. */
export function renderCheckoutStep(gateCondition?: string, extraWith: string[] = []): string {
  return [
    '- name: Checkout repository',
    ...(gateCondition === undefined ? [] : [`  if: ${gateCondition}`]),
    `  uses: ${pinnedUses('actions/checkout')}`,
    '  with:',
    ...extraWith.map((line) => `    ${line}`),
    '    fetch-depth: 1',
    '    persist-credentials: false',
  ].join('\n');
}

/** Green-skips the whole job when the provider secret is absent:
 * emits enabled=false and exits 0 — never a red check. */
export function renderSecretGateStep(secretName: string): string {
  return [
    '- name: Check review secret',
    '  id: secret-gate',
    '  env:',
    `    REVIEW_SECRET: \${{ secrets.${secretName} }}`,
    '  run: |',
    '    if [ -z "$REVIEW_SECRET" ]; then',
    `      echo "AI review is not active: register the ${secretName} secret to enable it."`,
    '      echo "enabled=false" >> "$GITHUB_OUTPUT"',
    '    else',
    '      echo "enabled=true" >> "$GITHUB_OUTPUT"',
    '    fi',
  ].join('\n');
}

/** Counts marker-tagged PR comments BEFORE the provider step runs, so a PR at
 * the cap costs zero tokens. Only bot-authored comments count: anyone who can comment could
 * otherwise post the marker until the cap is reached and switch the review off. It also
 * outputs the newest comment id as a watermark: the verdict gate judges only a round posted
 * after it — this run's, for this commit. */
export function renderRoundGateStep(maxRounds: ReviewMaxRounds): string {
  return [
    '- name: Check review round limit',
    '  id: round-gate',
    "  if: steps.secret-gate.outputs.enabled == 'true'",
    '  env:',
    '    GH_TOKEN: ${{ github.token }}',
    '  run: |',
    `    counts=$(gh api "repos/\${{ github.repository }}/issues/\${{ github.event.pull_request.number }}/comments" --paginate --jq '[([.[] | select(.user.type == "Bot") | select(.body | contains("${ROUND_MARKER}"))] | length), ([.[].id] | max // 0)]' | jq -s -r '[(map(.[0]) | add // 0), (map(.[1]) | max // 0)] | @tsv')`,
    '    rounds=$(printf \'%s\' "$counts" | cut -f1)',
    '    echo "last-comment-id=$(printf \'%s\' "$counts" | cut -f2)" >> "$GITHUB_OUTPUT"',
    `    if [ "$rounds" -ge ${maxRounds} ]; then`,
    `      echo "Automated review round limit (${maxRounds}) reached for this PR; skipping."`,
    '      echo "allowed=false" >> "$GITHUB_OUTPUT"',
    '    else',
    '      echo "allowed=true" >> "$GITHUB_OUTPUT"',
    '    fi',
  ].join('\n');
}

/** A literal for a single-quoted shell word: the text is static, so quoting it whole keeps every
 * character literal (`'` itself is closed, escaped and reopened). */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The shell function the `review` job's first step calls when the AI review did not run but the
 * check ends green: the color stays, and an annotation, the job summary and the verdict comment
 * (handed to the review-comment job, which posts it where the token may write) say that this green
 * is not a review. Every text is rendered here; at run time only the abbreviated head SHA, checked
 * to be hex, is filled in. */
function renderNotRunFunction(secretName: string, maxRounds: ReviewMaxRounds, locale: ReviewLocale): string[] {
  const reasons: NotRunReason[] = ['secret', 'fork', 'dependabot', 'rounds'];
  const [commitBefore, commitAfter] = renderCommitLine(locale, '\u0000').split('\u0000');
  return [
    'not_run() {',
    '  case "$1" in',
    ...reasons.map(
      (reason) =>
        `    ${reason}) annotation=${shellQuote(renderNotRunNotice('en', reason, secretName, maxRounds))}; notice=${shellQuote(renderNotRunNotice(locale, reason, secretName, maxRounds))} ;;`,
    ),
    '  esac',
    '  echo "::notice title=AI review did not run::$annotation"',
    '  printf \'%s\\n\' "$notice" >> "$GITHUB_STEP_SUMMARY"',
    '  short_sha=$(printf \'%s\' "$HEAD_SHA" | cut -c1-7)',
    '  case "$short_sha" in',
    "    '' | *[!0-9a-f]*) short_sha= ;;",
    '  esac',
    '  {',
    '    echo "notice-body<<ARCHWEAVE_NOT_RUN_EOF"',
    `    printf '%s\\n' ${shellQuote(VERDICT_MARKER)} "ℹ️ $notice"`,
    `    if [ -n "$short_sha" ]; then printf '\\n%s\\n' ${shellQuote(commitBefore)}"$short_sha"${shellQuote(commitAfter)}; fi`,
    '    echo "ARCHWEAVE_NOT_RUN_EOF"',
    '    echo "run=false"',
    '  } >> "$GITHUB_OUTPUT"',
    '}',
  ];
}

/** The condition of every step in the `review` job after it checked the AI review's result. */
export const JUDGE_CONDITION = "steps.ai-review-result.outputs.run == 'true'";

/** First step of the `review` job, which runs whatever the AI review job did (`if: always()`):
 * the check then ends exactly as the single job did. Only explicit values count. A review the
 * secret gate (`enabled=false`) or the round gate (`allowed=false`) switched off ends green
 * without judging, and says so (renderNotRunFunction): a missing secret is named as a fork run
 * or a Dependabot run when it is one, since those never receive the Actions secret. A review that
 * ran must also hand over its watermark (a number, 0 on a PR with no comments). Anything else — a
 * failed, cancelled or skipped AI review, or results that did not reach this job — fails, so a
 * BLOCK can never pass as "review switched off". The job's outputs and the event's fields reach
 * the script through env. */
export function renderAiReviewResultStep(secretName: string, maxRounds: ReviewMaxRounds, locale: ReviewLocale): string {
  return [
    '- name: Check the AI review result',
    '  id: ai-review-result',
    '  env:',
    '    AI_REVIEW_RESULT: ${{ needs.ai-review.result }}',
    '    REVIEW_ENABLED: ${{ needs.ai-review.outputs.enabled }}',
    '    REVIEW_ALLOWED: ${{ needs.ai-review.outputs.allowed }}',
    '    LAST_COMMENT_ID: ${{ needs.ai-review.outputs.last-comment-id }}',
    '    HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
    '    HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}',
    '    REPOSITORY: ${{ github.repository }}',
    '    PR_AUTHOR: ${{ github.event.pull_request.user.login }}',
    '  run: |',
    ...renderNotRunFunction(secretName, maxRounds, locale).map((line) => `    ${line}`),
    '    if [ "$AI_REVIEW_RESULT" != success ]; then',
    `      echo "::error title=AI review did not succeed::The AI review job ended with '$AI_REVIEW_RESULT'."`,
    '      exit 1',
    '    fi',
    '    case "$REVIEW_ENABLED/$REVIEW_ALLOWED" in',
    '      false/*)',
    '        if [ "$HEAD_REPOSITORY" != "$REPOSITORY" ]; then not_run fork',
    "        elif [ \"$PR_AUTHOR\" = 'dependabot[bot]' ]; then not_run dependabot",
    '        else not_run secret',
    '        fi',
    '        exit 0',
    '        ;;',
    '      true/false)',
    '        not_run rounds',
    '        exit 0',
    '        ;;',
    '      true/true)',
    '        case "$LAST_COMMENT_ID" in',
    "          '' | *[!0-9]*) ;;",
    '          *)',
    '            echo "run=true" >> "$GITHUB_OUTPUT"',
    '            exit 0',
    '            ;;',
    '        esac',
    '        ;;',
    '    esac',
    `    echo "::error title=Review verdict not computed::The AI review job's results did not reach this job, so no verdict can be computed. Re-run all jobs."`,
    '    exit 1',
  ].join('\n');
}

/** The verdict gate step: judges the posted findings block via the plugin's bin, in the `review`
 * job. The bin hands the verdict comment to the `review-comment` job (step outputs) instead of
 * posting it, so this job needs no write token. A workspace that removed the plugin green-skips
 * — same stance as the secret gate. */
export function renderVerdictGateStep(maxRounds: ReviewMaxRounds, locale: ReviewLocale): string {
  return [
    '- name: Compute review verdict',
    '  id: verdict',
    `  if: ${JUDGE_CONDITION}`,
    '  env:',
    '    GH_TOKEN: ${{ github.token }}',
    '    GITHUB_REPOSITORY: ${{ github.repository }}',
    '    ARCHWEAVE_PR_NUMBER: ${{ github.event.pull_request.number }}',
    `    ARCHWEAVE_MAX_ROUNDS: '${maxRounds}'`,
    `    ARCHWEAVE_LOCALE: '${locale}'`,
    '    ARCHWEAVE_HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
    '    ARCHWEAVE_ROUND_AFTER_ID: ${{ needs.ai-review.outputs.last-comment-id }}',
    "    ARCHWEAVE_VERDICT_OUTPUT: 'github-output'",
    '  run: |',
    '    if [ -x node_modules/.bin/archweave-review-verdict ]; then',
    '      node_modules/.bin/archweave-review-verdict',
    '    else',
    '      echo "nx-archweave is not installed in this workspace - skipping the verdict gate."',
    '    fi',
  ].join('\n');
}

/** The ONLY red path of the pipeline: a parsed BLOCK. The bin reports it as an output (so the
 * comment is handed over first) and this step fails the job. */
export function renderBlockStep(): string {
  return [
    '- name: Fail on a blocking verdict',
    "  if: steps.verdict.outputs.blocked == 'true'",
    '  run: |',
    '    echo "The review check failed: the verdict is BLOCK, or the AI review left no readable summary. See the verdict comment on this pull request."',
    '    exit 1',
  ].join('\n');
}

/** Posts or edits the verdict comment. It checks out nothing and installs nothing: the only
 * input is the `review` job's outputs, which reach the script through env (never inline, so the
 * comment text cannot be read as shell), and the earlier comment id must be a number. When the
 * verdict bin didn't run (a review that didn't run hands over only its notice), the earlier
 * comment is looked up among this workflow's own: one verdict comment per PR either way. */
export function renderVerdictCommentStep(): string {
  return [
    '- name: Post review verdict',
    '  env:',
    '    GH_TOKEN: ${{ github.token }}',
    '    REPOSITORY: ${{ github.repository }}',
    '    PR_NUMBER: ${{ github.event.pull_request.number }}',
    '    VERDICT_BODY: ${{ needs.review.outputs.comment-body }}',
    '    PREVIOUS_ID: ${{ needs.review.outputs.previous-comment-id }}',
    '  run: |',
    `    payload=$(jq -n --arg body "$VERDICT_BODY" '{body: $body}')`,
    '    if [ -z "$PREVIOUS_ID" ]; then',
    `      PREVIOUS_ID=$(gh api "repos/$REPOSITORY/issues/$PR_NUMBER/comments" --paginate --jq '.[] | select(.user.login == "github-actions[bot]") | select(.body | contains("${VERDICT_MARKER}")) | .id' | tail -n 1) || PREVIOUS_ID=`,
    '    fi',
    '    case "$PREVIOUS_ID" in',
    "      ''|*[!0-9]*) PREVIOUS_ID= ;;",
    '    esac',
    '    if [ -n "$PREVIOUS_ID" ] && printf \'%s\' "$payload" | gh api -X PATCH "repos/$REPOSITORY/issues/comments/$PREVIOUS_ID" --input - > /dev/null; then',
    '      exit 0',
    '    fi',
    '    printf \'%s\' "$payload" | gh api -X POST "repos/$REPOSITORY/issues/$PR_NUMBER/comments" --input - > /dev/null \\',
    '      || echo "Could not post the verdict comment (continuing)."',
  ].join('\n');
}

/** Workspace setup before the verdict gate: the bin lives in
 * node_modules, which a bare checkout does not have. The steps run only when the AI review's two
 * gates passed, so token-less or capped repos never pay for an install. An install failure is a
 * genuinely broken workspace (stale lockfile), not a false block — the verdict contract covers
 * only its own step. */
// Pinned toolchain for the setup steps — one place to bump (snapshots follow).
// Node 22/24 bundle Corepack, which the yarn install step relies on; from Node 25 it is no
// longer bundled — bumping past 24 needs an explicit `npm i -g corepack` step first.
const SETUP_NODE_VERSION = '22';
// Used only when the workspace's package.json has no packageManager field: action-setup
// refuses a `version` that differs from that field, so the workflow decides on the runner.
const FALLBACK_PNPM_VERSION = '10';
// The bun step passes no bun-version: Nx workspaces created with bun carry no packageManager
// field (measured), so setup-bun takes its own default (latest) — the frozen install below
// still holds the lockfile. A newer bun reads the lockfiles older ones wrote, while a pinned
// bun version would break the workflow on the user's first upgrade that bumps the format.

/** Frozen installs per manager, with install scripts off: the tree comes from the pull request,
 * and the verdict bin is plain JavaScript that needs no build step. The yarn flavor is decided on
 * the runner by the yarn Corepack provides for the project (its packageManager field, else
 * yarn 1) — so the rendered workflow is right for both without threading the flavor. Yarn berry
 * has no --ignore-scripts: enableScripts=false skips the dependencies' scripts but still runs the
 * project's own postinstall (measured, yarn 4.9), so --mode=skip-build is passed too. */
const INSTALL_LINES: Record<SupportedPackageManager, string[]> = {
  pnpm: ['    pnpm install --frozen-lockfile --ignore-scripts'],
  npm: ['    npm ci --ignore-scripts'],
  yarn: [
    '    corepack enable yarn',
    '    if [ "$(yarn --version | cut -d. -f1)" -ge 2 ]; then YARN_ENABLE_SCRIPTS=false yarn install --immutable --mode=skip-build; else yarn install --frozen-lockfile --ignore-scripts; fi',
  ],
  bun: ['    bun install --frozen-lockfile --ignore-scripts'],
};

/** Decides the pnpm version on the runner: empty (action-setup then reads packageManager) when
 * package.json has the field, the fallback otherwise. */
function renderPnpmVersionStep(gate: string): string {
  return [
    '- name: Detect pnpm version',
    '  id: pnpm-version',
    gate,
    '  run: |',
    `    if [ -n "$(jq -r '.packageManager // empty' package.json)" ]; then`,
    '      echo "version=" >> "$GITHUB_OUTPUT"',
    '    else',
    `      echo "version=${FALLBACK_PNPM_VERSION}" >> "$GITHUB_OUTPUT"`,
    '    fi',
  ].join('\n');
}

export function renderWorkspaceSetupSteps(packageManager: SupportedPackageManager): string {
  const gate = `  if: ${JUDGE_CONDITION}`;
  const steps: string[] = [];
  if (packageManager === 'pnpm') {
    // Workspaces created by Nx carry no packageManager field (measured) and need an explicit
    // version; one that has the field (or gains it later) must not get one, or action-setup
    // fails on the mismatch. The check runs on the runner, so the workflow stays right either way.
    steps.push(renderPnpmVersionStep(gate));
    steps.push(
      [
        '- name: Set up pnpm',
        gate,
        `  uses: ${pinnedUses('pnpm/action-setup')}`,
        '  with:',
        '    version: ${{ steps.pnpm-version.outputs.version }}',
      ].join('\n'),
    );
  }
  if (packageManager === 'bun') {
    steps.push(['- name: Set up bun', gate, `  uses: ${pinnedUses('oven-sh/setup-bun')}`].join('\n'));
  }
  steps.push(
    [
      '- name: Set up Node',
      gate,
      `  uses: ${pinnedUses('actions/setup-node')}`,
      '  with:',
      `    node-version: ${SETUP_NODE_VERSION}`,
      // yarn: no setup-node cache — it would query the runner's global yarn 1 even in a
      // berry project. Corepack (shipped with Node) provides the project's own yarn below.
      // bun: setup-node has no bun cache. Node is still set up — nx and the verdict bin
      // run on it.
      ...(packageManager === 'yarn' || packageManager === 'bun' ? [] : [`    cache: ${packageManager}`]),
    ].join('\n'),
  );
  steps.push(
    [
      '- name: Install workspace dependencies',
      gate,
      '  run: |',
      ...INSTALL_LINES[packageManager],
    ].join('\n'),
  );
  return steps.join('\n\n');
}

export interface ReviewWorkflowParts {
  /** The workflow's display name. */
  name: string;
  secretName: string;
  /** The provider's steps after the two gates: the checkout and the review itself. */
  reviewSteps: string[];
  /** The provider's action exchanges a GitHub OIDC token (see renderReviewPermissions). */
  idToken: boolean;
}

/**
 * Three jobs, each with only the access it needs. `ai-review` holds the provider secret and runs
 * the AI review; it installs nothing. `review` — the check a branch rule requires, named as the
 * single job before it was — always runs: it fails when the AI review failed, and otherwise
 * installs the workspace's dependencies (install scripts off) to run the verdict bin, with a
 * read-only token and no secret or OIDC token. `review-comment` posts the verdict with a write
 * token and runs nothing from the pull request.
 */
/** Every job stops after this long. Without it GitHub allows 360 minutes, and a provider CLI that
 * hangs (cursor-agent sat silent for 8.5 minutes before a usage-limit error, measured 2026-10-25)
 * would hold the PR's review queue and bill the time. A stopped ai-review doesn't end in success,
 * which the review job reads as a failed AI review: the check goes red, never green. */
export const REVIEW_JOB_TIMEOUT_MINUTES = 15;

export function renderReviewWorkflow(input: ReviewWorkflowInput, parts: ReviewWorkflowParts): string {
  const aiReviewSteps = [renderSecretGateStep(parts.secretName), renderRoundGateStep(input.maxRounds), ...parts.reviewSteps];
  const reviewSteps = [
    renderAiReviewResultStep(parts.secretName, input.maxRounds, input.locale),
    renderCheckoutStep(JUDGE_CONDITION),
    renderWorkspaceSetupSteps(input.packageManager),
    renderVerdictGateStep(input.maxRounds, input.locale),
    renderBlockStep(),
  ];
  return [
    `name: ${parts.name}`,
    '',
    renderTriggerBlock(),
    '',
    renderConcurrencyBlock(),
    '',
    'permissions: {}',
    '',
    'jobs:',
    '  ai-review:',
    '    runs-on: ubuntu-latest',
    `    timeout-minutes: ${REVIEW_JOB_TIMEOUT_MINUTES}`,
    indentBlock(renderReviewPermissions(parts.idToken), 4),
    '    outputs:',
    '      enabled: ${{ steps.secret-gate.outputs.enabled }}',
    '      allowed: ${{ steps.round-gate.outputs.allowed }}',
    '      last-comment-id: ${{ steps.round-gate.outputs.last-comment-id }}',
    '    steps:',
    indentBlock(aiReviewSteps.join('\n\n'), 6),
    '',
    '  review:',
    '    needs: ai-review',
    '    if: always()',
    '    runs-on: ubuntu-latest',
    `    timeout-minutes: ${REVIEW_JOB_TIMEOUT_MINUTES}`,
    '    permissions:',
    '      contents: read',
    '      pull-requests: read',
    '    outputs:',
    '      comment-body: ${{ steps.verdict.outputs.comment-body || steps.ai-review-result.outputs.notice-body }}',
    '      previous-comment-id: ${{ steps.verdict.outputs.previous-comment-id }}',
    '    steps:',
    indentBlock(reviewSteps.join('\n\n'), 6),
    '',
    '  review-comment:',
    '    needs: review',
    // Runs after a BLOCK failed the review job, too: the comment explains the red check.
    "    if: ${{ !cancelled() && needs.review.outputs.comment-body != '' }}",
    '    runs-on: ubuntu-latest',
    `    timeout-minutes: ${REVIEW_JOB_TIMEOUT_MINUTES}`,
    '    permissions:',
    '      pull-requests: write',
    '    steps:',
    indentBlock(renderVerdictCommentStep(), 6),
    '',
  ].join('\n');
}
