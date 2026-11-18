import { FINDINGS_MARKER, ROUND_MARKER, runVerdictGate, VERDICT_MARKER } from '../index.ts';

const f = (priority: string, file = 'src/a.ts', start = 1, category = 'logic-error') => ({
  priority,
  category,
  title: 't',
  file,
  lineRange: { start },
  evidence: 'e',
  impact: 'i',
  reproductionCondition: 'r',
  recommendation: 'rec',
  confidence: 'confirmed',
});
const roundComment = (findings: unknown[]) => ({
  body: `${ROUND_MARKER}\nprose\n${FINDINGS_MARKER}\n\`\`\`json\n${JSON.stringify({ schema: 'archweave/findings@1', findings })}\n\`\`\``,
});

describe('runVerdictGate — degradation table', () => {
  it('no ROUND_MARKER comments at all → no-review', () => {
    expect(runVerdictGate({ comments: [{ body: 'hi' }], maxRounds: 3, locale: 'en' }).kind).toBe('no-review');
  });

  it('latest round without a findings block → unparseable, with a human-review notice', () => {
    const result = runVerdictGate({ comments: [{ body: `${ROUND_MARKER}\nno block here` }], maxRounds: 3, locale: 'en' });
    expect(result.kind).toBe('unparseable');
    if (result.kind === 'unparseable') {
      expect(result.commentBody).toContain(VERDICT_MARKER);
      expect(result.commentBody).toContain('manually');
    }
  });

  it('P1 present → verdict BLOCK, exit 1', () => {
    const result = runVerdictGate({ comments: [roundComment([f('P1')])], maxRounds: 3, locale: 'en' });
    expect(result.kind).toBe('verdict');
    if (result.kind === 'verdict') {
      expect(result.verdict).toBe('BLOCK');
      expect(result.exitCode).toBe(1);
    }
  });

  it('only P2 → CHANGES_RECOMMENDED, exit 0', () => {
    const result = runVerdictGate({ comments: [roundComment([f('P2')])], maxRounds: 3, locale: 'en' });
    expect(result.kind).toBe('verdict');
    if (result.kind === 'verdict') {
      expect(result.verdict).toBe('CHANGES_RECOMMENDED');
      expect(result.exitCode).toBe(0);
    }
  });

  it('empty findings → APPROVE, exit 0', () => {
    const result = runVerdictGate({ comments: [roundComment([])], maxRounds: 3, locale: 'en' });
    expect(result.kind).toBe('verdict');
    if (result.kind === 'verdict') expect(result.verdict).toBe('APPROVE');
  });

  it('VERDICT_MARKER comments are excluded from round collection', () => {
    const comments = [roundComment([f('P1')]), { body: `${VERDICT_MARKER}\nolder verdict` }];
    const result = runVerdictGate({ comments, maxRounds: 3, locale: 'en' });
    expect(result.kind).toBe('verdict');
  });
});

