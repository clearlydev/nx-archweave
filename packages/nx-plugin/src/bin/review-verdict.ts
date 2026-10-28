#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, realpathSync } from 'node:fs';
import { runVerdictGate, VERDICT_MARKER, type ReviewLocale, type ReviewMaxRounds } from '@nx-archweave/template-engine';

export type BinExec = (command: string, args: string[], stdin?: string) => { status: number | null; stdout: string };

const realExec: BinExec = (command, args, stdin) => {
  const result = spawnSync(command, args, { encoding: 'utf-8', input: stdin });
  return { status: result.status ?? null, stdout: result.stdout ?? '' };
};

/** Appends to the file GitHub Actions reads step outputs from. */
export type OutputWriter = (path: string, text: string) => void;

const realWriteOutput: OutputWriter = (path, text) => appendFileSync(path, text);

/** `ARCHWEAVE_VERDICT_OUTPUT=github-output` hands the verdict comment to a later job instead
 * of posting it: the job that runs this bin then needs no write token. Unset (every workflow
 * generated before the mode existed), the bin posts the comment itself and exits 1 on BLOCK. */
function outputModePath(env: Record<string, string | undefined>): string | undefined {
  return env['ARCHWEAVE_VERDICT_OUTPUT'] === 'github-output' && env['GITHUB_OUTPUT'] ? env['GITHUB_OUTPUT'] : undefined;
}

/** Step outputs in GitHub's heredoc form; the delimiter is random, so no line of the comment can
 * end the value early. */
function renderStepOutputs(commentBody: string, previousId: number | undefined, blocked: boolean): string {
  let delimiter: string;
  do delimiter = `ARCHWEAVE_${randomBytes(8).toString('hex')}`;
  while (commentBody.split('\n').includes(delimiter));
  return [`comment-body<<${delimiter}`, commentBody, delimiter, `previous-comment-id=${previousId ?? ''}`, `blocked=${blocked}`, ''].join('\n');
}

/** Output mode fails closed when the comments cannot be read: the job reads them with a
 * read-only token, and a check that judged nothing must not pass a BLOCK as green. The default
 * mode (workflows generated before output mode) keeps its green skip. */
const UNREAD_COMMENTS_ERROR =
  '::error title=Review verdict not computed::Could not read PR comments, so the verdict could not be computed. ' +
  'Re-run the failed jobs to retry. If it fails again, check that the review job has pull-requests: read.';

/** Every adapter-level failure is a warning + exit 0 in the default mode. In output mode the
 * review job runs this bin only after the AI review ran in the same workflow run (the secret is
 * set, rounds remain, and the round gate's watermark arrived), so a green check there means this
 * commit was reviewed in this run and isn't a BLOCK: a BLOCK, no summary from this run, an
 * unreadable summary and unreadable comments all travel as `blocked=true` (or exit 1), and the
 * workflow's next step fails the job. */
