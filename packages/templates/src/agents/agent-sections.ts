/**
 * Section library for agent-rules documents (`CLAUDE.md` / `AGENTS.md`).
 *
 * Classification:
 * - A (universal-principle): language/framework-agnostic guidance, reused as-is.
 * - A+B (Safety Rules): a generic body plus a `<!-- TODO -->` placeholder for the
 *   project-specific list of protected resources.
 * - B (Language Policy): the text itself differs per locale, not just its heading.
 * - C (project-specific, reduced to placeholder): Project Goal and Architecture
 *   Boundary carry only a heading and a TODO marker — the actual content is
 *   necessarily project-specific and left for the user to fill in.
 * - Team Rules (A+B, opt-in): collaboration rules for a shared repository plus a
 *   TODO marker for the team's own conventions. NOT in the default composition —
 *   `template-engine/agent-rules` adds it when asked.
 *
 * This module owns static text only (`templates` depends on nothing but
 * `shared`-level types). Composition into full documents is
 * `template-engine/agent-rules`'s job.
 */

export type AgentRuleLocale = 'en' | 'ko';

export type AgentSectionId =
  | 'think-before-coding'
  | 'simplicity-first'
  | 'surgical-changes'
  | 'goal-driven-execution'
  | 'code-structure'
  | 'safety-rules'
  | 'language-policy'
  | 'team-rules'
  | 'fsd-structure'
  | 'project-goal'
  | 'architecture-boundary';

export interface AgentRuleSection {
  readonly id: AgentSectionId;
  readonly heading: string;
  readonly body: string;
}

/** The five universal-principle sections, in the order they should render. */
export const UNIVERSAL_AGENT_SECTION_IDS: readonly AgentSectionId[] = [
  'think-before-coding',
  'simplicity-first',
  'surgical-changes',
  'goal-driven-execution',
  'code-structure',
];

/** Project-specific sections reduced to a heading + TODO placeholder (classification C). */
export const PLACEHOLDER_AGENT_SECTION_IDS: readonly AgentSectionId[] = ['project-goal', 'architecture-boundary'];

/** The opt-in Team Rules section. Deliberately absent from
 * `DEFAULT_AGENT_SECTION_IDS` so Quick Start / Solo output stays byte-identical. */
export const TEAM_AGENT_SECTION_ID = 'team-rules' satisfies AgentSectionId;

/** The opt-in FSD section: the frontend's layer rules, included when
 * the workspace has FSD on. Absent from `DEFAULT_AGENT_SECTION_IDS` for the same reason. */
export const FSD_AGENT_SECTION_ID = 'fsd-structure' satisfies AgentSectionId;

/** Default composition when the caller doesn't override `sections`: all
 * universal principles, then Safety Rules, then Language Policy, then the two
 * placeholder sections. */
export const DEFAULT_AGENT_SECTION_IDS: readonly AgentSectionId[] = [
  ...UNIVERSAL_AGENT_SECTION_IDS,
  'safety-rules',
  'language-policy',
  ...PLACEHOLDER_AGENT_SECTION_IDS,
];