describe('runVerdictGate — round history', () => {
  it('computes fixed/remaining via key-set difference across rounds', () => {
    const round1 = roundComment([f('P1', 'a.ts', 1), f('P2', 'b.ts', 2, 'style')]);
    const round2 = roundComment([f('P2', 'b.ts', 2, 'style')]);
    const result = runVerdictGate({ comments: [round1, round2], maxRounds: 3, locale: 'en' });
    expect(result.kind).toBe('verdict');
    if (result.kind === 'verdict') {
      expect(result.commentBody).toContain('round 2: 1 fixed, 1 remaining');
    }
  });

  it('a defect the model rewords between rounds stays remaining: another category, a start line a few lines off', () => {
    const round1 = roundComment([f('P0', 'apps/api/src/main.ts', 36, 'remote-code-execution')]);
    const round2 = roundComment([f('P0', 'apps/api/src/main.ts', 38, 'code-injection')]);
    const result = runVerdictGate({ comments: [round1, round2], maxRounds: 3, locale: 'en' });
    if (result.kind === 'verdict') expect(result.commentBody).toContain('round 2: 0 fixed, 1 remaining');
    else throw new Error(result.kind);
  });

  it('a finding in another file, or far from where it was, counts as fixed', () => {
    const round1 = roundComment([f('P1', 'a.ts', 10), f('P1', 'b.ts', 10)]);
    const round2 = roundComment([f('P1', 'a.ts', 40), f('P1', 'c.ts', 10)]);
    const result = runVerdictGate({ comments: [round1, round2], maxRounds: 3, locale: 'en' });
    if (result.kind === 'verdict') expect(result.commentBody).toContain('round 2: 2 fixed, 2 remaining');
    else throw new Error(result.kind);
  });

  it('an unparseable PAST round is skipped (결번), not reported as zeros', () => {
    const broken = { body: `${ROUND_MARKER}\nno block` };
    const round2 = roundComment([f('P2')]);
    const result = runVerdictGate({ comments: [broken, round2], maxRounds: 3, locale: 'en' });
    expect(result.kind).toBe('verdict');
    if (result.kind === 'verdict') expect(result.commentBody).not.toContain('round 1: 0 fixed');
  });

  it('final round + BLOCK → termination banner; final round without BLOCK → no banner', () => {
    const blocked = runVerdictGate({ comments: [roundComment([f('P0')])], maxRounds: 1, locale: 'en' });
    expect(blocked.kind).toBe('verdict');
    if (blocked.kind === 'verdict') expect(blocked.commentBody).toContain('Automated review ended');
    const clean = runVerdictGate({ comments: [roundComment([])], maxRounds: 1, locale: 'en' });
    expect(clean.kind).toBe('verdict');
    if (clean.kind === 'verdict') expect(clean.commentBody).not.toContain('Automated review ended');
  });
});

describe('runVerdictGate — round baseline and watermark', () => {
  it('baseline entry is never printed as a zero-progress delta, even when round 1 is 결번', () => {
    const broken = { body: `${ROUND_MARKER}\nno block` };
    const round2 = roundComment([f('P2', 'b.ts', 2, 'style'), f('P3', 'c.ts', 3, 'docs')]);
    const round3 = roundComment([f('P3', 'c.ts', 3, 'docs')]);
    const result = runVerdictGate({ comments: [broken, round2, round3], maxRounds: 5, locale: 'en' });
    expect(result.kind).toBe('verdict');
    if (result.kind === 'verdict') {
      expect(result.commentBody).not.toContain('round 2: 0 fixed'); // round 2 is the baseline, not a delta
      expect(result.commentBody).toContain('round 3: 1 fixed, 1 remaining');
    }
  });
});

describe('runVerdictGate — rounds bound to this run', () => {
  const withId = (id: number, findings: unknown[]) => ({ ...roundComment(findings), id });

  it('a round posted after the watermark is judged, and the comment names the commit', () => {
    const result = runVerdictGate({
      comments: [withId(10, [f('P1')]), withId(20, [])],
      maxRounds: 3,
      locale: 'en',
      roundAfterId: 15,
      headSha: 'abcdef1234567890',
    });
    expect(result.kind).toBe('verdict');
    if (result.kind === 'verdict') {
      expect(result.verdict).toBe('APPROVE');
      expect(result.commentBody).toContain('Commit `abcdef1`');
    }
  });

  it('no round after the watermark → no-round, green, never the earlier round again (a stale BLOCK or APPROVE)', () => {
    for (const findings of [[f('P0')], []]) {
      const result = runVerdictGate({ comments: [withId(10, findings)], maxRounds: 3, locale: 'en', roundAfterId: 10, headSha: 'abcdef1' });
      expect(result.kind).toBe('no-round');
      if (result.kind === 'no-round') {
        expect(result.commentBody).toContain(VERDICT_MARKER);
        expect(result.commentBody).toContain('manually');
        expect(result.commentBody).toContain('Commit `abcdef1`');
      }
    }
  });

  it('a round without an id cannot be placed after the watermark → no-round', () => {
    expect(runVerdictGate({ comments: [roundComment([])], maxRounds: 3, locale: 'ko', roundAfterId: 0 }).kind).toBe('no-round');
  });

  it('without a watermark the latest round is judged as before (a workflow rendered earlier)', () => {
    expect(runVerdictGate({ comments: [withId(10, [f('P1')])], maxRounds: 3, locale: 'en' }).kind).toBe('verdict');
  });
});