export function runReviewVerdictBin(
  env: Record<string, string | undefined>,
  exec: BinExec,
  writeOutput: OutputWriter = realWriteOutput,
): { exitCode: number; logs: string[] } {
  const logs: string[] = [];
  const repo = env['GITHUB_REPOSITORY'];
  const pr = env['ARCHWEAVE_PR_NUMBER'];
  const maxRounds = Number(env['ARCHWEAVE_MAX_ROUNDS']);
  const locale: ReviewLocale = env['ARCHWEAVE_LOCALE'] === 'ko' ? 'ko' : 'en';
  if (!repo || !pr || !Number.isInteger(maxRounds) || maxRounds < 1) {
    logs.push('verdict gate: required environment missing or malformed — skipping (check stays green).');
    return { exitCode: 0, logs };
  }
  // Both optional, so a workflow rendered before them still runs (unbound, as it was): the round
  // gate's watermark binds the judged round to this run, the head SHA is named in the comment.
  const watermark = env['ARCHWEAVE_ROUND_AFTER_ID'];
  const roundAfterId = watermark !== undefined && /^\d+$/.test(watermark) ? Number(watermark) : undefined;
  const sha = env['ARCHWEAVE_HEAD_SHA'];
  const headSha = sha !== undefined && /^[0-9a-f]{7,40}$/i.test(sha) ? sha : undefined;
  const outputPath = outputModePath(env);
  const fetched = exec('gh', ['api', `repos/${repo}/issues/${pr}/comments`, '--paginate']);
  const pages = fetched.status === 0 ? splitConcatenatedJson(fetched.stdout) : null;
  if (pages === null) {
    if (outputPath !== undefined) return { exitCode: 1, logs: [UNREAD_COMMENTS_ERROR] };
    logs.push(
      fetched.status !== 0
        ? 'verdict gate: could not fetch PR comments via gh — skipping (check stays green).'
        : 'verdict gate: unexpected gh output — skipping (check stays green).',
    );
    return { exitCode: 0, logs };
  }
  // Only Bot-authored comments count: the review rounds are posted by the
  // provider's app/bot, and a human comment echoing the markers must not be
  // able to spoof the gate into APPROVE.
  const comments = pages
    .flatMap((page) => (Array.isArray(page) ? page : []))
    .filter(
      (c): c is { body: string; user: { type: string }; id?: number } =>
        c !== null &&
        typeof c === 'object' &&
        typeof (c as { body?: unknown }).body === 'string' &&
        (c as { user?: { type?: unknown } }).user?.type === 'Bot',
    )
    .map((c) => ({ body: c.body, id: typeof c.id === 'number' ? c.id : undefined }));
  const reviewRan = outputPath !== undefined && roundAfterId !== undefined;
  const result = runVerdictGate({ comments, maxRounds: maxRounds as ReviewMaxRounds, locale, roundAfterId, headSha, reviewRan });
  if (result.kind === 'no-review') {
    logs.push('verdict gate: no review rounds found on this PR — nothing to judge.');
    return { exitCode: 0, logs };
  }
  // One verdict comment per PR, edited every round: the newest earlier one is updated, and a
  // new one is posted only when there is none or the edit is refused (e.g. another app's).
  const previous = [...comments].reverse().find((c) => c.body.includes(VERDICT_MARKER) && c.id !== undefined);
  const failedReview = result.kind === 'no-summary' || (result.kind === 'unparseable' && result.failClosed);
  const settled = !failedReview && (result.kind === 'no-round' || result.kind === 'unparseable');
  const blocked = failedReview || (result.kind === 'verdict' && result.exitCode !== 0);
  if (outputPath !== undefined) {
    writeOutput(outputPath, renderStepOutputs(result.commentBody, previous?.id, blocked));
  } else {
    const payload = JSON.stringify({ body: result.commentBody });
    const updated =
      previous !== undefined &&
      exec('gh', ['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${previous.id}`, '--input', '-'], payload).status === 0;
    if (!updated) {
      const post = exec('gh', ['api', '-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '--input', '-'], payload);
      if (post.status !== 0) logs.push('verdict gate: could not post the verdict comment (continuing).');
    }
  }
  if (failedReview) {
    logs.push(
      result.kind === 'no-summary'
        ? '::error title=AI review posted no summary::The AI review ran but posted no summary for this commit, so there is no verdict. Review the PR manually, or re-run all jobs.'
        : '::error title=AI review summary unreadable::The AI review summary has no readable findings block, so there is no verdict. Review the PR manually, or re-run all jobs.',
    );
    return { exitCode: 0, logs };
  }
  if (settled) {
    logs.push(
      result.kind === 'no-round'
        ? 'verdict gate: this run posted no review round for the current commit — earlier rounds are not judged again; check stays green.'
        : 'verdict gate: review output was not machine-readable — human review requested, check stays green.',
    );
    return { exitCode: 0, logs };
  }
  if (result.kind !== 'verdict') return { exitCode: 0, logs };
  logs.push(`verdict gate: ${result.verdict}`);
  return { exitCode: outputPath === undefined ? result.exitCode : 0, logs };
}

/** gh api --paginate emits each page's JSON back-to-back ("[...][...]") —
 * raw JSON.parse throws on page two, which would silently green-skip the gate
 * on any PR past 100 comments. This splits top-level JSON
 * values with a string-aware depth scan and parses each. */
function splitConcatenatedJson(stdout: string): unknown[] | null {
  const text = stdout.trim();
  if (text === '') return [];
  const values: unknown[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          values.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          return null;
        }
        start = i + 1;
      }
    }
  }
  if (depth !== 0 || text.slice(start).trim() !== '') return null;
  return values;
}

/* The thin entrypoint: everything above is exercised by tests through an
 * injected exec; this guard only fires when invoked as the installed bin. */
let invokedAsBin = false;
try {
  // npm/yarn expose the bin as a symlink named after the command, so argv[1]
  // must be realpath'd before comparing.
  invokedAsBin = process.argv[1] !== undefined && realpathSync(process.argv[1]).endsWith('review-verdict.js');
} catch {
  invokedAsBin = false;
}
if (invokedAsBin) {
  const { exitCode, logs } = runReviewVerdictBin(process.env, realExec);
  for (const line of logs) console.log(line);
  process.exit(exitCode);
}
