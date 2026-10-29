import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REVIEW_PROVIDERS } from './provider.ts';
import { REVIEW_JOB_TIMEOUT_MINUTES } from './workflow-skeleton.ts';

/** The `review` job of a rendered workflow, step by step. */
function reviewJobSteps(providerId: keyof typeof REVIEW_PROVIDERS): string[] {
  const yaml = REVIEW_PROVIDERS[providerId].buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'npm' });
  const start = yaml.indexOf('\n  review:\n');
  const job = yaml.slice(start, yaml.indexOf('\n  review-comment:\n'));
  return job
    .split(/\n(?=\s*- name: )/)
    .slice(1)
    .filter((step) => step.trim() !== '');
}

function stepNamed(steps: string[], name: string): string {
  const step = steps.find((s) => s.includes(`- name: ${name}`));
  if (step === undefined) throw new Error(`no step "${name}"`);
  return step;
}

/** A step's `run: |` script, de-indented as the runner sees it. */
function scriptOf(step: string): string {
  const lines = step.split('\n');
  const body = lines.slice(lines.findIndex((line) => line.trimEnd().endsWith('run: |')) + 1);
  const indent = Math.min(...body.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length));
  return body.map((line) => line.slice(indent)).join('\n');
}

/** Step outputs as GitHub reads them: `name=value` lines and `name<<DELIMITER` blocks. */
function parseOutputs(text: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const heredoc = /^([\w-]+)<<(.+)$/.exec(lines[i]);
    if (heredoc) {
      const end = lines.indexOf(heredoc[2], i + 1);
      outputs[heredoc[1]] = lines.slice(i + 1, end).join('\n');
      i = end;
    } else if (lines[i].includes('=')) {
      outputs[lines[i].slice(0, lines[i].indexOf('='))] = lines[i].slice(lines[i].indexOf('=') + 1);
    }
  }
  return outputs;
}

/** Runs a script with bash the way a step does; returns its exit code, the outputs it wrote, its
 * job summary and its log. */