describe('runVerdictGate — the AI review ran in this workflow run (reviewRan)', () => {
  const ran = { maxRounds: 3 as const, locale: 'en' as const, reviewRan: true, headSha: 'abcdef1234567' };

  it('no round on the PR at all → no-summary, never the no-review green', () => {
    const result = runVerdictGate({ ...ran, comments: [{ body: 'hi', id: 5 }], roundAfterId: 5 });
    expect(result.kind).toBe('no-summary');
    if (result.kind === 'no-summary') {
      expect(result.commentBody).toContain(VERDICT_MARKER);
      expect(result.commentBody).toContain('AI review posted no summary');
      expect(result.commentBody).toContain('re-run all jobs');
      expect(result.commentBody).toContain('`abcdef1`');
    }
  });

  it('only an earlier run marker (at or before the watermark) → no-summary, even when it was an APPROVE', () => {
    const earlier = { ...roundComment([]), id: 40 };
    expect(runVerdictGate({ ...ran, comments: [earlier], roundAfterId: 40 }).kind).toBe('no-summary');
    expect(runVerdictGate({ ...ran, comments: [earlier], roundAfterId: 60 }).kind).toBe('no-summary');
  });

  it("this run's round is judged as usual: APPROVE passes, BLOCK blocks", () => {
    const earlier = { ...roundComment([f('P0')]), id: 40 };
    const approve = runVerdictGate({ ...ran, comments: [earlier, { ...roundComment([]), id: 70 }], roundAfterId: 60 });
    expect(approve).toMatchObject({ kind: 'verdict', verdict: 'APPROVE', exitCode: 0 });
    const block = runVerdictGate({ ...ran, comments: [{ ...roundComment([f('P1')]), id: 70 }], roundAfterId: 60 });
    expect(block).toMatchObject({ kind: 'verdict', verdict: 'BLOCK', exitCode: 1 });
  });

  it("this run's summary without a readable findings block → unparseable that fails closed", () => {
    const result = runVerdictGate({ ...ran, comments: [{ body: `${ROUND_MARKER}\nno block here`, id: 70 }], roundAfterId: 60 });
    expect(result).toMatchObject({ kind: 'unparseable', failClosed: true });
    if (result.kind === 'unparseable') expect(result.commentBody).toContain('review check fails');
  });

  it('more than one round after the watermark is no single verdict: several-summaries, whatever they say', () => {
    const both = [{ ...roundComment([f('P1')]), id: 70 }, { ...roundComment([]), id: 80 }];
    const result = runVerdictGate({ ...ran, comments: both, roundAfterId: 60 });
    expect(result.kind).toBe('several-summaries');
    if (result.kind === 'several-summaries') {
      expect(result.commentBody).toContain('more than one review summary');
      expect(result.commentBody).toContain('Commit `abcdef1`');
    }
  });

  it('rounds before the watermark do not count toward several', () => {
    const result = runVerdictGate({ ...ran, comments: [{ ...roundComment([]), id: 40 }, { ...roundComment([]), id: 70 }], roundAfterId: 60 });
    expect(result.kind).toBe('verdict');
  });

  it('without reviewRan, several rounds after the watermark are judged by the most severe one', () => {
    const judge = (comments: { body: string; id: number }[]) => runVerdictGate({ maxRounds: 3, locale: 'en', comments, roundAfterId: 60 });
    expect(judge([{ ...roundComment([f('P1')]), id: 70 }, { ...roundComment([]), id: 80 }])).toMatchObject({ kind: 'verdict', verdict: 'BLOCK', exitCode: 1 });
    expect(judge([{ ...roundComment([]), id: 70 }, { ...roundComment([f('P2')]), id: 80 }])).toMatchObject({ kind: 'verdict', verdict: 'CHANGES_RECOMMENDED' });
    expect(judge([{ body: `${ROUND_MARKER}\nx`, id: 70 }, { body: `${ROUND_MARKER}\ny`, id: 80 }])).toMatchObject({ kind: 'unparseable', failClosed: false });
  });

  it('without reviewRan, findings blocks that disagree are judged by the most severe one', () => {
    const block = (findings: unknown[]) => `${FINDINGS_MARKER}\n\`\`\`json\n${JSON.stringify({ schema: 'archweave/findings@1', findings })}\n\`\`\``;
    const body = [ROUND_MARKER, block([f('P1')]), block([])].join('\n');
    expect(runVerdictGate({ maxRounds: 3, locale: 'en', comments: [{ body }] })).toMatchObject({ kind: 'verdict', verdict: 'BLOCK', exitCode: 1 });
    expect(runVerdictGate({ ...ran, comments: [{ body, id: 70 }], roundAfterId: 60 })).toMatchObject({ kind: 'unparseable', failClosed: true });
  });

  it('without reviewRan nothing changes: no-review, no-round and a green unparseable', () => {
    expect(runVerdictGate({ maxRounds: 3, locale: 'en', comments: [] }).kind).toBe('no-review');
    expect(runVerdictGate({ maxRounds: 3, locale: 'en', comments: [{ ...roundComment([]), id: 40 }], roundAfterId: 60 }).kind).toBe('no-round');
    expect(runVerdictGate({ maxRounds: 3, locale: 'en', comments: [{ body: `${ROUND_MARKER}\nx`, id: 70 }], roundAfterId: 60 })).toMatchObject({ kind: 'unparseable', failClosed: false });
  });

  it('the fail-closed notices exist in Korean too', () => {
    const result = runVerdictGate({ ...ran, locale: 'ko', comments: [], roundAfterId: 0 });
    if (result.kind === 'no-summary') expect(result.commentBody).toContain('review 체크는 실패합니다');
    else throw new Error(`expected no-summary, got ${result.kind}`);
  });
});

