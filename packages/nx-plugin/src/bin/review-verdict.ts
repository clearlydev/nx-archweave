#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { runVerdictGate, VERDICT_MARKER, type ReviewLocale, type ReviewMaxRounds } from '@nx-archweave/template-engine';

export type BinExec = (command: string, args: string[], stdin?: string) => { status: number | null; stdout: string };

const realExec: BinExec = (command, args, stdin) => {
  const result = spawnSync(command, args, { encoding: 'utf-8', input: stdin });
  return { status: result.status ?? null, stdout: result.stdout ?? '' };
};

/** Every adapter-level failure is a warning + exit 0 — the only
 * red is a parsed BLOCK, and that decision lives in runVerdictGate. */
export function runReviewVerdictBin(
  env: Record<string, string | undefined>,
  exec: BinExec,
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
  const fetched = exec('gh', ['api', `repos/${repo}/issues/${pr}/comments`, '--paginate']);
  if (fetched.status !== 0) {
    logs.push('verdict gate: could not fetch PR comments via gh — skipping (check stays green).');
    return { exitCode: 0, logs };
  }
  const pages = splitConcatenatedJson(fetched.stdout);
  if (pages === null) {
    logs.push('verdict gate: unexpected gh output — skipping (check stays green).');
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
  const result = runVerdictGate({ comments, maxRounds: maxRounds as ReviewMaxRounds, locale, roundAfterId, headSha });
  if (result.kind === 'no-review') {
    logs.push('verdict gate: no review rounds found on this PR — nothing to judge.');
    return { exitCode: 0, logs };
  }
  // One verdict comment per PR, edited every round: the newest earlier one is updated, and a
  // new one is posted only when there is none or the edit is refused (e.g. another app's).
  const previous = [...comments].reverse().find((c) => c.body.includes(VERDICT_MARKER) && c.id !== undefined);
  const payload = JSON.stringify({ body: result.commentBody });
  const updated =
    previous !== undefined &&
    exec('gh', ['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${previous.id}`, '--input', '-'], payload).status === 0;
  if (!updated) {
    const post = exec('gh', ['api', '-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '--input', '-'], payload);
    if (post.status !== 0) logs.push('verdict gate: could not post the verdict comment (continuing).');
  }
  if (result.kind === 'no-round') {
    logs.push('verdict gate: this run posted no review round for the current commit — earlier rounds are not judged again; check stays green.');
    return { exitCode: 0, logs };
  }
  if (result.kind === 'unparseable') {
    logs.push('verdict gate: review output was not machine-readable — human review requested, check stays green.');
    return { exitCode: 0, logs };
  }
  logs.push(`verdict gate: ${result.verdict}`);
  return { exitCode: result.exitCode, logs };
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
