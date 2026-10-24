import {
  buildCorrectnessSecurityPrompt,
  renderFindingsBlockInstruction,
  buildOverEngineeringPrompt,
  REVIEW_MODES,
  type ReviewLocale,
} from '@nx-archweave/review-policy';
import type { ReviewWorkflowInput, ReviewWorkflowProvider } from '../provider.ts';
import {
  indentBlock,
  renderCheckoutStep,
  renderReviewWorkflow,
  REVIEW_GATE_CONDITION,
  ROUND_MARKER,
} from '../workflow-skeleton.ts';
import { pinnedUses } from '../action-pins.ts';

const SECRET_NAME = 'GEMINI_API_KEY';

/** Workflow-layer instructions that wrap the policy prompts:
 * round marker, explicit no-findings comment, no code edits / no merge, language policy.
 * The Gemini CLI runs with `--yolo` (auto-approves tool calls), so `gh pr diff` /
 * `gh pr comment` work the same way they do for the Claude provider. */
function renderWorkflowInstructions(locale: ReviewLocale): string {
  const lines =
    locale === 'en'
      ? [
          'Review the diff of this pull request using `gh pr diff` and `gh pr view`.',
          'Post specific findings as inline comments and exactly one top-level summary comment.',
          `Always include the literal marker ${ROUND_MARKER} in the top-level summary comment.`,
          'If there are no findings that require action, post exactly one top-level comment saying so (and still include the marker).',
          'Do not modify any code, and never approve or merge the pull request.',
          'Write summaries and explanations in English; keep file names, function names, and identifiers verbatim.',
        ]
      : [
          '이 pull request의 diff를 `gh pr diff`와 `gh pr view`로 확인하고 리뷰하세요.',
          '구체적 지적은 inline comment로, 전체 요약은 정확히 한 개의 top-level comment로 게시하세요.',
          `top-level 요약 코멘트에는 반드시 리터럴 마커 ${ROUND_MARKER}를 포함하세요.`,
          '조치가 필요한 문제가 없으면 "조치가 필요한 문제를 찾지 못했습니다."라는 top-level comment를 정확히 한 개 게시하세요(이때도 마커는 포함).',
          '코드를 수정하지 마세요(Do not modify any code). PR을 승인하거나 병합하지 마세요(never approve or merge).',
          '요약과 설명은 한국어로 쓰되, 파일명·함수명·식별자는 원문 그대로 유지하세요.',
        ];
  return lines.join('\n');
}

function composePrompt(input: ReviewWorkflowInput): string {
  const mode = REVIEW_MODES[input.mode];
  const sections = [renderWorkflowInstructions(input.locale), buildCorrectnessSecurityPrompt(input.locale, mode.promptStyle)];
  if (mode.includesOverEngineering) {
    sections.push(buildOverEngineeringPrompt(input.locale));
  }
  // Last on purpose: its text points back at "the finding schema above",
  // which the policy prompts have rendered by now.
  sections.push(renderFindingsBlockInstruction(input.locale));
  return sections.join('\n\n---\n\n');
}

function buildWorkflowYaml(input: ReviewWorkflowInput): string {
  return renderReviewWorkflow(input, {
    name: 'Gemini Code Review',
    secretName: SECRET_NAME,
    // An API key: run-gemini-cli uses OIDC only for Google Cloud workload identity federation.
    idToken: false,
    reviewSteps: [
      renderCheckoutStep(REVIEW_GATE_CONDITION),
      [
        '- name: Run Gemini review',
        `  if: ${REVIEW_GATE_CONDITION}`,
        `  uses: ${pinnedUses('google-github-actions/run-gemini-cli')}`,
        '  env:',
        '    GITHUB_TOKEN: ${{ github.token }}',
        '  with:',
        `    gemini_api_key: \${{ secrets.${SECRET_NAME} }}`,
        '    prompt: |',
        indentBlock(composePrompt(input), 6),
      ].join('\n'),
    ],
  });
}

export const geminiProvider: ReviewWorkflowProvider = {
  id: 'gemini',
  workflowFileName: '.github/workflows/gemini-code-review.yml',
  requiredSecretName: SECRET_NAME,
  buildWorkflowYaml,
};
