import type { ReviewFinding } from '../schema/review-finding.ts';
import { renderReviewComment } from './render-review-comment.ts';

function finding(priority: ReviewFinding['priority'], overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    priority,
    category: 'null-deref',
    title: `${priority} sample finding`,
    file: 'src/example.ts',
    lineRange: { start: 10, end: 12 },
    evidence: 'foo may be undefined here',
    impact: 'crashes the generator on empty config',
    reproductionCondition: 'run with an empty nx.json',
    recommendation: 'guard with an early return',
    confidence: 'confirmed',
    ...overrides,
  };
}

describe('renderReviewComment', () => {
  it('(a) no findings → APPROVE verdict line, no sections, no banner', () => {
    const md = renderReviewComment({
      findings: [],
      verdict: 'APPROVE',
      roundHistory: [],
      maxRounds: 3,
      locale: 'en',
    });
    expect(md).toContain('**Verdict: APPROVE**');
    expect(md).not.toContain('## Correctness & Security');
    expect(md).not.toContain('Automated review ended');
    expect(md).not.toContain('Round history');
    expect(md).toMatchSnapshot();
  });

  it('(b) one P0, rounds not exhausted → BLOCK without termination banner', () => {
    const md = renderReviewComment({
      findings: [finding('P0')],
      verdict: 'BLOCK',
      roundHistory: [],
      maxRounds: 3,
      locale: 'en',
    });
    expect(md).toContain('**Verdict: BLOCK**');
    expect(md).toContain('## Correctness & Security');
    expect(md).toContain('### [P0] P0 sample finding');
    expect(md).toContain('`src/example.ts:10-12`');
    expect(md).not.toContain('Automated review ended');
    expect(md).toMatchSnapshot();
  });

  it('(c) maxRounds reached with P0 remaining → termination banner at the very top', () => {
    const md = renderReviewComment({
      findings: [finding('P0')],
      verdict: 'BLOCK',
      roundHistory: [
        { round: 1, fixedFindingKeys: [], remainingFindingKeys: ['src/example.ts:10:null-deref'] },
        { round: 2, fixedFindingKeys: [], remainingFindingKeys: ['src/example.ts:10:null-deref'] },
        { round: 3, fixedFindingKeys: [], remainingFindingKeys: ['src/example.ts:10:null-deref'] },
      ],
      maxRounds: 3,
      locale: 'en',
    });
    expect(md.startsWith('> ⚠️ **Automated review ended.**')).toBe(true);
    expect(md).toContain('**Round history:**');
    expect(md).toContain('round 3: 0 fixed, 1 remaining');
    expect(md).toMatchSnapshot();
  });

  it('(c-negative) maxRounds reached but nothing blocking remains → no banner, history still rendered', () => {
    const md = renderReviewComment({
      findings: [finding('Nit')],
      verdict: 'APPROVE_WITH_NOTES',
      roundHistory: [
        { round: 1, fixedFindingKeys: ['a'], remainingFindingKeys: [] },
        { round: 2, fixedFindingKeys: [], remainingFindingKeys: [] },
        { round: 3, fixedFindingKeys: [], remainingFindingKeys: [] },
      ],
      maxRounds: 3,
      locale: 'en',
    });
    expect(md).not.toContain('Automated review ended');
    expect(md).toContain('**Round history:**');
  });

  it('groups sections in priority order and separates P3 and Nit from the main section', () => {
    const md = renderReviewComment({
      findings: [finding('Nit'), finding('P3'), finding('P2'), finding('P1')],
      verdict: 'BLOCK',
      roundHistory: [],
      maxRounds: 3,
      locale: 'en',
    });
    const main = md.indexOf('## Correctness & Security');
    const p1 = md.indexOf('### [P1]');
    const p2 = md.indexOf('### [P2]');
    const overEng = md.indexOf('## Over-engineering');
    const nits = md.indexOf('## Nits');
    expect(main).toBeGreaterThanOrEqual(0);
    expect(p1).toBeGreaterThan(main);
    expect(p2).toBeGreaterThan(p1);
    expect(overEng).toBeGreaterThan(p2);
    expect(nits).toBeGreaterThan(overEng);
  });

  it('renders a single-line range without a dash', () => {
    const md = renderReviewComment({
      findings: [finding('P2', { lineRange: { start: 42 } })],
      verdict: 'CHANGES_RECOMMENDED',
      roundHistory: [],
      maxRounds: 3,
      locale: 'en',
    });
    expect(md).toContain('`src/example.ts:42`');
  });

  it('(d) locale ko renders Korean copy', () => {
    const md = renderReviewComment({
      findings: [finding('P0')],
      verdict: 'BLOCK',
      roundHistory: [
        { round: 1, fixedFindingKeys: [], remainingFindingKeys: ['src/example.ts:10:null-deref'] },
        { round: 2, fixedFindingKeys: [], remainingFindingKeys: ['src/example.ts:10:null-deref'] },
        { round: 3, fixedFindingKeys: [], remainingFindingKeys: ['src/example.ts:10:null-deref'] },
      ],
      maxRounds: 3,
      locale: 'ko',
    });
    expect(md.startsWith('> ⚠️ **자동 리뷰 종료.**')).toBe(true);
    expect(md).toContain('**판정: BLOCK**');
    expect(md).toContain('## 정확성 & 보안');
    expect(md).toContain('**라운드 이력:**');
    expect(md).toContain('3라운드: 해결 0건, 미해결 1건');
    expect(md).toMatchSnapshot();
  });

  it('interpolates a non-default maxRounds into the termination banner (en/ko)', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      round: i + 1,
      fixedFindingKeys: [] as string[],
      remainingFindingKeys: ['src/example.ts:10:null-deref'],
    }));
    const en = renderReviewComment({
      findings: [finding('P0')],
      verdict: 'BLOCK',
      roundHistory: history,
      maxRounds: 5,
      locale: 'en',
    });
    expect(en).toContain('The maximum of 5 review rounds');
    const ko = renderReviewComment({
      findings: [finding('P0')],
      verdict: 'BLOCK',
      roundHistory: history,
      maxRounds: 5,
      locale: 'ko',
    });
    expect(ko).toContain('최대 5회의 리뷰 라운드');
  });

  it('ko: renders the over-engineering and nit sections and non-BLOCK verdict lines', () => {
    const changesRecommended = renderReviewComment({
      findings: [finding('P2')],
      verdict: 'CHANGES_RECOMMENDED',
      roundHistory: [],
      maxRounds: 3,
      locale: 'ko',
    });
    expect(changesRecommended).toContain('**판정: CHANGES_RECOMMENDED**');

    const withNotes = renderReviewComment({
      findings: [finding('P3'), finding('Nit')],
      verdict: 'APPROVE_WITH_NOTES',
      roundHistory: [],
      maxRounds: 3,
      locale: 'ko',
    });
    expect(withNotes).toContain('**판정: APPROVE_WITH_NOTES**');
    expect(withNotes).toContain('## 과잉 설계');
    expect(withNotes).toContain('## 사소한 지적 (Nit)');
    expect(withNotes.indexOf('## 과잉 설계')).toBeLessThan(withNotes.indexOf('## 사소한 지적 (Nit)'));
  });
});
