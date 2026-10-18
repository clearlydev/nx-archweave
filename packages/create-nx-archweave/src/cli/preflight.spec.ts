import { parseMajor } from './preflight.ts';

describe('parseMajor', () => {
  it.each([
    ['10.9.4', 10],
    ['11.6.2\n', 11],
    ['v22.22.0', 22],
    ['  4.18.1', 4],
  ])('%j → %d', (version, major) => {
    expect(parseMajor(version)).toBe(major);
  });

  it.each([undefined, '', 'not a version', '?'])('%j → undefined', (version) => {
    expect(parseMajor(version)).toBeUndefined();
  });
});
