import type { ReviewFinding, ReviewVerdict } from '../schema/review-finding.ts';
import type { ReviewLocale, ReviewMaxRounds } from '../schema/review-policy-config.ts';

export interface RoundHistoryEntry {
  round: number; // 1-based, includes the opening round
  fixedFindingKeys: string[]; // `${file}:${lineRange.start}:${category}`
  remainingFindingKeys: string[];
}

interface LocaleCopy {
  terminationBanner: (maxRounds: ReviewMaxRounds) => string;
  verdictLines: Record<ReviewVerdict, string>;
  mainSection: string;
  overEngineeringSection: string;
  nitSection: string;
  roundHistoryHeading: string;
  roundLine: (round: number, fixed: number, remaining: number) => string;
  fieldLabels: { file: string; evidence: string; impact: string; reproduction: string; recommendation: string; confidence: string };
}

const COPY: Record<ReviewLocale, LocaleCopy> = {
  en: {
    terminationBanner: (maxRounds) =>
      `> ⚠️ **Automated review ended.** The maximum of ${maxRounds} review rounds has been reached with blocking findings (P0/P1) still open. Human review is required.`,
    verdictLines: {
      BLOCK: '**Verdict: BLOCK** — P0/P1 findings must be resolved before this change can merge.',
      CHANGES_RECOMMENDED: '**Verdict: CHANGES_RECOMMENDED** — P2 findings should be addressed.',
      APPROVE_WITH_NOTES: '**Verdict: APPROVE_WITH_NOTES** — only advisory notes below; safe to merge.',
      APPROVE: '**Verdict: APPROVE** — no findings.',
    },
    mainSection: '## Correctness & Security',
    overEngineeringSection: '## Over-engineering',
    nitSection: '## Nits',
    roundHistoryHeading: '**Round history:**',
    roundLine: (round, fixed, remaining) => `- round ${round}: ${fixed} fixed, ${remaining} remaining`,
    fieldLabels: {
      file: 'File',
      evidence: 'Evidence',
      impact: 'Impact',
      reproduction: 'Reproduction',
      recommendation: 'Recommendation',
      confidence: 'Confidence',
    },
  },
  ko: {
    terminationBanner: (maxRounds) =>
      `> ⚠️ **자동 리뷰 종료.** 최대 ${maxRounds}회의 리뷰 라운드에 도달했지만 병합을 막는 finding(P0/P1)이 남아 있습니다. 사람의 리뷰가 필요합니다.`,
    verdictLines: {
      BLOCK: '**판정: BLOCK** — 병합 전에 P0/P1 finding을 해결해야 합니다.',
      CHANGES_RECOMMENDED: '**판정: CHANGES_RECOMMENDED** — P2 finding을 해결하는 것을 권장합니다.',
      APPROVE_WITH_NOTES: '**판정: APPROVE_WITH_NOTES** — 참고용 노트만 있습니다. 병합해도 안전합니다.',
      APPROVE: '**판정: APPROVE** — finding이 없습니다.',
    },
    mainSection: '## 정확성 & 보안',
    overEngineeringSection: '## 과잉 설계',
    nitSection: '## 사소한 지적 (Nit)',
    roundHistoryHeading: '**라운드 이력:**',
    roundLine: (round, fixed, remaining) => `- ${round}라운드: 해결 ${fixed}건, 미해결 ${remaining}건`,
    fieldLabels: {
      file: '파일',
      evidence: '근거',
      impact: '영향',
      reproduction: '재현 조건',
      recommendation: '권장 조치',
      confidence: '확신도',
    },
  },
};

function renderLineRange(f: ReviewFinding): string {
  const { start, end } = f.lineRange;
  return end === undefined ? `\`${f.file}:${start}\`` : `\`${f.file}:${start}-${end}\``;
}

function renderFinding(f: ReviewFinding, copy: LocaleCopy): string {
  const l = copy.fieldLabels;
  return [
    `### [${f.priority}] ${f.title}`,
    `- **${l.file}:** ${renderLineRange(f)} (${f.category})`,
    `- **${l.evidence}:** ${f.evidence}`,
    `- **${l.impact}:** ${f.impact}`,
    `- **${l.reproduction}:** ${f.reproductionCondition}`,
    `- **${l.recommendation}:** ${f.recommendation}`,
    `- **${l.confidence}:** ${f.confidence}`,
  ].join('\n');
}

function renderSection(heading: string, findings: ReviewFinding[], copy: LocaleCopy): string[] {
  if (findings.length === 0) return [];
  return [heading, ...findings.map((f) => renderFinding(f, copy))];
}

export function verdictLine(verdict: ReviewVerdict, locale: ReviewLocale): string {
  return COPY[locale].verdictLines[verdict];
}

export function terminationBannerLine(maxRounds: ReviewMaxRounds, locale: ReviewLocale): string {
  return COPY[locale].terminationBanner(maxRounds);
}

export function renderReviewComment(input: {
  findings: readonly ReviewFinding[];
  verdict: ReviewVerdict;
  roundHistory: readonly RoundHistoryEntry[];
  maxRounds: ReviewMaxRounds;
  locale: ReviewLocale;
}): string {
  const copy = COPY[input.locale];
  const byPriority = (p: ReviewFinding['priority']) => input.findings.filter((f) => f.priority === p);
  const blocks: string[] = [];

  const hasBlockingRemaining = input.findings.some((f) => f.priority === 'P0' || f.priority === 'P1');
  if (input.roundHistory.length >= input.maxRounds && hasBlockingRemaining) {
    blocks.push(copy.terminationBanner(input.maxRounds));
  }

  blocks.push(copy.verdictLines[input.verdict]);
  blocks.push(...renderSection(copy.mainSection, [...byPriority('P0'), ...byPriority('P1'), ...byPriority('P2')], copy));
  blocks.push(...renderSection(copy.overEngineeringSection, byPriority('P3'), copy));
  blocks.push(...renderSection(copy.nitSection, byPriority('Nit'), copy));

  if (input.roundHistory.length > 0) {
    blocks.push('---');
    blocks.push(
      [
        copy.roundHistoryHeading,
        ...input.roundHistory.map((r) => copy.roundLine(r.round, r.fixedFindingKeys.length, r.remainingFindingKeys.length)),
      ].join('\n'),
    );
  }

  return blocks.join('\n\n');
}
