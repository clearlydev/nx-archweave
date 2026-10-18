import type { ReviewVerdict } from '../schema/review-finding.ts';
import type { ReviewLocale, ReviewMaxRounds } from '../schema/review-policy-config.ts';
import {
  terminationBannerLine,
  verdictLine,
  type RoundHistoryEntry,
} from '../renderers/render-review-comment.ts';

export const VERDICT_MARKER = '<!-- archweave-verdict -->';

const HISTORY_HEADING: Record<ReviewLocale, string> = { en: '**Round history:**', ko: '**라운드 이력:**' };
const ROUND_LINE: Record<ReviewLocale, (round: number, fixed: number, remaining: number) => string> = {
  en: (round, fixed, remaining) => `- round ${round}: ${fixed} fixed, ${remaining} remaining`,
  ko: (round, fixed, remaining) => `- ${round}차: ${fixed}건 해결, ${remaining}건 잔존`,
};
const UNPARSEABLE_NOTICE: Record<ReviewLocale, string> = {
  en: '⚠️ The review comment could not be machine-read (missing or invalid findings block). The verdict gate stays green; please review this PR manually.',
  ko: '⚠️ 리뷰 코멘트를 기계 판독하지 못했습니다(findings 블록 누락 또는 손상). verdict 게이트는 녹색으로 두니 이 PR은 사람이 직접 리뷰해 주세요.',
};

const NO_ROUND_NOTICE: Record<ReviewLocale, string> = {
  en: '⚠️ This run of the review posted no summary comment for the current commit, so there is no verdict for it (an earlier round is never reused). The verdict gate stays green; please review this PR manually.',
  ko: '⚠️ 이번 리뷰 실행이 현재 커밋에 대한 요약 코멘트를 게시하지 않아 verdict가 없습니다(이전 라운드는 재사용하지 않습니다). verdict 게이트는 녹색으로 두니 이 PR은 사람이 직접 리뷰해 주세요.',
};

const HEAD_LINE: Record<ReviewLocale, (sha: string) => string> = {
  en: (sha) => `<sub>Commit \`${sha.slice(0, 7)}\` · this comment is updated on every review round.</sub>`,
  ko: (sha) => `<sub>커밋 \`${sha.slice(0, 7)}\` · 이 코멘트는 리뷰 라운드마다 갱신됩니다.</sub>`,
};

/** The verdict comment is edited in place round after round, so it names the commit it judged —
 * a reader can tell a current verdict from one a skipped run left behind. */
function withHead(lines: string[], locale: ReviewLocale, headSha: string | undefined): string {
  return (headSha === undefined ? lines : [...lines, '', HEAD_LINE[locale](headSha)]).join('\n');
}

export function renderUnparseableNotice(locale: ReviewLocale, headSha?: string): string {
  return withHead([VERDICT_MARKER, UNPARSEABLE_NOTICE[locale]], locale, headSha);
}

/** The run's review posted no round after the gate's watermark (a summary without the marker,
 * or none at all): the latest round belongs to an earlier commit and is not judged again. */
export function renderNoRoundNotice(locale: ReviewLocale, headSha?: string): string {
  return withHead([VERDICT_MARKER, NO_ROUND_NOTICE[locale]], locale, headSha);
}

/** The verdict comment is deliberately terse: the model's own summary carries
 * the human narrative, this one carries the machine's judgment (no duplicate
 * finding sections). */
export function renderVerdictComment(input: {
  verdict: ReviewVerdict;
  history: readonly RoundHistoryEntry[];
  maxRounds: ReviewMaxRounds;
  locale: ReviewLocale;
  isFinalRound: boolean;
  headSha?: string;
}): string {
  const lines = [VERDICT_MARKER];
  if (input.isFinalRound && input.verdict === 'BLOCK') {
    lines.push(terminationBannerLine(input.maxRounds, input.locale), '');
  }
  lines.push(verdictLine(input.verdict, input.locale));
  if (input.history.length > 1) {
    lines.push('', HISTORY_HEADING[input.locale]);
    for (let i = 0; i < input.history.length; i++) {
      if (i === 0) continue; // the baseline entry is not a delta — whatever round number it carries
      const entry = input.history[i];
      lines.push(ROUND_LINE[input.locale](entry.round, entry.fixedFindingKeys.length, entry.remainingFindingKeys.length));
    }
  }
  return withHead(lines, input.locale, input.headSha);
}
