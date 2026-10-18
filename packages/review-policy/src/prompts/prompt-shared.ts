import type { ReviewPriority } from '../schema/review-finding.ts';
import type { ReviewLocale } from '../schema/review-policy-config.ts';
import { FINDINGS_MARKER, FINDINGS_SCHEMA_ID } from '../verdict-gate/findings-block.ts';

/** The ReviewFinding schema, rendered as an instruction block. Field names stay in
 * English in both locales — they are the machine contract the response must follow. */
export function renderFindingSchemaInstruction(
  locale: ReviewLocale,
  priorities: readonly ReviewPriority[],
): string {
  const intro =
    locale === 'en'
      ? 'For every finding, fill in every field of this schema:'
      : '모든 finding에 대해 아래 스키마의 모든 필드를 채우세요:';
  return [
    intro,
    `- priority: ${priorities.join(' | ')}`,
    '- category: kebab-case category name',
    '- title: one-line summary',
    '- file: path of the affected file',
    '- lineRange: { start, end? }',
    '- evidence: what in the code proves the problem',
    '- impact: what goes wrong and for whom',
    '- reproductionCondition: the exact input/state that triggers it',
    '- recommendation: the concrete fix',
    '- confidence: confirmed | plausible',
  ].join('\n');
}

/** The machine half of the summary comment. Shared by all providers. */
export function renderFindingsBlockInstruction(locale: ReviewLocale): string {
  const lines =
    locale === 'en'
      ? [
          'At the END of the top-level summary comment, append the machine-readable findings block:',
          `the literal marker line ${FINDINGS_MARKER}, then a fenced \`\`\`json block containing`,
          `{ "schema": "${FINDINGS_SCHEMA_ID}", "findings": [ ... ] } with one entry per finding,`,
          'using exactly the finding schema above. If there are no findings, still append the block with an empty findings array.',
        ]
      : [
          'top-level 요약 코멘트의 맨 끝에 기계 판독용 findings 블록을 덧붙이세요:',
          `리터럴 마커 줄 ${FINDINGS_MARKER} 다음에 fenced \`\`\`json 블록으로`,
          `{ "schema": "${FINDINGS_SCHEMA_ID}", "findings": [ ... ] }를, finding마다 한 원소씩, 위 finding 스키마 그대로 작성하세요.`,
          'finding이 없어도 빈 배열로 블록을 반드시 포함하세요.',
        ];
  return lines.join('\n');
}

export function renderDedupInstruction(locale: ReviewLocale): string {
  return locale === 'en'
    ? 'If multiple findings share the same root cause, merge them into a single finding instead of reporting duplicates.'
    : '같은 원인에서 나온 finding이 여러 개라면 중복 보고하지 말고 하나의 finding으로 합쳐서 보고하세요.';
}
