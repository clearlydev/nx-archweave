export type ReviewPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'Nit';

export interface ReviewFinding {
  priority: ReviewPriority;
  category: string; // kebab-case
  title: string;
  file: string;
  lineRange: { start: number; end?: number };
  evidence: string;
  impact: string;
  reproductionCondition: string;
  recommendation: string;
  confidence: 'confirmed' | 'plausible';
}

export type ReviewVerdict = 'BLOCK' | 'CHANGES_RECOMMENDED' | 'APPROVE_WITH_NOTES' | 'APPROVE';

// Production consumer (since 2026-10-07): the verdict gate
// (src/verdict-gate/) parses the archweave/findings@1 block out of the
// model's summary comment, runs computeVerdict, and the plugin's
// archweave-review-verdict bin fails the workflow check on BLOCK.
// renderReviewComment remains prompt-schema documentation plus the full
// renderer; the gate posts the terser renderVerdictComment instead.
export function computeVerdict(findings: readonly ReviewFinding[]): ReviewVerdict {
  if (findings.some((f) => f.priority === 'P0' || f.priority === 'P1')) return 'BLOCK';
  if (findings.some((f) => f.priority === 'P2')) return 'CHANGES_RECOMMENDED';
  if (findings.length > 0) return 'APPROVE_WITH_NOTES';
  return 'APPROVE';
}
