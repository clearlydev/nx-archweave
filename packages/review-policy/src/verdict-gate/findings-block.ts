import type { ReviewFinding, ReviewPriority } from '../schema/review-finding.ts';

export const FINDINGS_MARKER = '<!-- archweave-findings-v1 -->';
export const FINDINGS_SCHEMA_ID = 'archweave/findings@1';

export type FindingsBlockResult =
  | { status: 'ok'; findings: ReviewFinding[] }
  | { status: 'missing' }
  | { status: 'invalid' };

const PRIORITIES: readonly ReviewPriority[] = ['P0', 'P1', 'P2', 'P3', 'Nit'];

export function findingKey(f: Pick<ReviewFinding, 'file' | 'lineRange' | 'category'>): string {
  return `${f.file}:${f.lineRange.start}:${f.category}`;
}

/** The first fenced ```json block after the LAST marker is the
 * payload (non-json fences in between are skipped). No marker → missing.
 * Marker present but no json fence, unparseable payload, wrong schema id, or
 * any element breaking a required field → invalid (whole-block poisoning:
 * a partial verdict could fail open, and fail-open is the unsafe direction). */
export function extractFindingsBlock(commentBody: string): FindingsBlockResult {
  // LAST marker on purpose: the contract puts the block at the END of the
  // comment, and models sometimes echo the marker while narrating the format —
  // binding to an early echo could hijack the payload toward a false APPROVE.
  // CRLF bodies (web-edited comments) are tolerated.
  const markerIndex = commentBody.lastIndexOf(FINDINGS_MARKER);
  if (markerIndex === -1) return { status: 'missing' };
  const after = commentBody.slice(markerIndex + FINDINGS_MARKER.length);
  const open = /```json[ \t]*\r?\n/.exec(after);
  if (!open) return { status: 'invalid' };
  // Progressive close: a finding's evidence may legitimately QUOTE a fenced
  // snippet inside a JSON string, so the first \`\`\` after the opening is not
  // necessarily the payload's end — try each candidate close until the slice
  // parses.
  const contentStart = open.index + open[0].length;
  let parsed: unknown;
  let found = false;
  for (let close = after.indexOf('```', contentStart); close !== -1; close = after.indexOf('```', close + 3)) {
    try {
      parsed = JSON.parse(after.slice(contentStart, close));
      found = true;
      break;
    } catch {
      // keep scanning — the close fence was inside a JSON string
    }
  }
  if (!found) return { status: 'invalid' };
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'invalid' };
  const obj = parsed as { schema?: unknown; findings?: unknown };
  if (obj.schema !== FINDINGS_SCHEMA_ID || !Array.isArray(obj.findings)) return { status: 'invalid' };
  const findings: ReviewFinding[] = [];
  for (const raw of obj.findings) {
    const finding = normalizeFinding(raw);
    if (finding === null) return { status: 'invalid' };
    findings.push(finding);
  }
  return { status: 'ok', findings };
}

function normalizeFinding(raw: unknown): ReviewFinding | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lineRange = r['lineRange'] as { start?: unknown; end?: unknown } | null | undefined;
  if (
    !PRIORITIES.includes(r['priority'] as ReviewPriority) ||
    typeof r['category'] !== 'string' ||
    typeof r['title'] !== 'string' ||
    typeof r['file'] !== 'string' ||
    lineRange === null ||
    lineRange === undefined ||
    typeof lineRange !== 'object' ||
    typeof lineRange.start !== 'number' ||
    !Number.isInteger(lineRange.start) ||
    lineRange.start < 1
  ) {
    return null;
  }
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  return {
    priority: r['priority'] as ReviewPriority,
    category: r['category'],
    title: r['title'],
    file: r['file'],
    lineRange: { start: lineRange.start, ...(typeof lineRange.end === 'number' ? { end: lineRange.end } : {}) },
    evidence: str(r['evidence']),
    impact: str(r['impact']),
    reproductionCondition: str(r['reproductionCondition']),
    recommendation: str(r['recommendation']),
    confidence: r['confidence'] === 'plausible' ? 'plausible' : 'confirmed',
  };
}
