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

/** The fail-closed notices: the AI review ran in this workflow run, but left nothing that proves
 * the commit isn't a BLOCK, so the review check goes red. */
const NO_SUMMARY_NOTICE: Record<ReviewLocale, string> = {
  en: '⛔ AI review posted no summary for this commit, so there is no verdict for it and the review check fails. Review this PR manually, or re-run all jobs to review it again.',
  ko: '⛔ AI 리뷰가 이 커밋에 대한 요약을 게시하지 않아 verdict가 없고, review 체크는 실패합니다. 이 PR을 직접 리뷰하거나, 모든 잡을 다시 실행해 다시 리뷰받으세요.',
};

const UNREADABLE_SUMMARY_NOTICE: Record<ReviewLocale, string> = {
  en: '⛔ AI review posted a summary whose findings block could not be machine-read (missing or invalid), so there is no verdict for this commit and the review check fails. Review this PR manually, or re-run all jobs to review it again.',
  ko: '⛔ AI 리뷰 요약의 findings 블록을 기계 판독하지 못해(누락 또는 손상) 이 커밋의 verdict가 없고, review 체크는 실패합니다. 이 PR을 직접 리뷰하거나, 모든 잡을 다시 실행해 다시 리뷰받으세요.',
};

/** The line naming the judged commit, for an abbreviated SHA (or a placeholder a workflow script
 * fills in). */
export function renderCommitLine(locale: ReviewLocale, shortSha: string): string {
  return locale === 'en'
    ? `<sub>Commit \`${shortSha}\` · this comment is updated on every review round.</sub>`
    : `<sub>커밋 \`${shortSha}\` · 이 코멘트는 리뷰 라운드마다 갱신됩니다.</sub>`;
}

const HEAD_LINE: Record<ReviewLocale, (sha: string) => string> = {
  en: (sha) => renderCommitLine('en', sha.slice(0, 7)),
  ko: (sha) => renderCommitLine('ko', sha.slice(0, 7)),
};

/** Why the AI review did not run although the check ends green. */
export type NotRunReason = 'secret' | 'fork' | 'dependabot' | 'rounds';

const NOT_RUN_REASON: Record<ReviewLocale, Record<NotRunReason, (secretName: string, maxRounds: number) => string>> = {
  en: {
    secret: (secretName) => `the ${secretName} secret is not registered`,
    fork: () => 'this pull request comes from a fork, and GitHub passes no secrets to runs from forks',
    dependabot: (secretName) => `Dependabot runs receive only Dependabot secrets, and ${secretName} is not one of them`,
    rounds: (_secretName, maxRounds) => `the automated review round limit (${maxRounds}) is reached`,
  },
  ko: {
    secret: (secretName) => `${secretName} 시크릿이 등록되지 않음`,
    fork: () => '포크에서 온 pull request이고, GitHub는 포크 실행에 시크릿을 넘기지 않음',
    dependabot: (secretName) => `Dependabot 실행은 Dependabot 시크릿만 받는데, ${secretName}는 그중에 없음`,
    rounds: (_secretName, maxRounds) => `자동 리뷰 라운드 한도(${maxRounds})에 도달함`,
  },
};

/** The sentence a run that skipped the AI review shows (annotation, job summary, verdict
 * comment): the check's color stays as it is, and the text says plainly that green here is not a
 * review. */
export function renderNotRunNotice(locale: ReviewLocale, reason: NotRunReason, secretName: string, maxRounds: number): string {
  const why = NOT_RUN_REASON[locale][reason](secretName, maxRounds);
  return locale === 'en'
    ? `AI review did not run for this commit (${why}). A green check here does not mean the change was reviewed.`
    : `이 커밋에는 AI 리뷰가 실행되지 않았습니다(${why}). 이 green 체크는 변경 사항이 리뷰되었다는 뜻이 아닙니다.`;
}

/** The verdict comment is edited in place round after round, so it names the commit it judged —
 * a reader can tell a current verdict from one a skipped run left behind. */
function withHead(lines: string[], locale: ReviewLocale, headSha: string | undefined): string {
  return (headSha === undefined ? lines : [...lines, '', HEAD_LINE[locale](headSha)]).join('\n');
}

export function renderUnparseableNotice(locale: ReviewLocale, headSha?: string, failClosed = false): string {
  return withHead([VERDICT_MARKER, (failClosed ? UNREADABLE_SUMMARY_NOTICE : UNPARSEABLE_NOTICE)[locale]], locale, headSha);
}

/** This run's AI review left no round at all for the current commit; the check fails (see
 * runVerdictGate's `reviewRan`). */
export function renderNoSummaryNotice(locale: ReviewLocale, headSha?: string): string {
  return withHead([VERDICT_MARKER, NO_SUMMARY_NOTICE[locale]], locale, headSha);
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
