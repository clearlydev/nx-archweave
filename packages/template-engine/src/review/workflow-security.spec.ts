import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SupportedPackageManager } from '../environment/package-manager.ts';
import { ACTION_PINS } from './action-pins.ts';
import { REVIEW_PROVIDERS } from './provider.ts';
import { REVIEW_JOB_TIMEOUT_MINUTES, ROUND_MARKER } from './workflow-skeleton.ts';

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
  it('runs the verdict bin only after the AI review ran in this run; a switched-off review ends green', () => {
    const yaml = render(providerId, 'pnpm');
    // no secret, or the round limit: nothing to judge, the bin never runs
    expect(yaml).toMatch(/^ +false\/\*\)\n/m);
    expect(yaml).toMatch(/^ +true\/false\)\n +not_run rounds\n/m);
    expect(yaml).toMatch(/^ +echo "run=false"\n/m);
    // the bin, and the step that fails the check, only run when run=true
    const compute = yaml.slice(yaml.indexOf('- name: Compute review verdict'));
    expect(compute).toMatch(/^ {8}if: steps\.ai-review-result\.outputs\.run == 'true'$/m);
    expect(yaml).toContain("ARCHWEAVE_VERDICT_OUTPUT: 'github-output'");
    expect(yaml).toContain('ARCHWEAVE_ROUND_AFTER_ID: ${{ needs.ai-review.outputs.last-comment-id }}');
    expect(yaml).toContain("if: steps.verdict.outputs.blocked == 'true'");
  });

  it('says "AI review did not run" from the review job alone: no secret, no AI review, nothing inline', () => {
    const jobs = jobsOf(render(providerId, 'npm'));
    const notRunStep = stepsOf(jobs['review']).find((step) => step.includes('- name: Check the AI review result')) ?? '';
    expect(notRunStep).toContain('::notice title=AI review did not run::');
    expect(notRunStep).not.toContain('secrets.');
    expect(notRunStep.slice(notRunStep.indexOf('  run: |'))).not.toContain('${{');
    expect(jobs['ai-review']).not.toContain('AI review did not run for this commit');
    expect(jobs['review-comment']).not.toContain('secrets.');
  });

  it('stops every job after 15 minutes instead of GitHub\'s 360-minute default', () => {
    const yaml = render(providerId, 'pnpm');
    const jobs = [...yaml.matchAll(/^ {2}([a-z-]+):\n((?: {4}.*\n|\n)*)/gm)].map(([, name, body]) => ({ name, body }));
    expect(jobs.map((job) => job.name)).toEqual(['ai-review', 'review', 'review-comment']);
    expect(REVIEW_JOB_TIMEOUT_MINUTES).toBe(15);
    for (const job of jobs) expect(job.body).toMatch(/^ {4}timeout-minutes: 15$/m);
  });

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

  it.each(PACKAGE_MANAGERS)('uploads no artifact, so no workflow_run workflow can pick up anything a pull request wrote (%s)', (packageManager) => {
    const variants = [
      render(providerId, packageManager),
      REVIEW_PROVIDERS[providerId].buildWorkflowYaml({ mode: 'fast', locale: 'ko', maxRounds: 1, packageManager }),
    ];
    for (const yaml of variants) {
      expect(yaml).not.toMatch(/actions\/upload-artifact|actions\/download-artifact/);
      expect(yaml).not.toMatch(/^\s*(- )?uses: [\w.-]+\/[\w.-]*artifact/m);
    }
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

describe('claude workflow: the agent\'s tools and the denial report', () => {
  const yaml = render('claude', 'pnpm');
  const aiReview = jobsOf(yaml)['ai-review'];
  const deniedStep = stepsOf(aiReview).find((step) => step.includes('- name: Show denied tool calls')) ?? '';
  const deniedScript = (() => {
    const lines = deniedStep.slice(deniedStep.indexOf('  run: |\n')).split('\n').slice(1);
    const indent = Math.min(...lines.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length));
    return lines.map((line) => line.slice(indent)).join('\n');
  })();

  /** Runs the step the way the runner does (bash -e -o pipefail) on an execution file. */
  function runDeniedStep(executionFile: string | undefined): { exitCode: number; lines: string[] } {
    const dir = mkdtempSync(join(tmpdir(), 'denied-tools-'));
    try {
      const path = join(dir, 'claude-execution-output.json');
      if (executionFile !== undefined) writeFileSync(path, executionFile);
      const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', deniedScript], {
        env: { PATH: process.env['PATH'] ?? '', EXECUTION_FILE: path },
        encoding: 'utf-8',
      });
      return { exitCode: result.status ?? 1, lines: result.stdout.split('\n').filter((line) => line !== '') };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('allows exactly the tools of claude-code-action\'s PR-review examples: no shell at large, no API, no file writes', () => {
    expect(yaml).toContain(
      '--allowedTools "mcp__github_inline_comment__create_inline_comment,Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*)"',
    );
    const tools = /--allowedTools "([^"]*)"/.exec(yaml)?.[1].split(',') ?? [];
    for (const tool of tools) expect(tool).not.toMatch(/^(Bash(\(\*\))?|Bash\(gh api.*|Write|Edit|MultiEdit|NotebookEdit)$/);
    expect(yaml).not.toContain('--permission-mode');
    expect(yaml).not.toContain('--dangerously-skip-permissions');
  });

  it('names the repository and the pull request in the prompt, and the safe way to post the summary', () => {
    for (const locale of ['en', 'ko'] as const) {
      const text = REVIEW_PROVIDERS.claude.buildWorkflowYaml({ mode: 'standard', locale, maxRounds: 3, packageManager: 'pnpm' });
      expect(text).toContain('REPO: ${{ github.repository }}');
      expect(text).toContain('PR NUMBER: ${{ github.event.pull_request.number }}');
      expect(text).toContain("gh pr comment <PR NUMBER> --body-file - <<'ARCHWEAVE_EOF'");
    }
  });

  it('keeps the action\'s full-output and report switches off and uploads nothing', () => {
    expect(yaml).not.toContain('show_full_output');
    expect(yaml).not.toContain('display_report');
    expect(yaml).not.toContain('upload-artifact');
  });

  it('reads the denials only from the review step\'s execution file, after it ran or failed', () => {
    expect(aiReview).toContain('  id: claude-review\n');
    expect(deniedStep).toContain("if: always() && steps.claude-review.outputs.execution_file != ''");
    expect(deniedStep).toContain('EXECUTION_FILE: ${{ steps.claude-review.outputs.execution_file }}');
    expect(deniedScript).not.toContain('${{');
  });

  it('prints each denial as one escaped JSON line between stop-commands and a random token', () => {
    const injected = 'gh api repos/x/y -f body=1\n::error::forged\n::add-mask::x ' + 'a'.repeat(300);
    const { exitCode, lines } = runDeniedStep(
      JSON.stringify([
        { type: 'user', message: { content: [{ type: 'tool_result', content: 'TOOL-OUTPUT-NEVER-PRINTED' }] } },
        {
          type: 'result',
          permission_denials: [
            { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: injected } },
            { tool_name: 'mcp__github__get_file', tool_use_id: 't2', tool_input: { path: 'INPUT-NEVER-PRINTED' } },
          ],
        },
      ]),
    );
    expect(exitCode).toBe(0);
    const token = /^::stop-commands::(archweave-[0-9a-f]{32})$/.exec(lines[0])?.[1];
    expect(token).toBeDefined();
    expect(lines.at(-1)).toBe(`::${token}::`);
    const denials = lines.slice(1, -1);
    expect(denials).toHaveLength(2);
    for (const line of denials) expect(line.startsWith('{')).toBe(true);
    expect(JSON.parse(denials[0])).toEqual({ tool: 'Bash', command: injected.slice(0, 200) });
    expect(JSON.parse(denials[1])).toEqual({ tool: 'mcp__github__get_file', command: '' });
    const output = lines.join('\n');
    expect(output).not.toContain('TOOL-OUTPUT-NEVER-PRINTED');
    expect(output).not.toContain('INPUT-NEVER-PRINTED');
  });

  it('prints why the run ended in an error, as one escaped line, and nothing for a run that succeeded', () => {
    const failed = runDeniedStep(JSON.stringify([{ type: 'result', is_error: true, result: 'Invalid API key\n::error::forged ' + 'x'.repeat(400), permission_denials: [] }]));
    expect(failed.exitCode).toBe(0);
    const lines = failed.lines.slice(1, -1);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).error).toBe(('Invalid API key\n::error::forged ' + 'x'.repeat(400)).slice(0, 300));
    expect(runDeniedStep(JSON.stringify([{ type: 'result', is_error: false, result: 'done', permission_denials: [] }])).lines.slice(1, -1)).toEqual([]);
  });

  it('two runs never share a stop token', () => {
    const empty = JSON.stringify([{ type: 'result', permission_denials: [] }]);
    expect(runDeniedStep(empty).lines[0]).not.toBe(runDeniedStep(empty).lines[0]);
  });

  it('never fails the job: no execution file, or one that is not JSON', () => {
    expect(runDeniedStep(undefined)).toEqual({ exitCode: 0, lines: [] });
    const broken = runDeniedStep('not json');
    expect(broken.exitCode).toBe(0);
    expect(broken.lines.at(-1)).toMatch(/^::archweave-[0-9a-f]{32}::$/);
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
