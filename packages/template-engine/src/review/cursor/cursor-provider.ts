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

const SECRET_NAME = 'CURSOR_API_KEY';

/** Heredoc delimiter for the shell prompt passed to `agent --trust -p`; quoted (`'...'`) so the
 * composed prompt's own content (backticks, `$(...)`, etc.) is never shell-expanded.
 *
 * Indentation invariant: every line between `<<'DELIM'` and the terminator is emitted at
 * the same base indent, so YAML's block-scalar common-indentation stripping lands the
 * terminator at column 0 where bash requires it. Prompt lines must therefore never start
 * with extra leading whitespace (they would survive stripping — harmless for the prompt
 * text but pinned by a spec test anyway) and, critically, no prompt line may EQUAL this
 * delimiter string, or the heredoc would terminate early — both invariants are asserted
 * in cursor-provider.spec.ts. */
const PROMPT_HEREDOC_DELIMITER = 'ARCHWEAVE_CURSOR_REVIEW_PROMPT';

/** Research finding (2026-09-12, verified against https://cursor.com/docs/cli/github-actions
 * and https://cursor.com/docs/cli/headless): there is no official Marketplace Action, so the
 * workflow installs the `cursor-agent` CLI itself (`curl https://cursor.com/install -fsS | bash`,
 * then adds its directory to `$GITHUB_PATH`) and invokes it headless via `agent --trust -p "<prompt>"`.
 * The CLI offers no documented way to run without its shell, so the agent step gets no GitHub
 * token: it reads the material a previous step wrote, prints its review, and a later step of the
 * job posts that as the summary comment. */
function renderWorkflowInstructions(locale: ReviewLocale): string {
  const lines =
    locale === 'en'
      ? [
          `Review this pull request. Its diff is in \`${REVIEW_MATERIAL_DIR}/pr.diff\`, and its title and description are in \`${REVIEW_MATERIAL_DIR}/pr.md\`. Read them, and read files of the checkout for context. This step has no GitHub access, so don't run \`gh\` or call the GitHub API.`,
          'Write your entire response as a single message: report specific findings, then close with one overall summary. A later step posts that message on the pull request.',
          `Always include the literal marker ${ROUND_MARKER} in your message.`,
          'If there are no findings that require action, write exactly one message saying so (and still include the marker).',
          'Do not modify any code, and never approve or merge the pull request.',
          'Write summaries and explanations in English; keep file names, function names, and identifiers verbatim.',
        ]
      : [
          `이 pull request를 리뷰하세요. diff는 \`${REVIEW_MATERIAL_DIR}/pr.diff\`에, 제목과 설명은 \`${REVIEW_MATERIAL_DIR}/pr.md\`에 있습니다. 이 파일들을 읽고, 맥락이 필요하면 체크아웃된 파일을 읽으세요. 이 스텝은 GitHub에 접근할 수 없으니 \`gh\`를 실행하거나 GitHub API를 호출하지 마세요.`,
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

/** The agent's printed review, which the post step sends as the summary comment. */
const CURSOR_REVIEW_FILE = `${REVIEW_MATERIAL_DIR}/review.md`;

function buildWorkflowYaml(input: ReviewWorkflowInput): string {
  return renderReviewWorkflow(input, {
    name: 'Cursor Code Review',
    secretName: SECRET_NAME,
    // An API key: the Cursor CLI needs no OIDC token.
    idToken: false,
    reviewSteps: [
      renderCheckoutStep(REVIEW_GATE_CONDITION),
      // The CLI reads rules, MCP servers and permissions from .cursor/ in the checkout.
      renderReviewMaterialStep(['.cursor']),
      [
        '- name: Install cursor-agent CLI',
        `  if: ${REVIEW_GATE_CONDITION}`,
        '  run: |',
        // HTTPS only, TLS 1.2 or newer. Cursor publishes no pinned version or checksum for
        // this installer; docs/pr-review.md states what that leaves open.
        "    curl --proto '=https' --tlsv1.2 -fsS https://cursor.com/install | bash",
        // The docs name ~/.cursor/bin; the installer currently links `agent` into ~/.local/bin.
        // Both go on the PATH, so the next step finds it wherever the installer puts it.
        '    echo "$HOME/.local/bin" >> "$GITHUB_PATH"',
        '    echo "$HOME/.cursor/bin" >> "$GITHUB_PATH"',
      ].join('\n'),
      [
        '- name: Run Cursor review',
        `  if: ${REVIEW_GATE_CONDITION}`,
        '  env:',
        `    CURSOR_API_KEY: \${{ secrets.${SECRET_NAME} }}`,
        '  run: |',
        // cursor-agent stops at "Workspace Trust Required" without --trust (2026.10.22 on
        // Actions); the folder is this run's own checkout, and forks never get the secret.
        `    agent --trust -p "$(cat <<'${PROMPT_HEREDOC_DELIMITER}'`,
        indentBlock(composePrompt(input), 4),
        `    ${PROMPT_HEREDOC_DELIMITER}`,
        `    )" > ${CURSOR_REVIEW_FILE}`,
      ].join('\n'),
      renderPostReviewStep({ file: CURSOR_REVIEW_FILE }),
    ],
  });
}

export const cursorProvider: ReviewWorkflowProvider = {
  id: 'cursor',
  workflowFileName: '.github/workflows/cursor-code-review.yml',
  requiredSecretName: SECRET_NAME,
  buildWorkflowYaml,
};
