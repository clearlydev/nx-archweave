import { REVIEW_MODES } from './review-modes.ts';

describe('REVIEW_MODES', () => {
  it('fast: condensed correctness-focused prompt, no over-engineering pass', () => {
    expect(REVIEW_MODES.fast).toEqual({
      mode: 'fast',
      promptStyle: 'fast-condensed',
      includesCorrectnessSecurity: true,
      includesOverEngineering: false,
    });
  });

  it('standard: sectioned correctness+security prompt, no over-engineering pass', () => {
    expect(REVIEW_MODES.standard).toEqual({
      mode: 'standard',
      promptStyle: 'sectioned',
      includesCorrectnessSecurity: true,
      includesOverEngineering: false,
    });
  });

  it('thorough: sectioned prompt with the over-engineering pass appended (single call)', () => {
    expect(REVIEW_MODES.thorough).toEqual({
      mode: 'thorough',
      promptStyle: 'sectioned',
      includesCorrectnessSecurity: true,
      includesOverEngineering: true,
    });
  });

  it('only thorough includes the over-engineering pass, and only fast is condensed', () => {
    const modes = Object.values(REVIEW_MODES);
    expect(modes.filter((m) => m.includesOverEngineering).map((m) => m.mode)).toEqual(['thorough']);
    expect(modes.filter((m) => m.promptStyle === 'fast-condensed').map((m) => m.mode)).toEqual(['fast']);
  });
});

it('maps each mode to its prompt style', () => {
  expect(REVIEW_MODES.fast.promptStyle).toBe('fast-condensed');
  expect(REVIEW_MODES.standard.promptStyle).toBe('sectioned');
  expect(REVIEW_MODES.thorough.promptStyle).toBe('sectioned');
});