const EN_SECTIONS: Record<AgentSectionId, AgentRuleSection> = {
  'think-before-coding': {
    id: 'think-before-coding',
    heading: 'Think Before Coding',
    body: [
      'Before writing any code, restate the problem in your own words and identify what could go wrong.',
      'Read the surrounding code and existing patterns before introducing new ones — consistency beats',
      'personal preference. When a request is ambiguous, make the most reasonable interpretation and say',
      "what you assumed, rather than guessing silently or blocking on a question you could answer yourself.",
      'Prefer understanding the root cause of a problem over patching its symptoms.',
    ].join('\n'),
  },
  'simplicity-first': {
    id: 'simplicity-first',
    heading: 'Simplicity First',
    body: [
      'Choose the simplest design that solves the actual problem in front of you, not the one you might',
      "have tomorrow. Avoid speculative abstraction, unnecessary configuration, and generic frameworks",
      "built for requirements nobody has asked for yet. A straightforward, slightly duplicated solution",
      'that is easy to read beats a clever, general one that is hard to follow. Add complexity only when',
      'a concrete, current need demands it.',
    ].join('\n'),
  },
  'surgical-changes': {
    id: 'surgical-changes',
    heading: 'Surgical Changes',
    body: [
      'Change only what the task requires. Do not reformat, rename, or refactor unrelated code while',
      'fixing something else — unrelated changes make review harder and hide the actual fix in noise.',
      'Keep diffs small and focused so a reviewer can see exactly what changed and why. If you notice an',
      'unrelated problem while working, note it separately instead of folding it into the current change.',
    ].join('\n'),
  },
  'goal-driven-execution': {
    id: 'goal-driven-execution',
    heading: 'Goal-Driven Execution',
    body: [
      "Keep the actual goal in view, not just the literal instruction. If a requested step turns out to",
      "be unnecessary, harmful, or based on a wrong assumption once you're in the code, say so and propose",
      'the better path instead of executing it mechanically. Finish what you start: a task is done when it',
      'actually works, not when the obvious-looking code has been written. Verify before declaring success.',
    ].join('\n'),
  },
  'code-structure': {
    id: 'code-structure',
    heading: 'Code Structure and Abstraction',
    body: [
      'Keep functions and modules focused on one responsibility; split a file or function when it starts',
      'accumulating unrelated concerns rather than letting it grow into a god object. Name things after',
      'what they do or represent, not after their implementation detail. Extract an abstraction only after',
      'a pattern has actually repeated — not in anticipation of a repetition that may never come.',
    ].join('\n'),
  },
  'safety-rules': {
    id: 'safety-rules',
    heading: 'Safety Rules',
    body: [
      'Never force-push to shared branches, never bypass required status checks, and never disable or',
      'delete CI/CD configuration just to make a failing check pass.',
      "Do not read, print, or commit the contents of secret files (`.env`, credential files, private",
      'keys) — treat anything matching a common secret pattern as off-limits unless the user has already',
      'shared its contents with you directly.',
      "Do not run destructive commands (`rm -rf`, `git reset --hard`, `git clean -f`, force pushes)",
      'without explicit confirmation, and check for uncommitted work first.',
      'Do not send repository contents, credentials, or user data to any external service.',
      'When you are unsure whether an action is safe, stop and ask instead of proceeding.',
      '',
      '<!-- TODO: list project-specific protected resources (e.g. production config files, protected',
      'branches, restricted directories, external services this project must never call in tests). -->',
    ].join('\n'),
  },
  'language-policy': {
    id: 'language-policy',
    heading: 'Language Policy',
    body: [
      'Communicate with the user in English. Write code, identifiers, comments, commit messages, and',
      'documentation in English as well, unless the user explicitly asks for another language for a',
      'specific piece of content.',
    ].join('\n'),
  },
  'team-rules': {
    id: 'team-rules',
    heading: 'Team Rules',
    body: [
      'This repository is shared by a team: optimize for the reviewer, not for yourself.',
      'Keep each pull request small and about one thing, fill in the pull request template, and link',
      'the issue it closes.',
      'Treat review findings as work, not opinions: address every P0/P1 finding before asking for',
      'another look, answer each comment, and never merge your own pull request or dismiss a review',
      'to get it through.',
      'Respect module ownership: a change that crosses a module or layer boundary needs that',
      "module's owner in the review. Never weaken a module-boundary lint rule, add an eslint-disable",
      'for one, or retag a project to get an import past the boundary — propose the boundary change',
      'in the pull request description instead.',
      'Changes to shared code (the `shared` layer, `shared-types`, root configuration) affect every',
      'team member: keep them backward compatible, call them out in the pull request, and keep them',
      'separate from feature work.',
      'Never commit directly to a protected branch; work on a branch and bring it up to date with',
      'its base before requesting review.',
      '',
      '<!-- TODO: list team-specific conventions (module owners / CODEOWNERS, required reviewers,',
      'branch naming, release process). -->',
    ].join('\n'),
  },
  'fsd-structure': {
    id: 'fsd-structure',
    heading: 'Frontend Structure (FSD Lite)',
    body: [
      'The frontend app follows canonical Feature-Sliced Design. "Lite" means only that the default scope',
      'is `app`, `pages`, `features`, `entities` and `shared` (`widgets` only on request) and that Solo',
      'workspaces get warnings instead of errors — the rules themselves are the canonical ones:',
      '- A layer imports only layers below it: app > pages > widgets > features > entities > shared.',
      '- Slices on one layer (pages, widgets, features, entities) never import each other; move the',
      "  shared part one layer down, or expose it through the other slice's `@x/<consumer>` public API.",
      '- Import a slice only through its `index.ts`; never reach into its `ui/`, `model/` or `api/` files.',
      '- `app` and `shared` hold segments, not slices; shared segments are named by purpose (`ui`, `api`,',
      '  `model`, `lib`, `config`), never by essence (`components`, `hooks`, `utils`, `types`).',
      'Create slices with the generators (`nx g @clearlydev/nx-archweave:page|widget|feature|entity|shared --name=…`,',
      '`--segments=ui,api` for extra segments).',
      'The `archweave/fsd-boundaries` ESLint rule reports violations: fix the import, never disable the',
      'rule or add an eslint-disable for it. On Next.js the pages layer is the `_pages/` directory.',
    ].join('\n'),
  },
  'project-goal': {
    id: 'project-goal',
    heading: 'Project Goal',
    body: '<!-- TODO: describe this project\'s goal, target users, and what success looks like. -->',
  },
  'architecture-boundary': {
    id: 'architecture-boundary',
    heading: 'Architecture Boundary',
    body:
      '<!-- TODO: describe this project\'s module boundaries, ownership rules, and which modules may or ' +
      'may not depend on which. -->',
  },
};

