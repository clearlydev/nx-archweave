import {
  indentBlock,
  renderConcurrencyBlock,
  renderReviewPermissions,
  renderRoundGateStep,
  renderSecretGateStep,
  renderTriggerBlock,
  ROUND_MARKER,
  renderVerdictGateStep,
  renderWorkspaceSetupSteps,
} from './workflow-skeleton.ts';

describe('workflow skeleton', () => {
  it('trigger block lists the four PR event types', () => {
    const block = renderTriggerBlock();
    expect(block).toContain('pull_request:');
    expect(block).toContain('types: [opened, synchronize, ready_for_review, reopened]');
  });

  it('review permissions are the minimal set; id-token only when the provider needs it', () => {
    expect(renderReviewPermissions(true)).toBe(['permissions:', '  contents: read', '  pull-requests: write', '  id-token: write'].join('\n'));
    expect(renderReviewPermissions(false)).toBe(['permissions:', '  contents: read', '  pull-requests: write'].join('\n'));
  });

  it('secret gate references the given secret, succeeds, and emits the enabled output', () => {
    const step = renderSecretGateStep('CLAUDE_CODE_OAUTH_TOKEN');
    expect(step).toContain('id: secret-gate');
    expect(step).toContain('${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}');
    expect(step).toContain('enabled=false');
    expect(step).toContain('enabled=true');
    expect(step).toContain('CLAUDE_CODE_OAUTH_TOKEN secret');
    expect(step).not.toContain('exit 1');
  });

  it('round gate counts marker comments and caps at the given maxRounds', () => {
    const step = renderRoundGateStep(4);
    expect(step).toContain('id: round-gate');
    expect(step).toContain("if: steps.secret-gate.outputs.enabled == 'true'");
    expect(step).toContain(ROUND_MARKER);
    expect(step).toContain('-ge 4');
    expect(step).toContain('allowed=false');
    expect(step).toContain('allowed=true');
    expect(step).toContain("| jq -s -r '[(map(.[0]) | add // 0), (map(.[1]) | max // 0)] | @tsv'");
    // the watermark the verdict gate binds the judged round to
    expect(step).toContain('echo "last-comment-id=');
  });

  it('one review run per PR at a time; a later push queues instead of cancelling', () => {
    expect(renderConcurrencyBlock()).toBe(
      ['concurrency:', '  group: archweave-review-${{ github.event.pull_request.number }}', '  cancel-in-progress: false'].join('\n'),
    );
  });

  it('indentBlock prefixes non-empty lines only', () => {
    expect(indentBlock('a\n\nb', 2)).toBe('  a\n\n  b');
  });
});

describe('renderVerdictGateStep', () => {
  it('guards on plugin presence, hands the verdict over as outputs, and carries the env contract', () => {
    const step = renderVerdictGateStep(3, 'ko');
    expect(step).toContain("if: steps.ai-review-result.outputs.run == 'true'");
    expect(step).toContain('id: verdict');
    expect(step).toContain("ARCHWEAVE_VERDICT_OUTPUT: 'github-output'");
    expect(step).toContain("ARCHWEAVE_MAX_ROUNDS: '3'");
    expect(step).toContain("ARCHWEAVE_LOCALE: 'ko'");
    expect(step).toContain('ARCHWEAVE_HEAD_SHA: ${{ github.event.pull_request.head.sha }}');
    expect(step).toContain('ARCHWEAVE_ROUND_AFTER_ID: ${{ needs.ai-review.outputs.last-comment-id }}');
    expect(step).toContain('node_modules/.bin/archweave-review-verdict');
    expect(step).toContain('skipping the verdict gate');
  });
});

describe('renderWorkspaceSetupSteps', () => {
  it('npm: setup-node with npm cache then npm ci with install scripts off, only when the AI review ran (token-less repos must not pay install)', () => {
    const steps = renderWorkspaceSetupSteps('npm');
    expect(steps).toContain('actions/setup-node@');
    expect(steps).toContain('cache: npm');
    expect(steps).toContain('npm ci --ignore-scripts');
    expect(steps).not.toContain('pnpm');
    expect(steps.match(/if: steps\.ai-review-result\.outputs\.run == 'true'/g)).toHaveLength(2);
  });

  it('pnpm: the version is decided on the runner (explicit only without a packageManager field), then a frozen install', () => {
    const steps = renderWorkspaceSetupSteps('pnpm');
    expect(steps).toContain('pnpm/action-setup@');
    expect(steps).toContain('echo "version=10" >> "$GITHUB_OUTPUT"');
    expect(steps).toContain('version: ${{ steps.pnpm-version.outputs.version }}');
    expect(steps.indexOf('Detect pnpm version')).toBeLessThan(steps.indexOf('pnpm/action-setup@'));
    expect(steps).toContain('pnpm install --frozen-lockfile --ignore-scripts');
    expect(steps).toContain('cache: pnpm');
  });

  it("yarn: Corepack serves both flavors; the install picks --immutable (berry) or --frozen-lockfile (classic) from yarn's own major, scripts off in both", () => {
    const steps = renderWorkspaceSetupSteps('yarn');
    expect(steps).toContain('actions/setup-node@');
    // no setup-node yarn cache: it would ask the runner's global yarn 1 about a berry project
    expect(steps).not.toContain('cache:');
    expect(steps).toContain('corepack enable yarn');
    expect(steps).toContain(
      'if [ "$(yarn --version | cut -d. -f1)" -ge 2 ]; then YARN_ENABLE_SCRIPTS=false yarn install --immutable --mode=skip-build; else yarn install --frozen-lockfile --ignore-scripts; fi',
    );
    expect(steps).not.toContain('pnpm');
    expect(steps).not.toContain('npm ci');
  });

  it('bun: setup-bun before setup-node (no bun cache there), then a frozen bun install with scripts off', () => {
    const steps = renderWorkspaceSetupSteps('bun');
    expect(steps).toContain('oven-sh/setup-bun@');
    expect(steps).toContain('actions/setup-node@');
    expect(steps.indexOf('oven-sh/setup-bun')).toBeLessThan(steps.indexOf('actions/setup-node'));
    expect(steps).not.toContain('cache:');
    expect(steps).toContain('bun install --frozen-lockfile --ignore-scripts');
    expect(steps).not.toContain('npm ci');
    expect(steps.match(/if: steps\.ai-review-result\.outputs\.run == 'true'/g)).toHaveLength(3);
  });
});

it('verdict step invokes the bin directly — no package-manager-specific exec', () => {
  const step = renderVerdictGateStep(3, 'en');
  expect(step).toContain('node_modules/.bin/archweave-review-verdict');
  expect(step).not.toContain('pnpm exec');
});
