import {
  buildCorrectnessSecurityPrompt,
  renderFindingsBlockInstruction,
  buildOverEngineeringPrompt,
  renderContentIsDataInstruction,
  REVIEW_MODES,
  type ReviewLocale,
} from '@nx-archweave/review-policy';
import type { ReviewWorkflowInput, ReviewWorkflowProvider } from '../provider.ts';
import {
  indentBlock,
  renderCheckoutStep,
  renderPostReviewStep,
  renderReviewMaterialStep,
  renderReviewWorkflow,
  REVIEW_GATE_CONDITION,
  REVIEW_MATERIAL_DIR,
  ROUND_MARKER,
} from '../workflow-skeleton.ts';
import { pinnedUses } from '../action-pins.ts';

const SECRET_NAME = 'GEMINI_API_KEY';

/** Workflow-layer instructions that wrap the policy prompts: where the material is, round marker,
 * explicit no-findings message, no code edits / no merge, language policy. The agent reads files
 * only; a later step of the job posts its final message as the summary comment. */
function renderWorkflowInstructions(locale: ReviewLocale): string {
  const lines =
    locale === 'en'
      ? [
          `Review this pull request. Its diff is in \`${REVIEW_MATERIAL_DIR}/pr.diff\`, and its title and description are in \`${REVIEW_MATERIAL_DIR}/pr.md\`. Read them with your file tools, and read files of the checkout for context. This step runs no shell commands and has no GitHub access, so don't try either.`,
          'Write your entire response as a single message: report specific findings, then close with one overall summary. A later step posts that message on the pull request.',
          `Always include the literal marker ${ROUND_MARKER} in your message.`,
          'If there are no findings that require action, write exactly one message saying so (and still include the marker).',
          'Do not modify any code, and never approve or merge the pull request.',
          'Write summaries and explanations in English; keep file names, function names, and identifiers verbatim.',
        ]
      : [
          `이 pull request를 리뷰하세요. diff는 \`${REVIEW_MATERIAL_DIR}/pr.diff\`에, 제목과 설명은 \`${REVIEW_MATERIAL_DIR}/pr.md\`에 있습니다. 파일 도구로 읽고, 맥락이 필요하면 체크아웃된 파일을 읽으세요. 이 스텝은 셸 명령을 실행하지 않고 GitHub에 접근하지도 않으니, 둘 다 시도하지 마세요.`,
          '전체 응답을 하나의 메시지로 작성하세요: 구체적 지적을 적은 뒤 마지막에 전체 요약을 한 번 더 남기세요. 이 메시지는 다음 스텝이 pull request에 게시합니다.',
          `메시지에는 반드시 리터럴 마커 ${ROUND_MARKER}를 포함하세요.`,
          '조치가 필요한 문제가 없으면 "조치가 필요한 문제를 찾지 못했습니다."라는 메시지를 정확히 한 개 작성하세요(이때도 마커는 포함).',
          '코드를 수정하지 마세요(Do not modify any code). PR을 승인하거나 병합하지 마세요(never approve or merge).',
          '요약과 설명은 한국어로 쓰되, 파일명·함수명·식별자는 원문 그대로 유지하세요.',
        ];
  return lines.join('\n');
}

function composePrompt(input: ReviewWorkflowInput): string {
  const mode = REVIEW_MODES[input.mode];
  const sections = [renderWorkflowInstructions(input.locale), renderContentIsDataInstruction(input.locale), buildCorrectnessSecurityPrompt(input.locale, mode.promptStyle)];
  if (mode.includesOverEngineering) {
    sections.push(buildOverEngineeringPrompt(input.locale));
  }
  // Last on purpose: its text points back at "the finding schema above",
  // which the policy prompts have rendered by now.
  sections.push(renderFindingsBlockInstruction(input.locale));
  return sections.join('\n\n---\n\n');
}

/** The Gemini CLI the action installs. The action's default is `latest`, so a CLI release can change
 * a working workflow overnight (0.65's workspace-trust check did, 2026-10-25). Pinned to the version
 * measured on Actions; Dependabot doesn't see this input, so a bump is a code change here. */
export const GEMINI_CLI_VERSION = '0.65.0';

/** The project settings the action writes over `.gemini/settings.json`: the agent may only read
 * files (the material and the checkout). The action runs the CLI with --yolo, which approves
 * every call to an allowed tool; this list is what keeps shell and write tools out. */
export const GEMINI_SETTINGS = JSON.stringify({ tools: { core: ['read_file', 'grep_search'] } });

/** The step that runs the review; its `summary` output is the agent's final message. */
const GEMINI_STEP_ID = 'gemini-review';

function buildWorkflowYaml(input: ReviewWorkflowInput): string {
  return renderReviewWorkflow(input, {
    name: 'Gemini Code Review',
    secretName: SECRET_NAME,
    // An API key: run-gemini-cli uses OIDC only for Google Cloud workload identity federation.
    idToken: false,
    reviewSteps: [
      renderCheckoutStep(REVIEW_GATE_CONDITION),
      // The CLI reads project settings, extensions and .env files from the checkout; only the
      // settings passed below apply.
      renderReviewMaterialStep(['.gemini', '.env']),
      [
        '- name: Run Gemini review',
        `  id: ${GEMINI_STEP_ID}`,
        `  if: ${REVIEW_GATE_CONDITION}`,
        `  uses: ${pinnedUses('google-github-actions/run-gemini-cli')}`,
        '  env:',
        // Gemini CLI 0.65 refuses to run in a folder it hasn't been told to trust (measured
        // 2026-10-25 on Actions). The folder is this run's own checkout; pull requests from forks
        // never get here, because they get no secret.
        "    GEMINI_CLI_TRUST_WORKSPACE: 'true'",
        '  with:',
        `    gemini_api_key: \${{ secrets.${SECRET_NAME} }}`,
        `    gemini_cli_version: '${GEMINI_CLI_VERSION}'`,
        `    settings: '${GEMINI_SETTINGS}'`,
        '    prompt: |',
        indentBlock(composePrompt(input), 6),
      ].join('\n'),
      renderPostReviewStep({ expression: `\${{ steps.${GEMINI_STEP_ID}.outputs.summary }}` }),
    ],
  });
}

export const geminiProvider: ReviewWorkflowProvider = {
  id: 'gemini',
  workflowFileName: '.github/workflows/gemini-code-review.yml',
  requiredSecretName: SECRET_NAME,
  buildWorkflowYaml,
};