describe('runVerdictGate — rounds from the review account only', () => {
  const own = (id: number, findings: unknown[] = []) => ({ ...roundComment(findings), id, author: 'claude[bot]' });
  const other = (id: number, findings: unknown[] = []) => ({ ...roundComment(findings), id, author: 'other-app[bot]' });
  const gate = (comments: { body: string; id: number; author: string }[], extra: { roundAfterId?: number; reviewRan?: boolean } = {}) =>
    runVerdictGate({ maxRounds: 3, locale: 'en', comments, reviewAuthors: ['claude[bot]'], ...extra });

  it('a summary from another account after the watermark fails, naming both accounts', () => {
    for (const comments of [[other(70)], [own(70), other(80)], [other(70), own(80)]]) {
      const result = gate(comments, { roundAfterId: 60, reviewRan: true });
      expect(result.kind).toBe('review-account');
      if (result.kind === 'review-account') {
        expect(result.logins).toEqual(['other-app[bot]']);
        expect(result.commentBody).toContain('`other-app[bot]`');
        expect(result.commentBody).toContain('`claude[bot]`');
        expect(result.commentBody).toContain('ARCHWEAVE_REVIEW_AUTHOR');
      }
    }
  });

  it('another account before the watermark is history only: the own round is judged', () => {
    expect(gate([other(50, [f('P1')]), own(70)], { roundAfterId: 60, reviewRan: true })).toMatchObject({ kind: 'verdict', verdict: 'APPROVE' });
  });

  it('without a watermark, another account after the last own round fails; before it, the own round is judged', () => {
    expect(gate([own(10), other(20)]).kind).toBe('review-account');
    expect(gate([other(20)]).kind).toBe('review-account');
    expect(gate([other(10), own(20, [f('P1')])])).toMatchObject({ kind: 'verdict', verdict: 'BLOCK' });
  });

  it('a login outside GitHub\'s login shape is never shown', () => {
    const odd = { ...roundComment([]), id: 70, author: 'x`y [bot]' };
    const result = gate([odd], { roundAfterId: 60, reviewRan: true });
    expect(result.kind).toBe('review-account');
    if (result.kind === 'review-account') expect(result.commentBody).not.toContain('x`y');
  });

  it('the notice exists in Korean too', () => {
    const result = runVerdictGate({ maxRounds: 3, locale: 'ko', comments: [other(70)], reviewAuthors: ['claude[bot]'], roundAfterId: 60, reviewRan: true });
    if (result.kind === 'review-account') expect(result.commentBody).toContain('ARCHWEAVE_REVIEW_AUTHOR');
    else throw new Error(`expected review-account, got ${result.kind}`);
  });
});
