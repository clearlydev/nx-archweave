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
  renderConcurrencyBlock,
  renderPermissionsBlock,
  renderRoundGateStep,
  renderSecretGateStep,
  renderTriggerBlock,
  renderVerdictGateStep,
  renderWorkspaceSetupSteps,
  ROUND_MARKER,
} from '../workflow-skeleton.ts';

const SECRET_NAME = 'OPENAI_API_KEY';

/** Research finding (see gpt-provider research notes): `openai/codex-action` runs Codex
 * inside a sandbox that grants no network access under the `:read-only` / `:workspace`
 * permission profiles (the officially recommended profiles) — only an explicit,
 * repo-trusted custom permission profile can open a domain allowlist, and the action's
 * own README works around this by never letting the sandboxed step call `gh`/the GitHub
 * API at all. So unlike the Claude/Gemini providers, this provider cannot have the model
 * itself run `gh pr diff` / `gh pr comment` inside the review step. Instead: the diff is
 * read locally (via `git log`/`git diff` against the pre-fetched base and head refs,
 * mirroring the action's own documented pattern), and a separate deterministic step in
 * the same job posts the model's final message as the single top-level PR comment. */
function renderWorkflowInstructions(locale: ReviewLocale): string {
  const lines =
    locale === 'en'
      ? [
          'Review ONLY the changes introduced by this pull request. The base and head commits are already fetched under fixed ref names: run `git diff origin/pr-base...origin/pr-head` (and `git log origin/pr-base..origin/pr-head` for commit context) — this sandboxed step has no network access, so do not attempt to run `gh` or reach the GitHub API.',
          'Write your entire response as a single message: report specific findings, then close with one overall summary.',
          `Always include the literal marker ${ROUND_MARKER} in your message.`,
          'If there are no findings that require action, write exactly one message saying so (and still include the marker).',
          'Do not modify any code, and never approve or merge the pull request.',
          'Write summaries and explanations in English; keep file names, function names, and identifiers verbatim.',
        ]
      : [
          '이 pull request가 도입한 변경 사항만 리뷰하세요. base/head 커밋은 고정 ref 이름으로 이미 fetch되어 있습니다: `git diff origin/pr-base...origin/pr-head`로 비교하고, 커밋 맥락은 `git log origin/pr-base..origin/pr-head`로 확인하세요(이 샌드박스 스텝은 네트워크가 없으므로 `gh`나 GitHub API를 호출하지 마세요).',
          '전체 응답을 하나의 메시지로 작성하세요: 구체적 지적을 적은 뒤 마지막에 전체 요약을 한 번 더 남기세요.',
          `메시지에는 반드시 리터럴 마커 ${ROUND_MARKER}를 포함하세요.`,
          '조치가 필요한 문제가 없으면 "조치가 필요한 문제를 찾지 못했습니다."라는 메시지를 정확히 한 개 작성하세요(이때도 마커는 포함).',
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
  const gateCondition =
    "steps.secret-gate.outputs.enabled == 'true' && steps.round-gate.outputs.allowed == 'true'";

  const steps = [
    renderSecretGateStep(SECRET_NAME),
    renderRoundGateStep(input.maxRounds),
    [
      '- name: Checkout repository',
      `  if: ${gateCondition}`,
      '  uses: actions/checkout@v4',
      '  with:',
      '    ref: refs/pull/${{ github.event.pull_request.number }}/merge',
      '    fetch-depth: 1',
      '    persist-credentials: false',
    ].join('\n'),
    [
      '- name: Fetch base and head refs for the PR',
      `  if: ${gateCondition}`,
      '  env:',
      '    PR_BASE_REF: ${{ github.event.pull_request.base.ref }}',
      '    PR_NUMBER: ${{ github.event.pull_request.number }}',
      '  run: |',
      '    # Explicit destinations: the sandboxed review step has no network, so both sides',
      '    # of the diff must survive as stable local refs (FETCH_HEAD alone is ambiguous).',
      '    git fetch --no-tags origin \\',
      '      "+refs/heads/$PR_BASE_REF:refs/remotes/origin/pr-base" \\',
      '      "+refs/pull/$PR_NUMBER/head:refs/remotes/origin/pr-head"',
    ].join('\n'),
    [
      '- name: Run Codex review',
      '  id: codex-review',
      `  if: ${gateCondition}`,
      '  uses: openai/codex-action@v1',
      '  with:',
      `    openai-api-key: \${{ secrets.${SECRET_NAME} }}`,
      '    permission-profile: ":read-only"',
      '    prompt: |',
      indentBlock(composePrompt(input), 6),
    ].join('\n'),
    [
      '- name: Post review comment',
      `  if: ${gateCondition}`,
      '  env:',
      '    GH_TOKEN: ${{ github.token }}',
      '    PR_NUMBER: ${{ github.event.pull_request.number }}',
      '    REVIEW_BODY: ${{ steps.codex-review.outputs.final-message }}',
      '  run: |',
      '    printf %s "$REVIEW_BODY" | gh pr comment "$PR_NUMBER" --body-file -',
    ].join('\n'),
    renderWorkspaceSetupSteps(input.packageManager),
    renderVerdictGateStep(input.maxRounds, input.locale)
  ];

  return [
    'name: GPT Code Review',
    '',
    renderTriggerBlock(),
    '',
    renderConcurrencyBlock(),
    '',
    renderPermissionsBlock(),
    '',
    'jobs:',
    '  review:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    indentBlock(steps.join('\n\n'), 6),
    '',
  ].join('\n');
}

export const gptProvider: ReviewWorkflowProvider = {
  id: 'gpt',
  workflowFileName: '.github/workflows/gpt-code-review.yml',
  requiredSecretName: SECRET_NAME,
  buildWorkflowYaml,
};