function runStep(script: string, env: Record<string, string>): { exitCode: number; outputs: Record<string, string>; summary: string; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), 'review-check-'));
  const outputFile = join(dir, 'output');
  const summaryFile = join(dir, 'summary');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');
  try {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      env: { PATH: process.env['PATH'] ?? '', ...env, GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile },
      encoding: 'utf-8',
    });
    return {
      exitCode: result.status ?? 1,
      outputs: parseOutputs(readFileSync(outputFile, 'utf-8')),
      summary: readFileSync(summaryFile, 'utf-8'),
      stdout: result.stdout,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Scenario {
  name: string;
  /** What the `review` job sees of the `ai-review` job: its result and its outputs. */
  aiReview: { result: 'success' | 'failure' | 'cancelled' | 'skipped'; enabled: string; allowed: string; lastCommentId: string };
  /** What the verdict bin reports, when the verdict runs. */
  blocked?: boolean;
  /** The single-job workflow's check result for the same run. */
  singleJob: 'success' | 'failure';
}

const SCENARIOS: Scenario[] = [
  { name: 'a BLOCK verdict', aiReview: { result: 'success', enabled: 'true', allowed: 'true', lastCommentId: '42' }, blocked: true, singleJob: 'failure' },
  { name: 'a clean verdict', aiReview: { result: 'success', enabled: 'true', allowed: 'true', lastCommentId: '42' }, blocked: false, singleJob: 'success' },
  { name: 'a failed provider step', aiReview: { result: 'failure', enabled: 'true', allowed: 'true', lastCommentId: '42' }, singleJob: 'failure' },
  { name: 'a cancelled AI review', aiReview: { result: 'cancelled', enabled: 'true', allowed: 'true', lastCommentId: '42' }, singleJob: 'failure' },
  // The job's timeout-minutes stopped it mid-review; GitHub reports such a job as cancelled or failed.
  { name: 'an AI review stopped by its timeout (cancelled)', aiReview: { result: 'cancelled', enabled: 'true', allowed: 'true', lastCommentId: '42' }, singleJob: 'failure' },
  { name: 'an AI review stopped by its timeout (failure)', aiReview: { result: 'failure', enabled: 'true', allowed: 'true', lastCommentId: '42' }, singleJob: 'failure' },
  { name: 'no provider secret', aiReview: { result: 'success', enabled: 'false', allowed: '', lastCommentId: '' }, singleJob: 'success' },
  { name: 'the round limit reached', aiReview: { result: 'success', enabled: 'true', allowed: 'false', lastCommentId: '42' }, singleJob: 'success' },
  // A PR with no comments yet: the round gate's watermark is 0, a number like any other.
  { name: 'a BLOCK on a PR with no comments yet', aiReview: { result: 'success', enabled: 'true', allowed: 'true', lastCommentId: '0' }, blocked: true, singleJob: 'failure' },
  { name: 'a clean verdict on a PR with no comments yet', aiReview: { result: 'success', enabled: 'true', allowed: 'true', lastCommentId: '0' }, blocked: false, singleJob: 'success' },
];

/** Runs the single job never had: the AI review job's results do not reach the review job (a
 * re-run that lost them, a result other than success/failure/cancelled). None may read as
 * "review switched off" — a BLOCK would pass as green. */
const MISSING_RESULTS: Scenario[] = [
  { name: 'all of the AI review job\'s outputs empty', aiReview: { result: 'success', enabled: '', allowed: '', lastCommentId: '' }, singleJob: 'failure' },
  { name: 'allowed empty', aiReview: { result: 'success', enabled: 'true', allowed: '', lastCommentId: '42' }, singleJob: 'failure' },
  { name: 'last-comment-id empty', aiReview: { result: 'success', enabled: 'true', allowed: 'true', lastCommentId: '' }, singleJob: 'failure' },
  { name: 'last-comment-id not a number', aiReview: { result: 'success', enabled: 'true', allowed: 'true', lastCommentId: '1;exit 0' }, singleJob: 'failure' },
  { name: 'an unexpected enabled value', aiReview: { result: 'success', enabled: 'yes', allowed: 'true', lastCommentId: '42' }, singleJob: 'failure' },
  { name: 'a skipped AI review', aiReview: { result: 'skipped', enabled: 'true', allowed: 'true', lastCommentId: '42' }, singleJob: 'failure' },
];

/** The `review` check's result: the first step decides whether the verdict runs; the verdict
 * reports `blocked`; the last step fails the job on it. Install and checkout are taken as passing. */
function reviewCheck(providerId: keyof typeof REVIEW_PROVIDERS, scenario: Scenario): 'success' | 'failure' {
  const steps = reviewJobSteps(providerId);
  const first = runStep(scriptOf(stepNamed(steps, 'Check the AI review result')), {
    AI_REVIEW_RESULT: scenario.aiReview.result,
    REVIEW_ENABLED: scenario.aiReview.enabled,
    REVIEW_ALLOWED: scenario.aiReview.allowed,
    LAST_COMMENT_ID: scenario.aiReview.lastCommentId,
  });
  if (first.exitCode !== 0) return 'failure';
  if (first.outputs['run'] !== 'true') return 'success';
  if (scenario.blocked === undefined) throw new Error(`${scenario.name}: the verdict ran but the scenario gives no verdict`);
  const blockStep = stepNamed(steps, 'Fail the review check');
  expect(blockStep).toContain("if: steps.verdict.outputs.blocked == 'true'");
  if (!scenario.blocked) return 'success';
  return runStep(scriptOf(blockStep), {}).exitCode === 0 ? 'success' : 'failure';
}

/** What the first step of the review job reports when the AI review did not run, for one PR. */
function notRun(providerId: keyof typeof REVIEW_PROVIDERS, aiReview: Scenario['aiReview'], pr: { headRepository?: string; author?: string; headSha?: string } = {}) {
  return runStep(scriptOf(stepNamed(reviewJobSteps(providerId), 'Check the AI review result')), {
    AI_REVIEW_RESULT: aiReview.result,
    REVIEW_ENABLED: aiReview.enabled,
    REVIEW_ALLOWED: aiReview.allowed,
    LAST_COMMENT_ID: aiReview.lastCommentId,
    HEAD_SHA: pr.headSha ?? 'abcdef0123456789abcdef0123456789abcdef01',
    HEAD_REPOSITORY: pr.headRepository ?? 'owner/repo',
    REPOSITORY: 'owner/repo',
    PR_AUTHOR: pr.author ?? 'someone',
  });
}

const NO_SECRET: Scenario['aiReview'] = { result: 'success', enabled: 'false', allowed: '', lastCommentId: '' };
const GREEN_IS_NOT_A_REVIEW = 'A green check here does not mean the change was reviewed.';

describe.each(Object.keys(REVIEW_PROVIDERS) as (keyof typeof REVIEW_PROVIDERS)[])('%s: a green check without an AI review says so', (providerId) => {
  const secretName = REVIEW_PROVIDERS[providerId].requiredSecretName;

  it.each([
    ['the secret is not registered', {}, `the ${secretName} secret is not registered`],
    ['a pull request from a fork', { headRepository: 'someone/fork' }, 'this pull request comes from a fork'],
    ['a deleted fork (no head repository)', { headRepository: '' }, 'this pull request comes from a fork'],
    ['a Dependabot pull request', { author: 'dependabot[bot]' }, 'Dependabot runs receive only Dependabot secrets'],
  ] as const)('%s: green, with the reason in the annotation, the job summary and the verdict comment', (_name, pr, reason) => {
    const { exitCode, outputs, summary, stdout } = notRun(providerId, NO_SECRET, pr);
    expect(exitCode).toBe(0);
    expect(outputs['run']).toBe('false');
    expect(stdout).toContain(`::notice title=AI review did not run::AI review did not run for this commit (${reason}`);
    expect(stdout).toContain(GREEN_IS_NOT_A_REVIEW);
    expect(summary).toContain(reason);
    expect(outputs['notice-body']).toContain('<!-- archweave-verdict -->');
    expect(outputs['notice-body']).toContain(GREEN_IS_NOT_A_REVIEW);
    expect(outputs['notice-body']).toContain('Commit `abcdef0`');
  });

  it('the round limit: green, and says the limit was reached', () => {
    const { exitCode, stdout } = notRun(providerId, { result: 'success', enabled: 'true', allowed: 'false', lastCommentId: '42' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('the automated review round limit (3) is reached');
  });

  it('a head SHA that is not hex is left out of the comment', () => {
    const { outputs } = notRun(providerId, NO_SECRET, { headSha: '$(touch /tmp/x)' });
    expect(outputs['notice-body']).not.toContain('Commit');
    expect(outputs['notice-body']).not.toContain('touch');
  });

  it('a review that ran writes no notice', () => {
    expect(notRun(providerId, { result: 'success', enabled: 'true', allowed: 'true', lastCommentId: '42' }).outputs['notice-body']).toBeUndefined();
  });

  it('hands the notice to the review-comment job, which finds the earlier verdict comment itself', () => {
    const yaml = REVIEW_PROVIDERS[providerId].buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'npm' });
    expect(yaml).toContain('comment-body: ${{ steps.verdict.outputs.comment-body || steps.ai-review-result.outputs.notice-body }}');
    expect(yaml).toContain('select(.user.login == "github-actions[bot]") | select(.body | contains("<!-- archweave-verdict -->"))');
  });

  it('writes the notice in the review language', () => {
    const yaml = REVIEW_PROVIDERS[providerId].buildWorkflowYaml({ mode: 'fast', locale: 'ko', maxRounds: 3, packageManager: 'npm' });
    expect(yaml).toContain('이 green 체크는 변경 사항이 리뷰되었다는 뜻이 아닙니다.');
  });
});

describe.each(Object.keys(REVIEW_PROVIDERS) as (keyof typeof REVIEW_PROVIDERS)[])('%s: the review check ends as the single job did', (providerId) => {
  it.each(SCENARIOS)('$name → $singleJob', (scenario) => {
    expect(reviewCheck(providerId, scenario)).toBe(scenario.singleJob);
  });

  it.each(MISSING_RESULTS)('$name → failure, never "review switched off"', (scenario) => {
    expect(reviewCheck(providerId, scenario)).toBe('failure');
  });

  it('a timed-out AI review still runs the review job, so the required check fails instead of being skipped', () => {
    const yaml = REVIEW_PROVIDERS[providerId].buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'npm' });
    const aiReview = yaml.slice(yaml.indexOf('\n  ai-review:\n'), yaml.indexOf('\n  review:\n'));
    expect(aiReview).toContain(`    timeout-minutes: ${REVIEW_JOB_TIMEOUT_MINUTES}\n`);
    // A skipped job counts as passed for a required check; `always()` keeps a stopped
    // dependency from skipping it, where the default success() would not.
    expect(yaml).toContain(['  review:', '    needs: ai-review', '    if: always()', ''].join('\n'));
  });

  it.each([
    ['block', 'The AI verdict is BLOCK'],
    ['no-summary', 'posted no summary for this commit'],
    ['unreadable', 'no readable findings block'],
    ['', 'See the verdict comment'],
  ])('the failing step names the reason (%s)', (reason, text) => {
    const result = spawnSync('bash', ['-e', '-c', scriptOf(stepNamed(reviewJobSteps(providerId), 'Fail the review check'))], { env: { PATH: process.env['PATH'] ?? '', BLOCK_REASON: reason }, encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(text);
  });

  it('runs whatever the AI review job did, and judges only after checking its result', () => {
    const yaml = REVIEW_PROVIDERS[providerId].buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'npm' });
    expect(yaml).toContain(['  review:', '    needs: ai-review', '    if: always()', ''].join('\n'));
    const [first, ...rest] = reviewJobSteps(providerId);
    expect(first).toContain('- name: Check the AI review result');
    for (const step of rest) expect(step).toMatch(/^\s+if: steps\.(ai-review-result|verdict)\.outputs\./m);
  });
});
