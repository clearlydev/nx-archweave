import { renderNoRoundNotice, renderUnparseableNotice, renderVerdictComment, VERDICT_MARKER } from './verdict-comment.ts';

describe('renderVerdictComment', () => {
  const history = [
    { round: 1, fixedFindingKeys: [], remainingFindingKeys: ['a.ts:1:x', 'b.ts:2:y'] },
    { round: 2, fixedFindingKeys: ['a.ts:1:x'], remainingFindingKeys: ['b.ts:2:y'] },
  ];

  it.each(['en', 'ko'] as const)('%s: BLOCK on the final round carries the banner and the history', (locale) => {
    const text = renderVerdictComment({ verdict: 'BLOCK', history, maxRounds: 2, locale, isFinalRound: true });
    expect(text).toMatchSnapshot();
    expect(text.startsWith(VERDICT_MARKER)).toBe(true);
  });

  it.each(['en', 'ko'] as const)('%s: CHANGES_RECOMMENDED mid-run has history but no banner', (locale) => {
    const text = renderVerdictComment({ verdict: 'CHANGES_RECOMMENDED', history, maxRounds: 3, locale, isFinalRound: false });
    expect(text).toMatchSnapshot();
  });

  it.each(['en', 'ko'] as const)('%s: APPROVE on round 1 is just the verdict line', (locale) => {
    const text = renderVerdictComment({
      verdict: 'APPROVE',
      history: [{ round: 1, fixedFindingKeys: [], remainingFindingKeys: [] }],
      maxRounds: 3,
      locale,
      isFinalRound: false,
    });
    expect(text).toMatchSnapshot();
    expect(text).not.toContain('history');
  });
});

describe('renderUnparseableNotice', () => {
  it('carries the marker and a human-review request in both locales', () => {
    expect(renderUnparseableNotice('en')).toContain(VERDICT_MARKER);
    expect(renderUnparseableNotice('ko')).toContain('사람이 직접');
  });
});

describe('the head commit line (the verdict comment is edited in place)', () => {
  it.each(['en', 'ko'] as const)('%s: every comment kind names the short SHA when given, and nothing when not', (locale) => {
    const verdict = renderVerdictComment({ verdict: 'APPROVE', history: [], maxRounds: 3, locale, isFinalRound: false, headSha: '0123456789abcdef' });
    expect(verdict).toContain('`0123456`');
    expect(verdict).not.toContain('89abcdef');
    expect(renderUnparseableNotice(locale, '0123456789')).toContain('`0123456`');
    expect(renderNoRoundNotice(locale, '0123456789')).toContain('`0123456`');
    expect(renderNoRoundNotice(locale)).not.toContain('`');
  });
});
