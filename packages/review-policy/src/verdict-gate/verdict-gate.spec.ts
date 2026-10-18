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
