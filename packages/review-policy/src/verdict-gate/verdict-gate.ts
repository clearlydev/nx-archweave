import { computeVerdict, type ReviewFinding, type ReviewVerdict } from '../schema/review-finding.ts';
import type { ReviewLocale, ReviewMaxRounds } from '../schema/review-policy-config.ts';
import type { RoundHistoryEntry } from '../renderers/render-review-comment.ts';
import { extractFindingsBlock, findingKey, type FindingsBlockResult } from './findings-block.ts';
import { renderNoRoundNotice, renderNoSummaryNotice, renderUnparseableNotice, renderVerdictComment, VERDICT_MARKER } from './verdict-comment.ts';

/** Moved here from template-engine's workflow-skeleton (single source — the
 * gate and the workflow renderer must agree on it); template-engine re-exports. */
export const ROUND_MARKER = '<!-- archweave-review-round -->';

export type VerdictGateResult =
  | { kind: 'no-review' }
  /** reviewRan, and this run left no round for the commit: the check fails. */
  | { kind: 'no-summary'; commentBody: string }
  /** `failClosed` is reviewRan: the summary exists but its verdict can't be read, so it fails. */
  | { kind: 'unparseable'; commentBody: string; failClosed: boolean }
  | { kind: 'no-round'; commentBody: string }
  | { kind: 'verdict'; verdict: ReviewVerdict; commentBody: string; exitCode: 0 | 1 };

interface Round {
  round: number; // 1-based posting order
  id: number | undefined;
  extraction: FindingsBlockResult;
}

export function collectRounds(comments: readonly { body: string; id?: number }[]): Round[] {
  return comments
    .filter((c) => c.body.includes(ROUND_MARKER) && !c.body.includes(VERDICT_MARKER))
    .map((c, index) => ({ round: index + 1, id: c.id, extraction: extractFindingsBlock(c.body) }));
}

/** Lines two reports of one defect may drift apart between rounds (an edit above it, or the
 * model citing the call instead of the function). */
const LINE_DRIFT = 3;

/** Whether two findings from consecutive rounds report the same defect. The model rewords a
 * finding every round — another category name (`remote-code-execution`, then `code-injection`),
 * a start line a few lines off — so only the file and the lines count: the same file and line
 * ranges that overlap, give or take LINE_DRIFT. Two different defects on the same lines count
 * once, which only affects the progress shown, never the verdict. */
function sameDefect(a: ReviewFinding, b: ReviewFinding): boolean {
  if (a.file !== b.file) return false;
  const aEnd = a.lineRange.end ?? a.lineRange.start;
  const bEnd = b.lineRange.end ?? b.lineRange.start;
  return a.lineRange.start <= bEnd + LINE_DRIFT && b.lineRange.start <= aEnd + LINE_DRIFT;
}

/** Unparseable past rounds are skipped (a gap, never zeros). */
export function computeRoundHistory(rounds: readonly Round[]): RoundHistoryEntry[] {
  const parsed = rounds.filter(
    (r): r is Round & { extraction: { status: 'ok'; findings: ReviewFinding[] } } => r.extraction.status === 'ok',
  );
  const history: RoundHistoryEntry[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const keys = new Set(parsed[i].extraction.findings.map(findingKey));
    if (i === 0) {
      history.push({ round: parsed[i].round, fixedFindingKeys: [], remainingFindingKeys: [...keys] });
      continue;
    }
    const current = parsed[i].extraction.findings;
    history.push({
      round: parsed[i].round,
      fixedFindingKeys: parsed[i - 1].extraction.findings.filter((finding) => !current.some((now) => sameDefect(finding, now))).map(findingKey),
      remainingFindingKeys: [...keys],
    });
  }
  return history;
}

/** Red for a parsed BLOCK, and, once `reviewRan` says the AI review ran in this workflow run,
 * for anything short of a readable round from that run (`no-summary`, a fail-closed
 * `unparseable`). Without `reviewRan` (a run that skipped the review, or a workflow generated
 * before the review job gated the bin on it) those degrade green as before. */
export function runVerdictGate(input: {
  comments: readonly { body: string; id?: number }[];
  maxRounds: ReviewMaxRounds;
  locale: ReviewLocale;
  /** The newest comment id before this run's review step (the round gate's watermark). Set, the
   * latest round must be newer — posted by this run, for this commit — or nothing is judged. */
  roundAfterId?: number;
  /** The commit this run reviewed, named in the posted comment. */
  headSha?: string;
  /** The AI review step ran in this workflow run (the secret is set and rounds remain), so a
   * missing or unreadable round is a review that failed, never a review that was switched off. */
  reviewRan?: boolean;
}): VerdictGateResult {
  const rounds = collectRounds(input.comments);
  const reviewRan = input.reviewRan === true;
  if (rounds.length === 0) {
    return reviewRan ? { kind: 'no-summary', commentBody: renderNoSummaryNotice(input.locale, input.headSha) } : { kind: 'no-review' };
  }
  const latest = rounds[rounds.length - 1];
  if (input.roundAfterId !== undefined && (latest.id === undefined || latest.id <= input.roundAfterId)) {
    // Judging an earlier commit's round again would pass or block this commit on a review it never got.
    return reviewRan
      ? { kind: 'no-summary', commentBody: renderNoSummaryNotice(input.locale, input.headSha) }
      : { kind: 'no-round', commentBody: renderNoRoundNotice(input.locale, input.headSha) };
  }
  if (latest.extraction.status !== 'ok') {
    return { kind: 'unparseable', commentBody: renderUnparseableNotice(input.locale, input.headSha, reviewRan), failClosed: reviewRan };
  }
  const verdict = computeVerdict(latest.extraction.findings);
  const commentBody = renderVerdictComment({
    verdict,
    history: computeRoundHistory(rounds),
    maxRounds: input.maxRounds,
    locale: input.locale,
    isFinalRound: rounds.length >= input.maxRounds,
    headSha: input.headSha,
  });
  return { kind: 'verdict', verdict, commentBody, exitCode: verdict === 'BLOCK' ? 1 : 0 };
}
