import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildVerdictCases, colorOf, encodeColors } from './__fixtures__/verdict-cases.ts';
import { runReviewVerdictBin } from './review-verdict.ts';

/** The colors the 0.4.1 bin gave every case in buildVerdictCases, recorded from that release. An
 * upgrade changes the bin under workflows already in repositories, so a case that failed the
 * check there must still fail it. */
const recorded = JSON.parse(readFileSync(join(__dirname, '__fixtures__/verdict-colors-0.4.1.json'), 'utf-8')) as { cases: number; colors: string };

describe('runReviewVerdictBin — nothing 0.4.1 failed passes now', () => {
  const cases = buildVerdictCases();
  const colors = encodeColors(cases.map((verdictCase) => colorOf(runReviewVerdictBin, verdictCase)));

  it('the case list is the one the colors were recorded for', () => {
    expect(cases).toHaveLength(recorded.cases);
    expect(recorded.colors).toHaveLength(recorded.cases);
  });

  it('every case red in 0.4.1 is still red', () => {
    const passedNow = cases.filter((_, index) => recorded.colors[index] === 'r' && colors[index] === 'g').map((verdictCase) => verdictCase.name);
    expect(passedNow).toEqual([]);
  });
});
