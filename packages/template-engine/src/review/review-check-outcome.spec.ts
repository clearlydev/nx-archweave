import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REVIEW_PROVIDERS } from './provider.ts';

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

/** Runs a script with bash the way a step does; returns its exit code and the outputs it wrote. */
function runStep(script: string, env: Record<string, string>): { exitCode: number; outputs: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 'review-check-'));
  const outputFile = join(dir, 'output');
  writeFileSync(outputFile, '');
  try {
    const result = spawnSync('bash', ['-e', '-c', script], { env: { PATH: process.env['PATH'] ?? '', ...env, GITHUB_OUTPUT: outputFile }, encoding: 'utf-8' });
    const outputs = Object.fromEntries(
      readFileSync(outputFile, 'utf-8')
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    return { exitCode: result.status ?? 1, outputs };
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
  const blockStep = stepNamed(steps, 'Fail on a blocking verdict');
  expect(blockStep).toContain("if: steps.verdict.outputs.blocked == 'true'");
  if (!scenario.blocked) return 'success';
  return runStep(scriptOf(blockStep), {}).exitCode === 0 ? 'success' : 'failure';
}

describe.each(Object.keys(REVIEW_PROVIDERS) as (keyof typeof REVIEW_PROVIDERS)[])('%s: the review check ends as the single job did', (providerId) => {
  it.each(SCENARIOS)('$name → $singleJob', (scenario) => {
    expect(reviewCheck(providerId, scenario)).toBe(scenario.singleJob);
  });

  it.each(MISSING_RESULTS)('$name → failure, never "review switched off"', (scenario) => {
    expect(reviewCheck(providerId, scenario)).toBe('failure');
  });

  it('runs whatever the AI review job did, and judges only after checking its result', () => {
    const yaml = REVIEW_PROVIDERS[providerId].buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'npm' });
    expect(yaml).toContain(['  review:', '    needs: ai-review', '    if: always()', ''].join('\n'));
    const [first, ...rest] = reviewJobSteps(providerId);
    expect(first).toContain('- name: Check the AI review result');
    for (const step of rest) expect(step).toMatch(/^\s+if: steps\.(ai-review-result|verdict)\.outputs\./m);
  });
});
