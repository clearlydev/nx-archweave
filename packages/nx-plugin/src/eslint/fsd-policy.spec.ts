import { globToRegExp } from './fsd-policy.ts';

describe('globToRegExp', () => {
  it('matches the usual test-file globs', () => {
    expect(globToRegExp('**/*.{spec,test}.*').test('features/a/model/a.spec.ts')).toBe(true);
    expect(globToRegExp('**/__tests__/**').test('features/a/__tests__/a.ts')).toBe(true);
    expect(globToRegExp('**/*.{spec,test}.*').test('features/a/model/a.ts')).toBe(false);
  });

  it('an unclosed brace is a literal, never a hang', () => {
    const regex = globToRegExp('*.{spec,test.ts');
    expect(regex.test('a.{spec,test.ts')).toBe(true);
    expect(regex.test('a.spec.ts')).toBe(false);
  });

  it('a star inside braces is a wildcard too', () => {
    expect(globToRegExp('{a*,b}.ts').test('abc.ts')).toBe(true);
    expect(globToRegExp('{a*,b}.ts').test('b.ts')).toBe(true);
    expect(globToRegExp('{a*,b}.ts').test('c.ts')).toBe(false);
  });
});