const KO_SECTIONS: Record<AgentSectionId, AgentRuleSection> = {
  'think-before-coding': {
    id: 'think-before-coding',
    heading: '코딩 전에 먼저 생각하기',
    body: [
      '코드를 작성하기 전에 문제를 스스로의 말로 다시 정리하고 무엇이 잘못될 수 있는지 파악한다.',
      '새 패턴을 도입하기 전에 주변 코드와 기존 관례를 먼저 읽는다 — 개인 취향보다 일관성이 우선이다.',
      '요청이 모호할 때는 가장 합리적인 해석을 택하고 무엇을 가정했는지 밝힌다. 스스로 답할 수 있는',
      '질문으로 작업을 막지 말고, 조용히 추측만 하지도 않는다. 증상을 땜질하기보다 근본 원인을 이해하는',
      '쪽을 우선한다.',
    ].join('\n'),
  },
  'simplicity-first': {
    id: 'simplicity-first',
    heading: '단순함 우선',
    body: [
      '지금 눈앞의 문제를 해결하는 가장 단순한 설계를 선택한다 — 내일 필요할지도 모르는 것까지 대비하지',
      '않는다. 아무도 요청하지 않은 요구사항을 위한 추측성 추상화, 불필요한 설정, 범용 프레임워크를',
      '피한다. 읽기 쉬운 약간의 중복이 있는 해법이, 이해하기 어려운 영리하고 범용적인 해법보다 낫다.',
      '구체적이고 현재 존재하는 필요가 있을 때만 복잡도를 추가한다.',
    ].join('\n'),
  },
  'surgical-changes': {
    id: 'surgical-changes',
    heading: '외과적 변경',
    body: [
      '작업에 필요한 부분만 변경한다. 다른 문제를 고치는 김에 관련 없는 코드를 재포맷하거나, 이름을',
      '바꾸거나, 리팩터링하지 않는다 — 관련 없는 변경은 리뷰를 어렵게 만들고 실제 수정 내용을 노이즈',
      '속에 숨긴다. diff를 작고 집중되게 유지해 리뷰어가 무엇이, 왜 바뀌었는지 정확히 볼 수 있게 한다.',
      '작업 중 관련 없는 문제를 발견하면 현재 변경에 섞지 말고 별도로 알린다.',
    ].join('\n'),
  },
  'goal-driven-execution': {
    id: 'goal-driven-execution',
    heading: '목표 지향 실행',
    body: [
      '문자 그대로의 지시가 아니라 실제 목표를 계속 염두에 둔다. 코드를 살펴보니 요청받은 단계가',
      '불필요하거나, 해롭거나, 잘못된 가정에 기반한 것으로 드러나면 기계적으로 실행하지 말고 그렇다고',
      '말한 뒤 더 나은 경로를 제안한다. 시작한 일은 끝낸다 — 그럴듯해 보이는 코드를 작성했을 때가 아니라',
      '실제로 동작할 때가 완료다. 성공을 선언하기 전에 반드시 검증한다.',
    ].join('\n'),
  },
  'code-structure': {
    id: 'code-structure',
    heading: '코드 구조와 추상화',
    body: [
      '함수와 모듈을 하나의 책임에 집중시킨다. God object로 커지도록 두지 말고, 관련 없는 관심사가',
      '쌓이기 시작하면 파일이나 함수를 분리한다. 구현 세부사항이 아니라 하는 일이나 나타내는 대상을',
      '기준으로 이름을 짓는다. 패턴이 실제로 반복된 뒤에만 추상화를 추출한다 — 언젠가 반복될지도 모른다는',
      '예측만으로 미리 추출하지 않는다.',
    ].join('\n'),
  },
  'safety-rules': {
    id: 'safety-rules',
    heading: '안전 규칙',
    body: [
      '공유 브랜치에 force-push하지 않고, 필수 상태 검사를 우회하지 않으며, 실패하는 검사를 통과시키기',
      '위해 CI/CD 설정을 비활성화하거나 삭제하지 않는다.',
      '비밀 파일(`.env`, 자격 증명 파일, 개인 키)의 내용을 읽거나 출력하거나 커밋하지 않는다 — 사용자가',
      '먼저 직접 내용을 공유하지 않는 한, 일반적인 비밀 파일 패턴에 해당하는 것은 접근 금지 대상으로',
      '취급한다.',
      '명시적 확인 없이 파괴적 명령(`rm -rf`, `git reset --hard`, `git clean -f`, force-push)을 실행하지',
      '않으며, 실행 전 커밋되지 않은 작업이 있는지 먼저 확인한다.',
      '저장소 내용, 자격 증명, 사용자 데이터를 외부 서비스로 전송하지 않는다.',
      '어떤 동작이 안전한지 확신이 서지 않으면 진행하지 말고 먼저 질문한다.',
      '',
      // The marker itself stays in English, matching the Language Policy's "code/comments in
      // English" rule and giving tooling a single locale-invariant string to check for.
      '<!-- TODO: list project-specific protected resources (e.g. production config files, protected',
      'branches, restricted directories, external services this project must never call in tests). -->',
    ].join('\n'),
  },
  'language-policy': {
    id: 'language-policy',
    heading: '언어 정책',
    body: [
      '사용자와의 대화는 한국어로 진행한다. 코드, 식별자, 주석, 커밋 메시지, 문서는 사용자가 특정',
      '항목에 대해 다른 언어를 명시적으로 요청하지 않는 한 영어로 작성한다.',
    ].join('\n'),
  },
  'team-rules': {
    id: 'team-rules',
    heading: '팀 규칙',
    body: [
      '이 저장소는 팀이 함께 쓴다 — 자신이 아니라 리뷰어를 위해 최적화한다.',
      'PR은 작게, 한 가지 주제만 다루며, PR 템플릿을 채우고 닫는 이슈를 링크한다.',
      '리뷰 finding은 의견이 아니라 작업이다 — 재리뷰를 요청하기 전에 P0/P1 finding을 모두 해결하고,',
      '코멘트마다 답하며, 자기 PR을 스스로 머지하거나 리뷰를 dismiss해서 통과시키지 않는다.',
      '모듈 소유권을 존중한다 — 모듈이나 레이어 경계를 넘는 변경은 해당 모듈 오너의 리뷰가 필요하다.',
      'import를 경계 너머로 통과시키기 위해 module-boundary 린트 규칙을 약화하거나, eslint-disable을',
      '추가하거나, 프로젝트 태그를 바꾸지 않는다 — 경계 변경은 PR 본문에서 제안한다.',
      '공유 코드(`shared` 레이어, `shared-types`, 루트 설정) 변경은 팀 전원에게 영향을 준다 — 하위',
      '호환을 유지하고, PR에 명시하며, 기능 작업과 분리한다.',
      '보호 브랜치에 직접 커밋하지 않는다 — 브랜치에서 작업하고 리뷰 요청 전에 베이스와 동기화한다.',
      '',
      // The marker stays in English, matching the Safety Rules precedent (one locale-invariant
      // string for tooling to check).
      '<!-- TODO: list team-specific conventions (module owners / CODEOWNERS, required reviewers,',
      'branch naming, release process). -->',
    ].join('\n'),
  },
  'fsd-structure': {
    id: 'fsd-structure',
    heading: '프론트엔드 구조 (FSD Lite)',
    body: [
      '프론트엔드 앱은 정식 Feature-Sliced Design을 따른다. "Lite"는 기본 범위가 `app`, `pages`, `features`,',
      '`entities`, `shared`이고(`widgets`는 요청할 때만), Solo 워크스페이스에서는 위반을 에러가 아닌',
      '경고로 알린다는 뜻일 뿐이다 — 규칙 자체는 정식 FSD 그대로다:',
      '- 레이어는 자기보다 아래 레이어만 import한다: app > pages > widgets > features > entities > shared.',
      '- 같은 레이어의 슬라이스끼리(pages, widgets, features, entities)는 import하지 않는다. 공유할 코드는',
      '  한 레이어 아래로 내리거나, 상대 슬라이스의 `@x/<consumer>` 공개 API로만 노출한다.',
      '- 슬라이스는 `index.ts`를 통해서만 import한다. `ui/`, `model/`, `api/` 내부 파일에 직접 닿지 않는다.',
      '- `app`과 `shared`는 슬라이스가 아니라 세그먼트를 가진다. shared 세그먼트 이름은 목적형(`ui`, `api`,',
      '  `model`, `lib`, `config`)으로 짓고, 본질형(`components`, `hooks`, `utils`, `types`)은 쓰지 않는다.',
      '슬라이스는 generator로 만든다(`nx g @clearlydev/nx-archweave:page|widget|feature|entity|shared --name=…`,',
      '추가 세그먼트는 `--segments=ui,api`).',
      '`archweave/fsd-boundaries` ESLint 규칙이 위반을 알려 준다: import를 고치되, 규칙을 끄거나 eslint-disable로',
      '넘기지 않는다. Next.js에서는 pages 레이어가 `_pages/` 폴더다.',
    ].join('\n'),
  },
  'project-goal': {
    id: 'project-goal',
    heading: '프로젝트 목표',
    body: '<!-- TODO: 이 프로젝트의 목표, 대상 사용자, 성공 기준을 작성하세요. -->',
  },
  'architecture-boundary': {
    id: 'architecture-boundary',
    heading: '아키텍처 경계',
    body: '<!-- TODO: 이 프로젝트의 모듈 경계, 소유 규칙, 어떤 모듈이 어떤 모듈에 의존할 수 있는지를 작성하세요. -->',
  },
};

export const AGENT_RULE_SECTIONS: Record<AgentRuleLocale, Record<AgentSectionId, AgentRuleSection>> = {
  en: EN_SECTIONS,
  ko: KO_SECTIONS,
};

export function getAgentRuleSection(locale: AgentRuleLocale, id: AgentSectionId): AgentRuleSection {
  return AGENT_RULE_SECTIONS[locale][id];
}
