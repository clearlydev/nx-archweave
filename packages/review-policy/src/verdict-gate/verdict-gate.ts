import { computeVerdict, type ReviewFinding, type ReviewVerdict } from '../schema/review-finding.ts';
import type { ReviewLocale, ReviewMaxRounds } from '../schema/review-policy-config.ts';
import type { RoundHistoryEntry } from '../renderers/render-review-comment.ts';
import { extractFindingsBlock, findingKey, type FindingsBlockResult } from './findings-block.ts';
import { renderNoRoundNotice, renderUnparseableNotice, renderVerdictComment, VERDICT_MARKER } from './verdict-comment.ts';

/** Moved here from template-engine's workflow-skeleton (single source — the
 * gate and the workflow renderer must agree on it); template-engine re-exports. */
export const ROUND_MARKER = '<!-- archweave-review-round -->';

export type VerdictGateResult =
  | { kind: 'no-review' }
  | { kind: 'unparseable'; commentBody: string }
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
    const previous = new Set(parsed[i - 1].extraction.findings.map(findingKey));
    history.push({
      round: parsed[i].round,
      fixedFindingKeys: [...previous].filter((key) => !keys.has(key)),
      remainingFindingKeys: [...keys],
    });
  }
  return history;
}

/** The only exit 1 is a parsed BLOCK. Everything else degrades green. */
export function runVerdictGate(input: {
  comments: readonly { body: string; id?: number }[];
  maxRounds: ReviewMaxRounds;
  locale: ReviewLocale;
  /** The newest comment id before this run's review step (the round gate's watermark). Set, the
   * latest round must be newer — posted by this run, for this commit — or nothing is judged. */
  roundAfterId?: number;
  /** The commit this run reviewed, named in the posted comment. */
  headSha?: string;
}): VerdictGateResult {
  const rounds = collectRounds(input.comments);
  if (rounds.length === 0) return { kind: 'no-review' };
  const latest = rounds[rounds.length - 1];
  if (input.roundAfterId !== undefined && (latest.id === undefined || latest.id <= input.roundAfterId)) {
    // Judging an earlier commit's round again would pass or block this commit on a review it never got.
    return { kind: 'no-round', commentBody: renderNoRoundNotice(input.locale, input.headSha) };
  }
  if (latest.extraction.status !== 'ok') {
    return { kind: 'unparseable', commentBody: renderUnparseableNotice(input.locale, input.headSha) };
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
