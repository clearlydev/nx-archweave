# 자동 PR 리뷰

[English](../pr-review.md) | 한국어

자동 PR 리뷰는 선택 사항이에요. 특정 프로바이더에 묶이지 않고, 안전하게 실패해요. 차단할 리뷰인지 깨끗한 리뷰인지 구별할 수 없으면 `review` check가 녹색 대신 빨간색이 돼요. 사람의 코드 리뷰를 대신하지는 않아요. 모든 pull request에 사람의 승인을 계속 필수로 두세요.

이 문서는 설정 방법, 프로바이더, check가 초록·빨강이 되는 경우, 함께 쓸 저장소 설정, 문제 해결, 동작 방식 참고를 차례로 다뤄요.

## 설정하기

1. **워크플로를 생성하세요.** 먼저 미리 보세요.

   ```bash
   npx nx g @clearlydev/nx-archweave:add-review --provider=claude --dryRun
   npx nx g @clearlydev/nx-archweave:add-review --provider=claude
   ```

   create-nx-archweave는 요청할 때만 설정해요(`--review`, 또는 `quick-start`에서 "y". `team`은 켜요). `--mode`와 `--maxRounds`는 [참고](#참고)에서 다뤄요.
2. **프로바이더 시크릿을 받아서**([프로바이더](#프로바이더) 참고) 저장소의 **Settings → Secrets and variables → Actions**에 등록하세요. Dependabot이나 Codespaces 탭에 넣은 시크릿은 워크플로에 전달되지 않아요.
3. **`claude`만: 저장소에 [Claude GitHub App](https://github.com/apps/claude)을 설치하세요**(**Only select repositories**).
4. **워크플로를 기본 브랜치에 머지한 뒤에** 믿고 쓰세요. `claude`는 워크플로 파일이 기본 브랜치와 다른 pull request를 claude-code-action이 건너뛰어서, `review`가 빨간색이 돼요([문제 해결](#문제-해결) 참고).
5. **브랜치 ruleset에서 `review`를 필수 check로 지정하고**, 사람의 승인도 함께 필수로 두세요([권장 저장소 설정](#권장-저장소-설정) 참고).
6. **pull request를 여세요.** 리뷰가 요약 코멘트와, 라운드마다 고치는 짧은 verdict 코멘트를 게시해요.

시크릿을 등록하기 전까지 워크플로는 AI 리뷰가 돌지 않았다는 notice와 함께 녹색으로 끝나요. 그래서 워크플로를 추가하는 것만으로 pull request가 빨간색이 되지는 않아요.

## 프로바이더

| 프로바이더 | 워크플로 파일 | 필요한 시크릿 | 시크릿 받는 곳 |
| --- | --- | --- | --- |
| `claude` (기본) | `.github/workflows/claude-code-review.yml` | `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code OAuth 토큰, 그리고 저장소에 [Claude GitHub App](https://github.com/apps/claude) 설치 |
| `gemini` (beta) | `.github/workflows/gemini-code-review.yml` | `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com) → **Get API key** |
| `gpt` (beta) | `.github/workflows/gpt-code-review.yml` | `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `cursor` (beta) | `.github/workflows/cursor-code-review.yml` | `CURSOR_API_KEY` | [cursor.com/dashboard/api](https://cursor.com/dashboard/api). Free 요금제에서는 대시보드 메뉴에 보이지 않으니 주소로 직접 들어가세요 |

- 저장소 하나에는 프로바이더 하나만 쓰세요. 네 워크플로는 잡 이름(그래서 필수 체크 `review`가 어느 쪽에도 맞아요), 대기열, 라운드 마커를 함께 써요.
- 프로바이더 4종은 모두 같은 계약을 따르고 워크플로 골격 하나를 함께 써요. 그래서 어느 걸 골라도 아래 check는 똑같이 동작해요.
- create-nx-archweave는 질문에서 `cursor`를 보여 주지 않아요(`--review-provider=cursor`로 지정). create-nx-archweave와 `add-review` 모두 beta 프로바이더를 고르면 아래 경고를 출력해요.

## 프로바이더 상태

`claude`가 기본이에요. `gemini`, `gpt`, `cursor`는 **beta**예요. 워크플로는 GitHub Actions에서 실제로 돌았지만, 무료 등급이나 API 잔액 부족으로 리뷰 대부분이 중간에 멈췄어요([문제 해결](#문제-해결) 참고). 각각 유료 등급에서 전체 실행을 확인한 뒤 표시를 뗄 거예요.

> [!WARNING]
> `gemini`, `gpt`, `cursor`는 beta라 아직 처음부터 끝까지 확인되지 않았어요(아래 표 참고). 어떤 프로바이더든 AI 리뷰는 사람의 코드 리뷰를 대신하지 않아요. 모든 pull request에 사람의 승인을 필수로 두고([AI verdict 없이 커밋 머지하기](#ai-verdict-없이-커밋-머지하기) 참고), **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**는 꺼 두세요.

| 프로바이더 | 상태 | GitHub Actions 확인 결과 | 비용 |
| --- | --- | --- | --- |
| `claude` (기본) | — | 확인: 시크릿이 없으면 green-skip, Claude GitHub App 없이 토큰만 있으면 `401 … Claude Code is not installed on this repository`로 실패하고 `review`가 red, 깨끗한 pull request에서 요약·APPROVE verdict 코멘트·green `review`(처음부터 끝까지 약 1분 45초). 보안 결함 pull request가 BLOCK과 red `review`, 실패한 잡만 재실행해도 red 유지, 이후 라운드는 verdict 코멘트 하나를 수정, 요약을 남기지 않은 리뷰는 red(0.3.0). 라운드 한도 이후 커밋과 플러그인이 없는 워크스페이스의 리뷰가 필수 `review`를 red로 만들고 머지를 막음. 시크릿이 없을 때와 Dependabot pull request는 여전히 green이고 각각 안내가 남음(0.4.0). 요약은 `claude[bot]`으로 게시되고, 내용이 리뷰어에게 지시하는 pull request는 P1 `instructions-in-content` finding과 BLOCK(0.4.2) | Claude 구독. 깨끗한 리뷰 한 번에 약 $0.05 |
| `gemini` | beta | 확인: 시크릿이 없으면 green-skip, AI 리뷰가 실패하면 `review`가 red, 깨끗한 pull request에서 별도 게시 스텝이 올린 요약·APPROVE·green `review`(0.4.2). 미확인: BLOCK, 라운드, 재실행 | 한도가 있는 무료 등급. 모델이 붐비면 503으로 실패하거나, 일일 할당량에서 멈출 수 있어요 |
| `gpt` | beta | 확인: 시크릿이 없으면 green-skip, AI 리뷰 실패(API 한도) 시 `review`가 red. 미확인: 리뷰 완료 | ChatGPT 구독과 별개인 OpenAI API 크레딧. pull request에서 `@codex`를 멘션하는 건 별개의 ChatGPT 기능(Codex 커넥터)이에요. 이 워크플로를 실행하지 않고, 체크를 만들지 않으며, verdict 게이트도 거치지 않아요 |
| `cursor` | beta | 확인: 시크릿이 없으면 green-skip, AI 리뷰가 실패하면 `review`가 red. 미확인: 리뷰 완료, BLOCK, 라운드, 재실행 | Cursor 요금제의 에이전트 사용량. Free 요금제는 첫 리뷰에서 한도에 걸렸어요 |

확인한 대상: 첫 확인(2026-10-25)은 create-nx-archweave 0.2.2가 만든 워크플로(`gemini`와 `cursor`는 0.3.0의 작업 폴더 신뢰 수정을 적용)로 했어요. 액션은 `anthropics/claude-code-action@6b6870e6…`(v1.0.258, 모델 `claude-sonnet-5-5`), `actions/checkout@3d3c42e5…`(v7.0.1), `actions/setup-node@949feb24…`(v7.1.0), `google-github-actions/run-gemini-cli@f77273f4…`(v0.1.22)이고, Gemini CLI 0.65.0, cursor-agent 2026.10.22-27dcf5f였어요. 0.4.0 확인(2026-11-07)은 pack한 0.4.0 패키지로 만든 워크플로와 `anthropics/claude-code-action@c0949c50…`(v1.0.268)로 했고, AI는 부르지 않았어요. 라운드 마커가 든 봇 코멘트로 라운드 한도(`maxRounds: 1`)를 채웠고, 플러그인이 없는 경우는 AI 리뷰 스텝을 리뷰 없이 성공하는 스텝으로 바꿔서 확인했어요. 0.4.2 확인(2026-11-17)은 pack한 0.4.2 패키지로 만든 `claude`와 `gemini` 워크플로로 했어요.

## 체크가 초록·빨강이 되는 경우

`review` 잡이 필수로 지정할 check예요. 이번 실행의 요약을 판정했는데 BLOCK이 아닐 때, 또는 AI 리뷰가 밝힌 이유로 꺼졌을 때만 녹색으로 끝나요. 그 밖의 경우는 모두 빨간색이에요. 차단할 리뷰인지 깨끗한 리뷰인지 구별할 수 없기 때문이에요.

**초록**

| 상황 | 보이는 것 |
| --- | --- |
| 리뷰가 돌았고 verdict가 `APPROVE`, `APPROVE_WITH_NOTES`, `CHANGES_RECOMMENDED` | 요약, 그리고 findings가 담긴 verdict 코멘트 |
| 프로바이더 시크릿이 등록되지 않음 | notice: `AI review did not run for this commit (<reason>). A green check here does not mean the change was reviewed.` |
| 저장소 변수 `ARCHWEAVE_REVIEW_DISABLED`가 `true` | 같은 notice. 변수 이름을 적어요([리뷰 끄기](#리뷰-끄기)) |
| 포크나 Dependabot에서 온 pull request | 같은 notice. GitHub가 두 실행 모두에 프로바이더 시크릿을 넘기지 않아요 |
| 봇 계정이 pull request를 열고 모든 커밋을 작성함 | 같은 notice. 그 사유를 적어요 |

이 안내는 실행의 notice, 잡 요약 한 줄, verdict 코멘트로 남아요. 코멘트는 실행 토큰에 쓰기 권한이 있을 때만 게시돼서, 포크 pull request에는 달리지 않아요. 리뷰 없이 녹색으로 끝나는 pull request는 사람이 리뷰해야 해요. [AI verdict 없이 커밋 머지하기](#ai-verdict-없이-커밋-머지하기)를 보세요.

**빨강**

| 상황 | 할 일 |
| --- | --- |
| 발견 항목이 `P0` 또는 `P1`(verdict `BLOCK`) | 고치거나, 사람이 결정하세요(bypass) |
| AI 리뷰가 실패, 취소, skip됐거나 15분 타임아웃에 걸림 | [문제 해결](#문제-해결)을 본 뒤 모든 잡을 다시 실행하세요 |
| 이번 실행이 이 커밋에 대한 요약을 게시하지 않았거나, findings 블록을 판독할 수 없는 요약을 게시함 | 직접 리뷰하거나 모든 잡을 다시 실행하세요 |
| 이번 실행에 리뷰 계정의 요약이 둘 이상 있거나, findings 블록이 서로 다름 | 직접 리뷰하거나 모든 잡을 다시 실행하세요 |
| 커밋에 해당하는 요약을 리뷰 계정이 아닌 다른 봇 계정이 게시함 | [라운드 게이트](#라운드-게이트) 참고(`ARCHWEAVE_REVIEW_AUTHOR`) |
| 라운드 한도(`maxRounds`) 이후의 커밋 | bypass로 머지하거나, `maxRounds`를 올리고 `add-review`를 다시 실행하세요. 다시 실행해도 소용없어요 |
| 사람이 열었거나 커밋한 pull request에서 봇 계정이 실행을 시작함 | 사람이 최신 커밋에서 모든 잡을 다시 실행하세요 |
| 워크스페이스에 리뷰 워크플로는 있는데 `@clearlydev/nx-archweave`가 없음 | devDependency로 설치하거나, 리뷰를 끄려면 워크플로를 지우세요 |
| 워크플로가 이 릴리스가 읽지 않는 계약 번호를 적음 | [워크플로 버전](#워크플로-버전) 참고 |
| verdict 게이트의 환경 변수가 없거나 형식이 잘못됨(예: 워크플로를 손으로 고친 뒤) | 워크플로를 다시 생성하세요 |
| AI 리뷰 잡의 결과가 `review` 잡에 전달되지 않음(예: 다시 실행할 때) | 모든 잡을 다시 실행하세요(AI 리뷰도 다시 돌고 비용도 다시 들어요) |
| `review` 잡이 pull request 코멘트를 읽지 못함 | 실패한 잡을 다시 실행하세요. 또 실패하면 잡에 `pull-requests: read`가 있는지 확인하세요 |
| `claude`: 시크릿은 등록했는데 Claude GitHub App이 설치되지 않음 | 앱을 설치하세요([문제 해결](#문제-해결) 참고) |

> [!NOTE]
> `review` 잡의 설치 스텝은 락파일 불일치처럼 워크스페이스 자체가 깨진 경우에도 빨간색이 될 수 있어요. 이 빨간 X는 워크스페이스 결함이 드러난 것이고, verdict가 아니에요.

이전 워크플로는 다르게 동작해요. 워크플로 파일이 저장소에 있어서, 플러그인을 올려도 바뀌지 않기 때문이에요. 0.4.0 이전에 생성된 워크플로는 라운드 한도 이후와 판정 도구가 없는 워크스페이스에서도 여전히 녹색으로 끝나요(`doctor`: `review-workflow-no-verdict`). 0.2.2 이전에 생성된 워크플로는 요약이 없어도 녹색으로 끝나요(`doctor`: `review-workflow-fail-open`). 다시 생성하세요([워크플로 버전](#워크플로-버전) 참고).

## 권장 저장소 설정

- pull request에 사람의 승인을 필수로 두세요. **Require a pull request before merging → Required approvals**와 **Dismiss stale pull request approvals when new commits are pushed**를 켜요.
- 같은 ruleset에서 `review`를 필수 status check로 지정하세요.
- **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**는 꺼 두세요.
- 리뷰 워크플로와 AI 도구 설정 파일에 `CODEOWNERS`로 담당자를 두고, **Require review from Code Owners**를 켜세요. 예:

  ```
  /.github/workflows/  @your-org/maintainers
  /.claude/            @your-org/maintainers
  /.gemini/            @your-org/maintainers
  /.cursor/            @your-org/maintainers
  ```

- 이 저장소 전용 API 키를 만들고 프로바이더 쪽에 사용 한도를 걸어 두세요. 그러면 다른 것을 건드리지 않고 키를 폐기하고 비용 상한을 둘 수 있어요.
- 포크에서 온 pull request: **Settings → Actions → General → Approval for running fork pull request workflows**.

### AI verdict 없이 커밋 머지하기

AI 리뷰가 돌았는데 head 커밋에 verdict를 남기지 않았거나, 커밋이 라운드 한도 이후에 왔으면 `review`가 실패해요. nx-archweave는 자기 check를 우회하는 방법을 따로 두지 않아요. 이런 커밋은 사람이 GitHub 자체 기능으로 통과시키고, 누가 했는지는 GitHub가 기록해요.

- **Bypass(모든 저장소).** ruleset의 bypass 목록에 자신, 역할(admin, maintain, write) 또는 팀을 **For pull requests only**로 추가하세요. 그다음 **Merge without waiting for requirements to be met (bypass branch protections)**로 머지해요. `review` check는 빨간색으로 남고, 그게 사실 그대로예요. ruleset의 **Rule insights**에 bypass가 기록돼요. 기존 branch protection에서는 **Do not allow bypassing the above settings**가 꺼져 있으면 admin이 bypass할 수 있어요.
- **Required approvals(팀 저장소).** AI verdict가 있든 없든 모든 pull request에 사람의 승인이 필요해요. 승인한다고 빨간 `review`가 녹색이 되지는 않아요. AI verdict가 없는 커밋에는 여전히 bypass가 필요해요.

리뷰 없이 녹색으로 끝나는 pull request(시크릿 없음, 포크, Dependabot, 봇이 연 봇의 pull request, 리뷰를 꺼 둔 경우)는 사람의 승인으로만 지켜져요. 포크와 Dependabot 실행은 프로바이더 시크릿을 받지 못해서, 워크플로가 리뷰를 꺼 둔 저장소와 구별할 수 없어요. 포크의 경우 check는 애초에 게이트가 아니에요. 포크에서 온 pull request는 자기 쪽 워크플로로 실행돼요.

## 문제 해결

- **`claude`: `401 — Claude Code is not installed on this repository`.** `claude` 프로바이더는 시크릿을 GitHub App 토큰으로 교환해요. 그래서 시크릿은 있는데 [Claude GitHub App](https://github.com/apps/claude)이 없으면 green-skip 대신 잡이 실패해요. 저장소에 앱을 설치하세요. 나머지 프로바이더 3종에는 앱 교환 단계가 없어요.
- **`claude`: 리뷰 스텝이 리뷰 없이 성공하고("Workflow validation failed"), `review`가 요약 없이 red.** claude-code-action은 워크플로 파일이 기본 브랜치와 다른 실행을 건너뛰어요. 예를 들어 워크플로를 추가하거나 다시 생성하는 pull request가 그래요. 워크플로 변경을 먼저 머지하고(`review`가 필수면 bypass로), 다시 실행하세요.
- **`claude`: 거부된 도구 호출.** 에이전트는 [워크플로 보안](#워크플로-보안)에 적힌 도구만 쓸 수 있어요. `Show denied tool calls` 스텝이 거부된 호출을 하나씩 보여 줘요(도구 이름과 명령 앞 200자). 0.2.x에서는 거부당하고 요약을 게시하지 않은 리뷰가 녹색으로 통과했어요. 0.3.0부터는 실패해요.
- **`gemini` 무료 등급: `503 UNAVAILABLE` 또는 일일 할당량.** 모델 수요가 몰리면 Gemini CLI가 약 5분 동안 10번 재시도한 뒤 AI 리뷰가 실패하고 `review`가 빨간색이 돼요. 나중에 모든 잡을 다시 실행하거나, 유료 키를 쓰세요.
- **`cursor` Free 요금제:** 첫 리뷰가 출력 없이 8분 30초쯤 돌다가 `You've hit your usage limit`로 멈췄어요. 리뷰를 끝까지 하려면 에이전트 사용량이 더 많은 요금제가 필요해요.
- **`gpt` API 잔액 없음:** `Quota exceeded. Check your plan and billing details.` ChatGPT 구독은 API 비용을 대신하지 않아요. platform.openai.com에서 크레딧을 충전하세요.
- **시크릿을 추가했는데 워크플로가 green-skip 돼요.** **Secrets and variables**의 **Actions** 탭(Dependabot이나 Codespaces가 아니라)에 넣었는지, 이름이 [프로바이더](#프로바이더) 표와 같은지 확인하세요.
- **`doctor`가 리뷰 워크플로를 경고해요**(`review-workflow-contract`, `review-workflow-no-verdict`, `review-workflow-fail-open`). 이전 릴리스가 만든 워크플로예요. 다시 생성하세요.

  ```bash
  npx nx g @clearlydev/nx-archweave:add-review --onConflict=overwrite --dryRun
  npx nx g @clearlydev/nx-archweave:add-review --onConflict=overwrite
  ```

### 리뷰 끄기

저장소 변수 `ARCHWEAVE_REVIEW_DISABLED`를 `true`로 설정하세요(**Settings → Secrets and variables → Actions → Variables**, 또는 `gh variable set ARCHWEAVE_REVIEW_DISABLED --body true`). 다음 실행부터 AI 리뷰가 시작되지 않고, `review`는 `AI review did not run for this commit (the ARCHWEAVE_REVIEW_DISABLED repository variable is set to true)` notice와 함께 녹색으로 끝나요. 다른 것은 바뀌지 않아요. 시크릿, 워크플로 파일, 브랜치 ruleset은 그대로예요. 다시 켜려면 변수를 지우거나 `true` 말고 다른 값으로 바꾸세요. 0.4.2 이전에 생성된 워크플로는 이 변수를 읽지 않으니 다시 생성하세요([워크플로 버전](#워크플로-버전) 참고).

리뷰를 아예 없애려면 워크플로 파일과 시크릿을 지우세요.

### 워크플로 버전

생성된 워크플로는 verdict 도구와의 계약 버전을 적어 둬요(verdict 스텝의 `ARCHWEAVE_WORKFLOW_CONTRACT`). verdict 도구는 읽지 않는 번호를 만나면 추측하지 않고 check를 실패시키고, `doctor`는 다음 경우에 warning(`review-workflow-contract`)을 알려 줘요.

- 번호가 없거나 더 낮은 워크플로: 이전 릴리스가 만든 것이라, 이번 릴리스가 리뷰 워크플로에 넣은 변경이 빠져 있어요. 플러그인을 올려도 저장소의 워크플로 파일은 바뀌지 않아요. 위 명령으로 다시 생성하세요.
- 번호가 더 높은 워크플로: 그 워크플로를 만든 릴리스로 `@clearlydev/nx-archweave`를 올리세요.

## 참고

### 게이트

모든 리뷰는 게이트 3개를 거쳐요.

| 게이트 | 하는 일 | 결과 |
| --- | --- | --- |
| **시크릿 게이트** | 리뷰 스위치, 프로바이더 시크릿, PR을 연 계정·커밋 작성자·실행을 시작한 계정 확인 | 꺼져 있거나, 시크릿이 없거나, 봇이 연 봇의 PR이면 **green-skip**, 사람의 PR에서 봇이 시작한 실행이면 **check 실패** |
| **라운드 게이트** | PR의 리뷰 마커 수 세기 | `maxRounds`에 도달하면 중단, **이후 커밋은 check 실패** |
| **verdict 게이트** | findings 파싱, verdict 계산 | **BLOCK이면 check를 실패** |

#### 시크릿 게이트

- 프로바이더 시크릿이 등록되지 않으면 잡이 `AI review is not active: register the <SECRET> secret to enable it.`를 출력하고 **green-skip** 해요. 그래서 AI를 쓰지 않는 워크스페이스에는 빨간 X가 뜨지 않아요.
- AI 리뷰는 사람이 만든 변경에만 실행돼요. 시크릿 게이트가 GitHub API로 pull request를 연 계정과 커밋 작성자를 읽고, 실행을 시작한 계정(다시 실행하면 다시 실행한 사람)을 확인해요.
  - 봇 계정이 pull request를 열고 모든 커밋을 작성했으면(의존성 업데이트 봇 등), 잡이 `AI review skipped: a bot account opened this pull request and wrote all of its commits.`를 출력하고 green-skip 하며, notice에 그 사유를 적어요.
  - 사람이 열었거나 커밋한 pull request에서 봇 계정(`[bot]`으로 끝나는 로그인)이 실행을 시작했으면(예: 봇이 push함), AI 리뷰는 돌지 않고 `review`가 **실패**해요. 사람의 커밋에 verdict가 없기 때문이에요. verdict 코멘트가 사람에게 최신 커밋에서 모든 잡을 다시 실행하라고 안내하고, 그 실행이 리뷰해요.
  - GitHub 계정이 없는 작성자의 커밋은 사람의 커밋으로 봐요.
- 저장소 변수 `ARCHWEAVE_REVIEW_DISABLED`로 파일을 바꾸지 않고 리뷰를 끌 수 있어요([리뷰 끄기](#리뷰-끄기) 참고).

#### 라운드 게이트

- 워크플로가 게시하는 리뷰마다 보이지 않는 마커(`<!-- archweave-review-round -->`)가 붙어요.
- 워크플로가 PR의 마커 수를 세고, `maxRounds`에 도달하면 멈춰요. 그래서 활발한 PR에서도 리뷰가 끝없이 반복되지 않아요. `maxRounds`는 `1`–`5`를 받고 기본값은 `3`이에요.
- 프로바이더의 리뷰 계정이 쓴 코멘트의 마커만 세요. `claude`는 `claude[bot]`, `gemini`·`gpt`·`cursor`는 `github-actions[bot]`이에요. 그렇지 않으면 PR에 코멘트를 달 수 있는 누구나 마커를 `maxRounds`만큼 달아 리뷰를 꺼 버릴 수 있어요. verdict 게이트도 같은 계정의 요약만 읽어요.
- 이 계정은 워크플로 맨 위의 한 줄, `env: ARCHWEAVE_REVIEW_AUTHOR`이고, 라운드 게이트와 verdict 게이트가 함께 읽어요. 프로바이더가 다른 계정으로 게시하게 바꿨다면(예: claude-code-action의 `github_token` 입력에 자체 GitHub App 토큰을 넘김) 이 줄을 그 계정으로 바꾸세요(여럿이면 쉼표로 구분). 커밋에 해당하는 요약을 다른 봇 계정이 게시하면 `review`가 실패하고, verdict 코멘트가 두 계정을 모두 알려 줘요. 0.4.2 이전에 생성된 워크플로에는 이 줄이 없고, `claude[bot]`과 `github-actions[bot]`을 세요.
- 한도 이후의 커밋에는 AI verdict가 없어서 `review` check가 **실패**해요. verdict 코멘트와 실패한 스텝이 그 이유와 두 가지 방법을 알려 줘요. 브랜치 ruleset의 bypass로 머지하거나, `maxRounds`를 올리고 `add-review`를 다시 실행하세요. 잡을 다시 실행해도 소용없어요. 라운드 게이트가 다시 리뷰를 멈춰요.

#### verdict 게이트

1. 모델이 요약 코멘트 끝에 기계 판독용 `archweave/findings@1` JSON 블록을 덧붙여요.
2. `review` 잡이 플러그인의 `archweave-review-verdict` bin으로 이 블록을 파싱해 verdict를 계산해요. P0/P1이 하나라도 있으면 `BLOCK`이에요.
3. `review-comment` 잡은 PR마다 짧은 verdict 코멘트 하나를 유지해요. 이 코멘트를 라운드마다 고치고, 라운드별 해결/잔존 이력과 판정한 커밋을 함께 적어요. 코멘트를 게시하지 못하면 잡은 로그만 남겨요.
4. `review` 잡은 **BLOCK이면 check를 실패**시키고, [체크가 초록·빨강이 되는 경우](#체크가-초록빨강이-되는-경우)의 다른 빨간 경우에도 실패시켜요.

verdict는 같은 실행이 게시한 요약만 판정해요. 어떤 실행의 리뷰가 요약을 남기지 않으면, 그 실행은 이전 커밋의 라운드를 다시 판정하지 않아요. (0.2.2 이전에 생성된 워크플로는 요약이 여럿인 커밋을 그중 가장 엄한 것으로 판정해요.)

> [!NOTE]
> 한 PR의 리뷰 실행은 대기열에 들어가 하나씩 차례로 돌아요. 다른 실행이 대기 중일 때 push하면 새 실행이 대기 중인 실행을 대신해요. 그래서 중간 커밋은 리뷰 없이 지나갈 수 있어요.

### 워크플로 보안

- 워크플로에는 잡이 3개 있고, 각 잡은 필요한 권한만 받아요.
  - `ai-review`는 프로바이더 시크릿을 들고 AI 리뷰를 돌려요. 의존성은 설치하지 않아요. OIDC 토큰(`id-token: write`)은 `claude` 프로바이더의 잡만 요청할 수 있어요. Claude GitHub App이 이 토큰으로 로그인하기 때문이에요. `gemini`, `gpt`, `cursor`는 API 키를 써서 OIDC 토큰을 받지 않아요.
  - `review`는 required check로 지정하는 잡이에요. 읽기 전용 토큰(`contents: read`, `pull-requests: read`)만 갖고, 시크릿과 OIDC 토큰 없이 워크스페이스 의존성을 설치해 verdict bin을 실행해요. `ai-review`가 성공하고 그 결과가 `review` 잡에 전달된 경우가 아니면 실패하고, BLOCK이어도 실패해요.
  - `review-comment`는 `pull-requests: write`로 verdict 코멘트를 게시해요. checkout도 의존성 설치도 하지 않고, verdict는 스크립트에 직접 넣지 않고 환경 변수로만 받아요.
- `review` 잡은 install script를 끄고 설치해요: `npm ci --ignore-scripts`, `pnpm install --frozen-lockfile --ignore-scripts`, `yarn install --frozen-lockfile --ignore-scripts`(yarn 1), `YARN_ENABLE_SCRIPTS=false yarn install --immutable --mode=skip-build`(yarn 2 이상), `bun install --frozen-lockfile --ignore-scripts`. verdict bin은 순수 JavaScript라 빌드 단계가 필요 없어요.
- 모든 액션은 커밋 SHA로 고정되고, 버전은 뒤의 주석에 적혀요(`actions/checkout@<sha> # v7.0.1`). 버전 태그는 다른 코드를 가리키도록 옮길 수 있지만 커밋은 그럴 수 없어요. 이 워크플로는 프로바이더 시크릿을 다루기 때문에 고정해요. `add-review`는 `.github/dependabot.yml`이 없으면 `github-actions` 항목이 든 파일을 만들고, 파일은 있는데 그 항목이 없으면 추가할 내용을 보여 줘요. 그래서 고정된 버전도 직접 검토하는 PR로 계속 갱신돼요.
- 모든 checkout 단계는 `persist-credentials: false`를 써요. 저장소 토큰이 `.git/config`에 남아 이후 단계에서 읽히지 않게 하려는 거예요.
- `review` 잡은 Node 22를 `check-latest: true`로 설정해요. 그래서 러너 이미지에 옛 버전이 깔려 있어도 그 줄의 최신 패치 버전으로 돌아요. 0.4.4 전에 생성한 워크플로는 러너에 캐시된 Node 22를 써요. 반영하려면 다시 생성하세요.
- pnpm 워크스페이스: 워크플로가 러너에서 `package.json`의 `packageManager`를 읽어요. 필드가 있으면 `pnpm/action-setup`이 그 값을 쓰고, 없으면 pnpm 10을 넘겨요.
- 모든 잡은 GitHub 기본값 360분 대신 15분이 지나면 멈춰요(`timeout-minutes: 15`). 이렇게 멈춘 AI 리뷰는 실패로 처리돼서 `review`가 빨간색이 돼요.
- `claude` 에이전트는 claude-code-action의 PR 리뷰 예시와 같은 도구만 써요. inline comment, `gh pr diff`, `gh pr view`, 그리고 본문을 표준 입력으로 받는 이 pull request의 `gh pr comment`(`gh pr comment <번호> --body-file -`)뿐이고, 다른 셸 명령, `gh api`, 파일 수정은 안 돼요.
- `gemini`와 `cursor` 에이전트는 GitHub 토큰을 받지 않아요. 앞 단계가 pull request의 diff와 설명을 `.archweave-review/`(`pr.diff`, `pr.md`)에 쓰고, 체크아웃에서 CLI의 프로젝트 설정(`.gemini`와 `.env`, 또는 `.cursor`)을 지워요. 에이전트 다음 단계가 워크플로 토큰으로 에이전트의 응답을 요약 코멘트로 게시해요. 이 두 프로바이더는 inline comment를 달지 않고, 모든 지적이 요약에 들어가요.
- `gemini` 에이전트는 `read_file`과 `grep_search`만 쓸 수 있어요. `run-gemini-cli` 액션은 Gemini CLI를 YOLO 모드로 실행해서, 허용된 도구의 호출은 묻지 않고 모두 승인해요. 셸과 쓰기 도구를 막는 건 허용 도구 목록이에요. 액션은 기본값 `latest` 대신 고정된 Gemini CLI(`gemini_cli_version`)를 설치해요. Dependabot은 이 고정값을 올리지 않고, nx-archweave 새 릴리스가 올려요.
- `cursor` 프로바이더는 `curl --proto '=https' --tlsv1.2 -fsS https://cursor.com/install | bash`로 `cursor-agent`를 설치해요. Cursor는 이 설치에 고정 버전이나 체크섬을 제공하지 않아요([보안 범위](#보안-범위) 참고).
- `Show denied tool calls` 스텝은 거부된 호출마다 도구 이름과 명령 앞 200자를 JSON 한 줄로 출력하고, 그 구간에서는 워크플로 명령을 꺼 둬요. 실행이 오류로 끝나면(만료된 토큰, 사용 한도) 액션 로그에 없는 오류 문구 앞 300자도 출력해요. 도구가 돌려준 내용은 출력하지 않고, 아무것도 업로드하지 않아요. 액션의 `show_full_output`과 `display_report`는 도구 출력을 로그에 공개하므로 꺼 둬요.
- 모든 프롬프트는 pull request의 제목, 설명, 커밋 메시지, 코드, 주석, 파일이 리뷰할 자료이지 리뷰어에게 주는 지시가 아니라고 적어요([판정 정책](#판정-정책) 참고).

### 보안 범위

이 보호 장치들은 pull request의 코드가 닿을 수 있는 범위를 줄여요. 워크플로를 바꿀 수 있는 사람으로부터 워크플로를 지켜 주지는 않아요. GitHub는 포크에서 온 pull request의 워크플로 실행에 시크릿을 넘기지 않고 읽기 전용 토큰만 줘요. 그래서 포크의 pull request는 리뷰되지 않고, 시크릿 게이트가 green-skip 해요. 게다가 포크의 `review` check는 애초에 게이트가 아니에요. 포크에서 온 pull request는 작성자가 고칠 수 있는 자기 쪽 워크플로로 실행되기 때문이에요. 이런 pull request는 **Required approvals**와 포크 pull request 워크플로 실행 승인 설정으로 지키세요. 저장소에 push 권한이 있는 사람은 브랜치에서 워크플로 파일을 고쳐 프로바이더 시크릿으로 원하는 것을 실행할 수 있어요. 그러니 쓰기 권한은 그 시크릿을 맡겨도 되는 사람에게만 주세요.

`cursor` 프로바이더는 고정의 예외예요. 실행할 때마다 그 시점에 Cursor가 배포한 버전이 설치돼요. 설치 단계 자체에는 시크릿이 없지만, 설치된 바이너리는 다음 단계에서 `CURSOR_API_KEY`를 받아 실행돼요. 다운로드가 변조되면 이 키가 넘어가요. 이 위험을 감수할 수 없는 저장소라면 다른 프로바이더를 고르세요.

`gemini`와 `cursor` CLI는 신뢰하라고 지정하지 않은 폴더에서는 실행을 거부해요. 그래서 리뷰 단계가 체크아웃한 폴더를 신뢰하도록 설정해요(`GEMINI_CLI_TRUST_WORKSPACE: 'true'`, `agent --trust`). 신뢰하면 CLI가 체크아웃한 pull request의 프로젝트 설정을 읽을 수 있어서, 에이전트 앞 단계가 그 설정을 지워요([워크플로 보안](#워크플로-보안) 참고). 시크릿은 저장소 자체에서 온 pull request만 받고, 그 작성자는 이미 워크플로를 고칠 수 있어요.

### 리뷰 모드

| 모드 | 프롬프트 구성 | 우선순위 |
| --- | --- | --- |
| `fast` | 간결한 통합 프롬프트 1개 | P0–P2 (Nit 제외) |
| `standard` | Correctness / Security 섹션 명시 | P0–P2 + Nit |
| `thorough` | standard + 과잉 설계 점검 | standard + P3 |

- **`fast`**는 치명적인 문제에만 집중하고 사소한 지적은 생략해요.
- **`standard`**는 Correctness와 Security를 최상위 섹션으로 명시해 나눠요.
- **`thorough`**는 standard 프롬프트에 과잉 설계 점검을 같은 1회 호출 안에서 덧붙여요. P3는 별도 섹션으로 게시돼요.

모드 3개 모두 프로바이더 호출 1회로 실행돼요. 과잉 설계 점검을 별도 호출로 나누면 두 번째 코멘트가 라운드 마커와 findings 블록 밖에 생기고, verdict 파이프라인이 P3를 끝내 보지 못해요. 모드 3개는 실제로 서로 다른 워크플로를 만들어요.

### 판정 정책

리뷰 프롬프트는 프로바이더에게 발견 항목의 우선순위를 `P0`, `P1`, `P2`, `P3`, `Nit`으로 매기라고 지시해요. 내장 리뷰 정책이 이 우선순위를 판정으로 바꿔요. 프리셋별로 설정하는 게 아니라 고정된 알고리즘이에요.

| 발견 항목 | 판정 |
| --- | --- |
| `P0` 또는 `P1` 존재 | `BLOCK` |
| `P2` 존재 | `CHANGES_RECOMMENDED` |
| `P3` / `Nit`만 존재 | `APPROVE_WITH_NOTES` |
| 없음 | `APPROVE` |

모든 프롬프트는 pull request의 제목, 설명, 커밋 메시지, 코드, 주석, 파일이 리뷰할 자료이지 리뷰어에게 주는 지시가 아니라고 적어요. 그 안에 무엇을 보고할지, 어떤 verdict를 낼지, 무엇을 빼라고 리뷰어에게 말하는 글이 있으면 카테고리 `instructions-in-content`의 `P1` finding으로 보고돼서, 사람이 볼 때까지 머지를 막아요.
