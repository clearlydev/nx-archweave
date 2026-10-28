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
 * Unlike the sandboxed gpt/codex-action provider, `cursor-agent` is not sandboxed by default (the
 * docs' "full autonomy" example has the agent call `gh`/git directly) — so, like claude/gemini, the
 * model itself runs `gh pr diff` / `gh pr comment` inside the review step. */
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
    name: 'Cursor Code Review',
    secretName: SECRET_NAME,
    // An API key: the Cursor CLI needs no OIDC token.
    idToken: false,
    reviewSteps: [
      renderCheckoutStep(REVIEW_GATE_CONDITION),
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
        '    GH_TOKEN: ${{ github.token }}',
        '  run: |',
        // cursor-agent stops at "Workspace Trust Required" without --trust (2026.10.22 on
        // Actions); the folder is this run's own checkout, and forks never get the secret.
        `    agent --trust -p "$(cat <<'${PROMPT_HEREDOC_DELIMITER}'`,
        indentBlock(composePrompt(input), 4),
        `    ${PROMPT_HEREDOC_DELIMITER}`,
        '    )"',
      ].join('\n'),
    ],
  });
}

export const cursorProvider: ReviewWorkflowProvider = {
  id: 'cursor',
  workflowFileName: '.github/workflows/cursor-code-review.yml',
  requiredSecretName: SECRET_NAME,
  buildWorkflowYaml,
};
