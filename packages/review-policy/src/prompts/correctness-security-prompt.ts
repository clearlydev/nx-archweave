import type { ReviewPromptStyle } from '../modes/review-modes.ts';
import type { ReviewLocale } from '../schema/review-policy-config.ts';
import { renderDedupInstruction, renderFindingSchemaInstruction } from './prompt-shared.ts';

/** Priorities the SECTIONED prompt requests. P3 is deliberately absent —
 * over-engineering findings come only from the over-engineering prompt. */
export const CORRECTNESS_SECURITY_PRIORITIES = ['P0', 'P1', 'P2', 'Nit'] as const;
/** The fast mode drops Nit — critical problems only. */
export const FAST_PRIORITIES = ['P0', 'P1', 'P2'] as const;

export function buildCorrectnessSecurityPrompt(locale: ReviewLocale, style: ReviewPromptStyle = 'sectioned'): string {
  if (style === 'fast-condensed') {
    const fastBody =
      locale === 'en'
        ? [
            'You are a code reviewer focused on correctness and security.',
            '',
            'Review the provided diff and report only the most critical problems. Skip minor style and taste remarks entirely — report nothing below P2.',
            '',
            `Only report findings with priority ${FAST_PRIORITIES.join(', ')}. Do NOT report P3 (over-engineering) findings — they are out of scope here.`,
          ]
        : [
            '당신은 정확성(correctness)과 보안(security)에 집중하는 코드 리뷰어입니다.',
            '',
            '주어진 diff에서 가장 치명적인 문제만 보고하세요. 사소한 스타일·취향 지적은 완전히 생략하고, P2 미만은 보고하지 마세요.',
            '',
            `우선순위 ${FAST_PRIORITIES.join(', ')}에 해당하는 finding만 보고하세요. P3(과잉 설계)는 보고하지 마세요 — 이 리뷰의 범위 밖입니다.`,
          ];
    return [...fastBody, '', renderFindingSchemaInstruction(locale, FAST_PRIORITIES), '', renderDedupInstruction(locale)].join('\n');
  }
  const body =
    locale === 'en'
      ? [
          'You are a code reviewer focused on correctness and security.',
          '',
          'Review the provided diff and report findings in two explicitly separated top-level sections: "Correctness" and "Security". Never mix the two.',
          '',
          `Only report findings with priority ${CORRECTNESS_SECURITY_PRIORITIES.join(', ')}. Do NOT report P3 (over-engineering) findings — they are covered by a separate reviewer and are out of scope here.`,
        ]
      : [
          '당신은 정확성(correctness)과 보안(security)에 집중하는 코드 리뷰어입니다.',
          '',
          '주어진 diff를 리뷰하고, finding을 "Correctness"와 "Security" 두 개의 최상위 섹션으로 분리해 보고하세요. 두 섹션을 절대 섞지 마세요.',
          '',
          `우선순위 ${CORRECTNESS_SECURITY_PRIORITIES.join(', ')}에 해당하는 finding만 보고하세요. P3는 보고하지 마세요 — P3(과잉 설계)는 별도의 리뷰어가 담당하므로 이 리뷰의 범위 밖입니다.`,
        ];
  return [...body, '', renderFindingSchemaInstruction(locale, CORRECTNESS_SECURITY_PRIORITIES), '', renderDedupInstruction(locale)].join('\n');
}
