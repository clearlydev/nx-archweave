import {
  DEFAULT_MAX_ROUNDS,
  type ReviewMaxRounds,
  type ReviewPolicyConfig,
} from './review-policy-config.ts';

describe('ReviewPolicyConfig', () => {
  it('accepts a fully valid config at the default maxRounds', () => {
    const config: ReviewPolicyConfig = {
      mode: 'standard',
      locale: 'ko',
      maxRounds: DEFAULT_MAX_ROUNDS,
      blockingPriorities: ['P0', 'P1'],
    };
    expect(config.maxRounds).toBe(3);
    expect(config.blockingPriorities).toEqual(['P0', 'P1']);
  });

  it('accepts every value in the 1-5 range', () => {
    const rounds: ReviewMaxRounds[] = [1, 2, 3, 4, 5];
    for (const maxRounds of rounds) {
      const config: ReviewPolicyConfig = {
        mode: 'fast',
        locale: 'en',
        maxRounds,
        blockingPriorities: ['P0', 'P1'],
      };
      expect(config.maxRounds).toBe(maxRounds);
    }
  });

  it('rejects out-of-range and loosened literal fields at compile time', () => {
    const invalidMaxRounds: ReviewPolicyConfig = {
      mode: 'fast',
      locale: 'en',
      // @ts-expect-error maxRounds is the 1-5 literal union — values outside the range must not compile
      maxRounds: 6,
      blockingPriorities: ['P0', 'P1'],
    };
    const invalidBlocking: ReviewPolicyConfig = {
      mode: 'fast',
      locale: 'en',
      maxRounds: 3,
      // @ts-expect-error blockingPriorities is the fixed tuple ['P0','P1'] — presets must not soften it
      blockingPriorities: ['P0'],
    };
    expect([invalidMaxRounds, invalidBlocking].length).toBe(2);
  });
});
