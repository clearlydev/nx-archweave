import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupportedPackageManager } from '../environment/package-manager.ts';
import { ACTION_PINS } from './action-pins.ts';
import { REVIEW_PROVIDERS } from './provider.ts';
import { ROUND_MARKER } from './workflow-skeleton.ts';

const PACKAGE_MANAGERS: SupportedPackageManager[] = ['pnpm', 'npm', 'yarn', 'bun'];
const PINNED_USES = /^\s*(- )?uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+(\.\d+)*$/;

function render(providerId: keyof typeof REVIEW_PROVIDERS, packageManager: SupportedPackageManager): string {
  return REVIEW_PROVIDERS[providerId].buildWorkflowYaml({ mode: 'thorough', locale: 'en', maxRounds: 3, packageManager });
}

/** Each `- name:` step of the rendered job, as its own text block. */
function stepsOf(yaml: string): string[] {
  return yaml.split(/\n(?=\s*- name: )/);
}

/** The rendered jobs by id (`jobs:` children are indented two spaces). */
function jobsOf(yaml: string): Record<string, string> {
  const body = yaml.slice(yaml.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const jobs: Record<string, string> = {};
  for (const block of body.split(/\n(?= {2}[\w-]+:\n)/)) {
    const id = /^ {2}([\w-]+):\n/.exec(block)?.[1];
    if (id) jobs[id] = block;
  }
  return jobs;
}

/** The lines of every `run: |` script in a job. */
function runScriptsOf(job: string): string[] {
  return stepsOf(job).flatMap((step) => {
    const start = step.indexOf('  run: |\n');
    return start === -1 ? [] : step.slice(start).split('\n').slice(1);
  });
}

const INSTALL_SCRIPTS_OFF: Record<SupportedPackageManager, string[]> = {
  npm: ['npm ci --ignore-scripts'],
  pnpm: ['pnpm install --frozen-lockfile --ignore-scripts'],
  yarn: ['YARN_ENABLE_SCRIPTS=false yarn install --immutable --mode=skip-build', 'yarn install --frozen-lockfile --ignore-scripts'],
  bun: ['bun install --frozen-lockfile --ignore-scripts'],
};

describe.each(Object.keys(REVIEW_PROVIDERS) as (keyof typeof REVIEW_PROVIDERS)[])('%s workflow security', (providerId) => {
  it.each(PACKAGE_MANAGERS)('pins every action to a commit SHA (%s)', (packageManager) => {
    const usesLines = render(providerId, packageManager)
      .split('\n')
      .filter((line) => /^\s*(- )?uses: /.test(line));
    expect(usesLines.length).toBeGreaterThan(0);
    for (const line of usesLines) expect(line).toMatch(PINNED_USES);
  });

  it.each(PACKAGE_MANAGERS)('never persists the checkout credentials (%s)', (packageManager) => {
    // The AI review job's and the review job's
    const checkouts = stepsOf(render(providerId, packageManager)).filter((step) => step.includes('uses: actions/checkout@'));
    expect(checkouts.length).toBe(2);
    for (const step of checkouts) expect(step).toContain('persist-credentials: false');
  });

  it('counts only bot-authored round markers', () => {
    const yaml = render(providerId, 'npm');
    expect(yaml).toContain(`[.[] | select(.user.type == "Bot") | select(.body | contains("${ROUND_MARKER}"))]`);
  });

  it.each(PACKAGE_MANAGERS)('grants no permission at the top level; each job asks for its own (%s)', (packageManager) => {
    const yaml = render(providerId, packageManager);
    expect(yaml).toMatch(/^permissions: \{\}$/m);
    expect(Object.keys(jobsOf(yaml))).toEqual(['ai-review', 'review', 'review-comment']);
    for (const job of Object.values(jobsOf(yaml))) expect(job).toMatch(/^ {4}permissions:$/m);
  });

  it.each(PACKAGE_MANAGERS)('keeps the AI review job free of dependency installs (%s)', (packageManager) => {
    const aiReview = jobsOf(render(providerId, packageManager))['ai-review'];
    expect(aiReview).not.toContain('Install workspace dependencies');
    expect(aiReview).not.toContain('archweave-review-verdict');
  });

  it.each(PACKAGE_MANAGERS)('runs the verdict without secrets, OIDC or a write token (%s)', (packageManager) => {
    const review = jobsOf(render(providerId, packageManager))['review'];
    expect(review).toContain('archweave-review-verdict');
    expect(review).not.toContain('secrets.');
    expect(review).not.toContain('id-token');
    expect(review).toContain(['    permissions:', '      contents: read', '      pull-requests: read', ''].join('\n'));
    expect(review).not.toMatch(/: write$/m);
  });

  it.each(PACKAGE_MANAGERS)('installs the review job\'s dependencies with install scripts off (%s)', (packageManager) => {
    const install = stepsOf(jobsOf(render(providerId, packageManager))['review']).find((step) => step.includes('- name: Install workspace dependencies'));
    for (const command of INSTALL_SCRIPTS_OFF[packageManager]) expect(install).toContain(command);
  });

  it.each(PACKAGE_MANAGERS)('posts the verdict comment from a job that neither checks out nor installs (%s)', (packageManager) => {
    const comment = jobsOf(render(providerId, packageManager))['review-comment'];
    expect(comment).not.toContain('actions/checkout');
    expect(comment).not.toMatch(/install/i);
    expect(comment).not.toContain('secrets.');
    expect(comment).toContain(['    permissions:', '      pull-requests: write', ''].join('\n'));
  });

  it.each(PACKAGE_MANAGERS)('passes job outputs into scripts through env, never inline (%s)', (packageManager) => {
    for (const job of Object.values(jobsOf(render(providerId, packageManager)))) {
      for (const line of runScriptsOf(job)) expect(line).not.toContain('${{ needs.');
    }
  });

  it('fails the review job on a BLOCK, after the comment is handed over', () => {
    const steps = stepsOf(jobsOf(render(providerId, 'npm'))['review']);
    const compute = steps.find((step) => step.includes('- name: Compute review verdict'));
    expect(compute).toContain("ARCHWEAVE_VERDICT_OUTPUT: 'github-output'");
    const fail = steps.at(-1);
    expect(fail).toContain("if: steps.verdict.outputs.blocked == 'true'");
    expect(fail).toContain('exit 1');
  });

  it('requests an OIDC token only for Claude, whose GitHub App sign-in needs one', () => {
    const jobs = jobsOf(render(providerId, 'npm'));
    expect(jobs['ai-review'].includes('      id-token: write')).toBe(providerId === 'claude');
    expect(jobs['review']).not.toContain('id-token');
    expect(jobs['review-comment']).not.toContain('id-token');
  });

  it('lets the runner decide the pnpm version from packageManager', () => {
    const yaml = render(providerId, 'pnpm');
    expect(yaml).toContain('- name: Detect pnpm version');
    expect(yaml).toContain(`jq -r '.packageManager // empty' package.json`);
    expect(yaml).toContain('version: ${{ steps.pnpm-version.outputs.version }}');
    expect(yaml).not.toMatch(/^\s*version: 10$/m);
  });
});

describe('pinned-actions.yml', () => {
  it('lists exactly the pins the generated workflows use, so Dependabot updates reach them', () => {
    const file = readFileSync(join(__dirname, '../../../../.github/workflows/pinned-actions.yml'), 'utf-8');
    const listed = file
      .split('\n')
      .map((line) => /^\s*(?:- )?uses: (.+)$/.exec(line)?.[1].trim())
      .filter((uses): uses is string => uses !== undefined);
    expect(new Set(listed)).toEqual(new Set(Object.values(ACTION_PINS)));
  });
});
