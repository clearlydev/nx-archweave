import { renderNoRoundNotice, renderNotRunNotice, renderUnparseableNotice, renderVerdictComment, VERDICT_MARKER } from './verdict-comment.ts';

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

describe('renderNotRunNotice', () => {
  it.each(['secret', 'fork', 'dependabot', 'rounds'] as const)('%s: names the reason and says green is not a review (en, ko)', (reason) => {
    const en = renderNotRunNotice('en', reason, 'MY_SECRET', 3);
    expect(en).toMatch(/^AI review did not run for this commit \(.+\)\. A green check here does not mean the change was reviewed\.$/);
    expect(renderNotRunNotice('ko', reason, 'MY_SECRET', 3)).toContain('리뷰되었다는 뜻이 아닙니다');
  });

  it('names the secret and the round limit', () => {
    expect(renderNotRunNotice('en', 'secret', 'MY_SECRET', 3)).toContain('the MY_SECRET secret is not registered');
    expect(renderNotRunNotice('en', 'rounds', 'MY_SECRET', 5)).toContain('round limit (5)');
  });
});
