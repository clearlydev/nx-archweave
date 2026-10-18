import type { SupportedPackageManager } from '../environment/package-manager.ts';
import { ROUND_MARKER, type ReviewLocale, type ReviewMaxRounds } from '@nx-archweave/review-policy';

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

export function renderPermissionsBlock(): string {
  return ['permissions:', '  contents: read', '  pull-requests: write', '  id-token: write'].join('\n');
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
 * the cap costs zero tokens. It also outputs the newest comment id as a watermark:
 * the verdict gate judges only a round posted after it — this run's, for this commit. */
export function renderRoundGateStep(maxRounds: ReviewMaxRounds): string {
  return [
    '- name: Check review round limit',
    '  id: round-gate',
    "  if: steps.secret-gate.outputs.enabled == 'true'",
    '  env:',
    '    GH_TOKEN: ${{ github.token }}',
    '  run: |',
    `    counts=$(gh api "repos/\${{ github.repository }}/issues/\${{ github.event.pull_request.number }}/comments" --paginate --jq '[([.[] | select(.body | contains("${ROUND_MARKER}"))] | length), ([.[].id] | max // 0)]' | jq -s -r '[(map(.[0]) | add // 0), (map(.[1]) | max // 0)] | @tsv')`,
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

/** The verdict gate step: runs after the provider's
 * review step, judges the posted findings block via the plugin's bin, and is
 * the ONLY red path of the pipeline (exit 1 on a parsed BLOCK). A workspace
 * that removed the plugin green-skips — same stance as the secret gate. */
export function renderVerdictGateStep(maxRounds: ReviewMaxRounds, locale: ReviewLocale): string {
  return [
    '- name: Compute review verdict',
    "  if: steps.secret-gate.outputs.enabled == 'true' && steps.round-gate.outputs.allowed == 'true'",
    '  env:',
    '    GH_TOKEN: ${{ github.token }}',
    '    GITHUB_REPOSITORY: ${{ github.repository }}',
    '    ARCHWEAVE_PR_NUMBER: ${{ github.event.pull_request.number }}',
    `    ARCHWEAVE_MAX_ROUNDS: '${maxRounds}'`,
    `    ARCHWEAVE_LOCALE: '${locale}'`,
    '    ARCHWEAVE_HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
    '    ARCHWEAVE_ROUND_AFTER_ID: ${{ steps.round-gate.outputs.last-comment-id }}',
    '  run: |',
    '    if [ -x node_modules/.bin/archweave-review-verdict ]; then',
    '      node_modules/.bin/archweave-review-verdict',
    '    else',
    '      echo "nx-archweave is not installed in this workspace - skipping the verdict gate."',
    '    fi',
  ].join('\n');
}

/** Workspace setup before the verdict gate: the bin lives in
 * node_modules, which a bare checkout does not have. Both steps sit behind the
 * same two gates as the review itself, so token-less or capped repos never pay
 * for an install. An install failure is a genuinely broken workspace (stale
 * lockfile), not a false block — the verdict contract covers only its own step. */
// Pinned toolchain for the setup steps — one place to bump (snapshots follow).
// Node 22/24 bundle Corepack, which the yarn install step relies on; from Node 25 it is no
// longer bundled — bumping past 24 needs an explicit `npm i -g corepack` step first.
const SETUP_NODE_VERSION = '22';
const SETUP_PNPM_VERSION = '10';
// Nx workspaces created with bun carry no packageManager field (measured), so setup-bun
// takes its own default (latest) — the frozen install below still holds the lockfile.
// Unpinned on purpose: a newer bun reads the lockfiles older ones wrote, while a pin here
// would break the workflow on the user's first bun upgrade that bumps the lockfile format.
const SETUP_BUN_ACTION = 'oven-sh/setup-bun@v2';

/** Frozen installs per manager. The yarn flavor is decided on the
 * runner by the yarn Corepack provides for the project (its packageManager field, else
 * yarn 1) — so the rendered workflow is right for both without threading the flavor. */
const INSTALL_LINES: Record<SupportedPackageManager, string[]> = {
  pnpm: ['    pnpm install --frozen-lockfile'],
  npm: ['    npm ci'],
  yarn: [
    '    corepack enable yarn',
    '    if [ "$(yarn --version | cut -d. -f1)" -ge 2 ]; then yarn install --immutable; else yarn install --frozen-lockfile; fi',
  ],
  bun: ['    bun install --frozen-lockfile'],
};

export function renderWorkspaceSetupSteps(packageManager: SupportedPackageManager): string {
  const gate = "  if: steps.secret-gate.outputs.enabled == 'true' && steps.round-gate.outputs.allowed == 'true'";
  const steps: string[] = [];
  if (packageManager === 'pnpm') {
    // The generated workspaces carry no "packageManager" field (measured), so
    // action-setup needs an explicit version.
    steps.push(['- name: Set up pnpm', gate, '  uses: pnpm/action-setup@v4', '  with:', `    version: ${SETUP_PNPM_VERSION}`].join('\n'));
  }
  if (packageManager === 'bun') {
    steps.push(['- name: Set up bun', gate, `  uses: ${SETUP_BUN_ACTION}`].join('\n'));
  }
  steps.push(
    [
      '- name: Set up Node',
      gate,
      '  uses: actions/setup-node@v4',
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
