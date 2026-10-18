import {
  buildCorrectnessSecurityPrompt,
  CORRECTNESS_SECURITY_PRIORITIES,
} from './correctness-security-prompt.ts';
import {
  buildOverEngineeringPrompt,
  OVER_ENGINEERING_PRIORITIES,
} from './over-engineering-prompt.ts';
import { renderFindingsBlockInstruction } from './prompt-shared.ts';

const SCHEMA_FIELDS = [
  'priority',
  'category',
  'title',
  'file',
  'lineRange',
  'evidence',
  'impact',
  'reproductionCondition',
  'recommendation',
  'confidence',
];

describe('buildCorrectnessSecurityPrompt', () => {
  it('returns different text per locale', () => {
    expect(buildCorrectnessSecurityPrompt('ko')).not.toBe(buildCorrectnessSecurityPrompt('en'));
  });

  it.each(['ko', 'en'] as const)('(%s) names every ReviewFinding schema field', (locale) => {
    const prompt = buildCorrectnessSecurityPrompt(locale);
    for (const field of SCHEMA_FIELDS) {
      expect(prompt).toContain(field);
    }
  });

  it('en: instructs section separation, dedup, and explicit P3 exclusion', () => {
    const prompt = buildCorrectnessSecurityPrompt('en');
    expect(prompt).toContain('separated top-level sections');
    expect(prompt).toContain('merge them into a single finding');
    expect(prompt).toContain('Do NOT report P3');
  });

  it('ko: instructs section separation, dedup, and explicit P3 exclusion', () => {
    const prompt = buildCorrectnessSecurityPrompt('ko');
    expect(prompt).toContain('최상위 섹션으로 분리');
    expect(prompt).toContain('하나의 finding으로 합쳐서');
    expect(prompt).toContain('P3는 보고하지 마세요');
  });

  it.each(['ko', 'en'] as const)('(%s) schema priority line lists only the requested priorities', (locale) => {
    const prompt = buildCorrectnessSecurityPrompt(locale);
    expect(prompt).toContain('- priority: P0 | P1 | P2 | Nit');
    expect(prompt).not.toContain('- priority: P0 | P1 | P2 | P3 | Nit');
  });
});

describe('buildOverEngineeringPrompt', () => {
  it('returns different text per locale', () => {
    expect(buildOverEngineeringPrompt('ko')).not.toBe(buildOverEngineeringPrompt('en'));
  });

  it.each(['ko', 'en'] as const)('(%s) names every ReviewFinding schema field', (locale) => {
    const prompt = buildOverEngineeringPrompt(locale);
    for (const field of SCHEMA_FIELDS) {
      expect(prompt).toContain(field);
    }
  });

  it('en: requests only P3 and excludes every other priority', () => {
    const prompt = buildOverEngineeringPrompt('en');
    expect(prompt).toContain('priority P3 only');
    expect(prompt).toContain('Do NOT report P0, P1, P2, or Nit');
    expect(prompt).toContain('never mix them into correctness or security');
  });

  it('ko: requests only P3 and excludes every other priority', () => {
    const prompt = buildOverEngineeringPrompt('ko');
    expect(prompt).toContain('P3만 보고');
    expect(prompt).toContain('P0, P1, P2, Nit은 보고하지 마세요');
  });

  it.each(['ko', 'en'] as const)('(%s) schema priority line lists P3 only', (locale) => {
    const prompt = buildOverEngineeringPrompt(locale);
    expect(prompt).toContain('- priority: P3');
    expect(prompt).not.toContain('- priority: P0');
  });
});

describe('requested priority sets', () => {
  it('do not overlap between the two prompts', () => {
    const overlap = CORRECTNESS_SECURITY_PRIORITIES.filter((p) =>
      (OVER_ENGINEERING_PRIORITIES as readonly string[]).includes(p),
    );
    expect(overlap).toEqual([]);
  });

  it('together cover every priority exactly once', () => {
    const all = [...CORRECTNESS_SECURITY_PRIORITIES, ...OVER_ENGINEERING_PRIORITIES].sort();
    expect(all).toEqual(['Nit', 'P0', 'P1', 'P2', 'P3']);
  });
});

describe('renderFindingsBlockInstruction', () => {
  it('names the marker, the schema id, and the empty-array rule in both locales', () => {
    for (const locale of ['en', 'ko'] as const) {
      const text = renderFindingsBlockInstruction(locale);
      expect(text).toContain('<!-- archweave-findings-v1 -->');
      expect(text).toContain('archweave/findings@1');
    }
    expect(renderFindingsBlockInstruction('en')).toContain('empty findings array');
    expect(renderFindingsBlockInstruction('ko')).toContain('빈 배열');
  });
});

describe('buildCorrectnessSecurityPrompt — styles', () => {
  it.each(['en', 'ko'] as const)('%s: fast-condensed drops Nit everywhere, drops sectioning, keeps the P3 exclusion', (locale) => {
    const fast = buildCorrectnessSecurityPrompt(locale, 'fast-condensed');
    expect(fast).not.toMatch(/\bNit\b/);
    expect(fast).not.toContain('Correctness');
    expect(fast).toContain('P3');
    expect(fast).toContain(locale === 'en' ? 'most critical' : '치명적인');
  });

  it.each(['en', 'ko'] as const)('%s: sectioned stays the current sectioned prompt with Nit, and remains the default', (locale) => {
    const sectioned = buildCorrectnessSecurityPrompt(locale, 'sectioned');
    expect(sectioned).toContain('Correctness');
    expect(sectioned).toContain('Security');
    expect(sectioned).toMatch(/\bNit\b/);
    expect(sectioned).toBe(buildCorrectnessSecurityPrompt(locale));
  });

  it('the two styles are genuinely different strings', () => {
    expect(buildCorrectnessSecurityPrompt('en', 'fast-condensed')).not.toBe(buildCorrectnessSecurityPrompt('en', 'sectioned'));
  });

  it('fast-condensed still carries the shared schema instruction with FAST priorities only', () => {
    const fast = buildCorrectnessSecurityPrompt('en', 'fast-condensed');
    expect(fast).toContain('priority: P0 | P1 | P2');
    expect(fast).not.toContain('priority: P0 | P1 | P2 | Nit');
    expect(fast).toContain('merge them into a single finding');
  });
});

it('ko fast-condensed mirrors en: explicit below-P2 ban and imperative P3 ban', () => {
  const ko = buildCorrectnessSecurityPrompt('ko', 'fast-condensed');
  expect(ko).toContain('P2 미만');
  expect(ko).toContain('P3');
  expect(ko).toMatch(/P3[^\n]*보고하지 마세요/);
});
