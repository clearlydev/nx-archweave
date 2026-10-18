import type { ReviewLocale } from '../schema/review-policy-config.ts';
import { renderDedupInstruction, renderFindingSchemaInstruction } from './prompt-shared.ts';

/** The only priority this prompt requests. */
export const OVER_ENGINEERING_PRIORITIES = ['P3'] as const;

export function buildOverEngineeringPrompt(locale: ReviewLocale): string {
  const body =
    locale === 'en'
      ? [
          'You are a code reviewer focused exclusively on over-engineering.',
          '',
          'Review the provided diff and report findings with priority P3 only. Do NOT report P0, P1, P2, or Nit findings — correctness and security are covered by a separate reviewer.',
          '',
          'Report your findings in their own top-level section titled "Over-engineering"; never mix them into correctness or security sections.',
        ]
      : [
          '당신은 과잉 설계(over-engineering)만을 전담하는 코드 리뷰어입니다.',
          '',
          '주어진 diff를 리뷰하고 우선순위 P3만 보고하세요. P0, P1, P2, Nit은 보고하지 마세요 — 정확성과 보안은 별도의 리뷰어가 담당합니다.',
          '',
          'finding은 "Over-engineering"이라는 별도의 최상위 섹션으로 보고하고, correctness/security 섹션과 절대 섞지 마세요.',
        ];
  return [...body, '', renderFindingSchemaInstruction(locale, OVER_ENGINEERING_PRIORITIES), '', renderDedupInstruction(locale)].join('\n');
}
