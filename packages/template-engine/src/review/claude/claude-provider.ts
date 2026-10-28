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

const SECRET_NAME = 'CLAUDE_CODE_OAUTH_TOKEN';

/** The tool list of claude-code-action's own PR-review examples (examples/pr-review-comprehensive.yml):
 * inline comments, the summary comment, and reading the PR. Reading files and the read-only git
 * commands need no entry; nothing here can edit the tree or call the API at large (`gh api`). */
export const ALLOWED_TOOLS =
  'mcp__github_inline_comment__create_inline_comment,Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*)';

/** The id of the step that runs the action; its `execution_file` output feeds the denial report. */
const CLAUDE_STEP_ID = 'claude-review';

/** The pull request the agent reviews. claude-code-action's agent mode hands the prompt over
 * as is, and a `pull_request` checkout is a detached merge commit, so a bare `gh pr diff` finds
 * no pull request: the agent then reaches for commands outside ALLOWED_TOOLS and is denied. */
const PR_CONTEXT = ['REPO: ${{ github.repository }}', 'PR NUMBER: ${{ github.event.pull_request.number }}'];

/** Workflow-layer instructions that wrap the policy prompts:
 * round marker, explicit no-findings comment, no code edits / no merge, language policy. */
function renderWorkflowInstructions(locale: ReviewLocale): string {
  const lines =
    locale === 'en'
      ? [
          ...PR_CONTEXT,
          '',
          'Review the diff of this pull request using `gh pr diff <PR NUMBER>` and `gh pr view <PR NUMBER>`.',
          'Post specific findings as inline comments with `mcp__github_inline_comment__create_inline_comment` (pass `confirmed: true`), and exactly one top-level summary comment.',
          "Post the summary with `gh pr comment <PR NUMBER> --body-file - <<'ARCHWEAVE_EOF'`, the body on the following lines, then a line `ARCHWEAVE_EOF` (the quoted delimiter keeps backticks and `$` literal). Never pass the body with `--body \"...\"` or `$(...)`.",
          'Run each `gh` command on its own: no pipes to other programs, no `&&` chains.',
          `Always include the literal marker ${ROUND_MARKER} in the top-level summary comment.`,
          'If there are no findings that require action, post exactly one top-level comment saying so (and still include the marker).',
          'Do not modify any code, and never approve or merge the pull request.',
          'Write summaries and explanations in English; keep file names, function names, and identifiers verbatim.',
        ]
      : [
          ...PR_CONTEXT,
          '',
          '이 pull request의 diff를 `gh pr diff <PR NUMBER>`와 `gh pr view <PR NUMBER>`로 확인하고 리뷰하세요.',
          '구체적 지적은 `mcp__github_inline_comment__create_inline_comment`(`confirmed: true` 전달)로 inline comment를 달고, 전체 요약은 정확히 한 개의 top-level comment로 게시하세요.',
          "요약은 `gh pr comment <PR NUMBER> --body-file - <<'ARCHWEAVE_EOF'`로 게시하세요. 다음 줄부터 본문을 쓰고, 마지막 줄에 `ARCHWEAVE_EOF`만 쓰세요(따옴표 친 구분자라 백틱과 `$`가 그대로 남아요). 본문을 `--body \"...\"`나 `$(...)`로 넘기지 마세요.",
          '`gh` 명령은 하나씩 따로 실행하세요. 다른 프로그램으로 파이프하거나 `&&`로 잇지 마세요.',
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

/** Lists the tool calls the agent was denied, after the review step (the action's own log
 * shows only a count). It reads the action's execution file and prints, per denial, the tool
 * name and the first 200 characters of the command, nothing the tools returned. The command is
 * text the model wrote from the pull request, so jq prints it as an escaped JSON string (one line,
 * control characters escaped) between ::stop-commands:: and a token made for this run, so none
 * of it is read as a workflow command. It never fails the job. */
function renderDeniedToolsStep(): string {
  return [
    '- name: Show denied tool calls',
    `  if: always() && steps.${CLAUDE_STEP_ID}.outputs.execution_file != ''`,
    '  env:',
    `    EXECUTION_FILE: \${{ steps.${CLAUDE_STEP_ID}.outputs.execution_file }}`,
    '  run: |',
    '    [ -f "$EXECUTION_FILE" ] || exit 0',
    '    stop_token="archweave-$(od -An -N16 -tx1 /dev/urandom | tr -d \' \\n\')"',
    '    echo "::stop-commands::$stop_token"',
    `    jq -c '.[] | select(.type == "result") | .permission_denials[]? | {tool: .tool_name, command: ((.tool_input.command // "") | tostring | .[0:200])}' "$EXECUTION_FILE" || echo "Could not read the execution file."`,
    '    echo "::$stop_token::"',
  ].join('\n');
}

function buildWorkflowYaml(input: ReviewWorkflowInput): string {
  return renderReviewWorkflow(input, {
    name: 'Claude Code Review',
    secretName: SECRET_NAME,
    // The Claude GitHub App signs in with the workflow's OIDC token (claude-code-action's FAQ).
    idToken: true,
    reviewSteps: [
      renderCheckoutStep(REVIEW_GATE_CONDITION),
      [
        '- name: Run Claude review',
        `  id: ${CLAUDE_STEP_ID}`,
        `  if: ${REVIEW_GATE_CONDITION}`,
        `  uses: ${pinnedUses('anthropics/claude-code-action')}`,
        '  with:',
        `    claude_code_oauth_token: \${{ secrets.${SECRET_NAME} }}`,
        '    prompt: |',
        indentBlock(composePrompt(input), 6),
        '    claude_args: |',
        `      --allowedTools "${ALLOWED_TOOLS}"`,
      ].join('\n'),
      renderDeniedToolsStep(),
    ],
  });
}

export const claudeProvider: ReviewWorkflowProvider = {
  id: 'claude',
  workflowFileName: '.github/workflows/claude-code-review.yml',
  requiredSecretName: SECRET_NAME,
  buildWorkflowYaml,
};
