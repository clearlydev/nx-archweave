import { computeVerdict, type ReviewFinding } from './review-finding.ts';

function finding(priority: ReviewFinding['priority']): ReviewFinding {
  return {
    priority,
    category: 'test-category',
    title: 'test finding',
    file: 'src/example.ts',
    lineRange: { start: 1 },
    evidence: 'evidence',
    impact: 'impact',
    reproductionCondition: 'always',
    recommendation: 'fix it',
    confidence: 'confirmed',
  };
}

describe('computeVerdict', () => {
  it('returns BLOCK when any P0 finding exists', () => {
    expect(computeVerdict([finding('P3'), finding('P0')])).toBe('BLOCK');
  });

  it('returns BLOCK when any P1 finding exists', () => {
    expect(computeVerdict([finding('P2'), finding('P1')])).toBe('BLOCK');
  });

  it('returns CHANGES_RECOMMENDED when P2 exists without P0/P1', () => {
    expect(computeVerdict([finding('P2'), finding('Nit')])).toBe('CHANGES_RECOMMENDED');
  });

  it('returns APPROVE_WITH_NOTES when only P3 findings exist', () => {
    expect(computeVerdict([finding('P3')])).toBe('APPROVE_WITH_NOTES');
  });

  it('returns APPROVE_WITH_NOTES when only Nit findings exist', () => {
    expect(computeVerdict([finding('Nit')])).toBe('APPROVE_WITH_NOTES');
  });

  it('returns APPROVE with no findings', () => {
    expect(computeVerdict([])).toBe('APPROVE');
  });
});
