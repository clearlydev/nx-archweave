# 자동 PR 리뷰

[English](../pr-review.md) | 한국어

자동 PR 리뷰는 완전히 선택 사항이에요. 특정 프로바이더에 묶이지 않고, 문제가 생겨도 안전하게 실패하도록 설계했어요. 이 문서는 프로바이더, 모든 리뷰가 거치는 게이트 3개, 리뷰 모드, 발견 항목이 판정으로 바뀌는 방식을 다뤄요.

## 프로바이더

| 프로바이더 | 워크플로 파일 | 필요한 시크릿 |
| --- | --- | --- |
| `claude` (기본) | `.github/workflows/claude-code-review.yml` | `CLAUDE_CODE_OAUTH_TOKEN` |
| `gemini` | `.github/workflows/gemini-code-review.yml` | `GEMINI_API_KEY` |
| `gpt` | `.github/workflows/gpt-code-review.yml` | `OPENAI_API_KEY` |
| `cursor` | `.github/workflows/cursor-code-review.yml` | `CURSOR_API_KEY` |

프로바이더 4종은 모두 같은 계약(`id`, `workflowFileName`, `requiredSecretName`, `buildWorkflowYaml`)을 따르고 워크플로 골격 하나를 함께 써요. 그래서 어느 걸 골라도 아래 게이트는 똑같이 동작해요.

## 게이트

| 게이트 | 하는 일 | 결과 |
| --- | --- | --- |
| **시크릿 게이트** | 프로바이더 시크릿 등록 여부 확인 | 없으면 **green-skip** |
| **라운드 게이트** | PR의 리뷰 마커 수 세기 | `maxRounds`에 도달하면 중단 |
| **verdict 게이트** | findings 파싱, verdict 계산 | **BLOCK이면 check를 실패** |

### 시크릿 게이트

- 프로바이더 시크릿이 없으면 잡이 `AI review is not active: register the <SECRET> secret to enable it.`를 출력하고 **green-skip** 해요.
- 그래서 AI를 쓰지 않는 워크스페이스에는 빨간 X가 뜨지 않아요.

> [!WARNING]
> **claude 전용 엣지케이스.** `claude` 프로바이더는 시크릿을 GitHub App 토큰으로 교환해요. 그래서 시크릿은 있는데 [Claude GitHub App](https://github.com/apps/claude)이 리포에 설치되어 있지 않으면, green-skip 대신 `401 — Claude Code is not installed on this repository`로 실패해요. 리포에 앱을 설치하면 해결돼요. 나머지 프로바이더 3종에는 앱 교환 단계가 없어요.

### 라운드 게이트

- 워크플로가 게시하는 리뷰마다 보이지 않는 마커(`<!-- archweave-review-round -->`)가 붙어요.
- 워크플로가 PR의 마커 수를 세고, `maxRounds`에 도달하면 멈춰요. 그래서 활발한 PR에서도 리뷰가 끝없이 반복되지 않아요.
- 봇 계정이 쓴 코멘트의 마커만 세요. 그렇지 않으면 PR에 코멘트를 달 수 있는 누구나 마커를 `maxRounds`만큼 달아 리뷰를 꺼 버릴 수 있어요.
- `maxRounds`는 `1`–`5`를 받고 기본값은 `3`이에요.

### 워크플로 보안

- 워크플로에는 잡이 3개 있고, 각 잡은 필요한 권한만 받아요.
  - `ai-review`는 프로바이더 시크릿을 들고 AI 리뷰를 돌려요. 의존성은 설치하지 않아요. OIDC 토큰(`id-token: write`)은 `claude` 프로바이더의 잡만 요청할 수 있어요. Claude GitHub App이 이 토큰으로 로그인하기 때문이에요. `gemini`, `gpt`, `cursor`는 API 키를 써서 OIDC 토큰을 받지 않아요.
  - `review`는 required check로 지정하는 잡이에요. 읽기 전용 토큰(`contents: read`, `pull-requests: read`)만 갖고, 시크릿과 OIDC 토큰 없이 워크스페이스 의존성을 설치해 verdict bin을 실행해요. `ai-review`가 성공하고 그 결과가 `review` 잡에 전달된 경우가 아니면 실패하고, BLOCK이어도 실패해요.
  - `review-comment`는 `pull-requests: write`로 verdict 코멘트를 게시해요. checkout도 의존성 설치도 하지 않고, verdict는 스크립트에 직접 넣지 않고 환경 변수로만 받아요.
- `review` 잡은 install script를 끄고 설치해요: `npm ci --ignore-scripts`, `pnpm install --frozen-lockfile --ignore-scripts`, `yarn install --frozen-lockfile --ignore-scripts`(yarn 1), `YARN_ENABLE_SCRIPTS=false yarn install --immutable --mode=skip-build`(yarn 2 이상), `bun install --frozen-lockfile --ignore-scripts`. verdict bin은 순수 JavaScript라 빌드 단계가 필요 없어요.
- 모든 액션은 커밋 SHA로 고정되고, 버전은 뒤의 주석에 적혀요(`actions/checkout@<sha> # v7.0.1`). 버전 태그는 다른 코드를 가리키도록 옮길 수 있지만 커밋은 그럴 수 없어요. 이 워크플로는 프로바이더 시크릿을 다루기 때문에 고정해요. `add-review`는 `.github/dependabot.yml`이 없으면 `github-actions` 항목이 든 파일을 만들고, 파일은 있는데 그 항목이 없으면 추가할 내용을 보여 줘요. 그래서 고정된 버전도 직접 검토하는 PR로 계속 갱신돼요.
- 모든 checkout 단계는 `persist-credentials: false`를 써요. 저장소 토큰이 `.git/config`에 남아 이후 단계(AI 에이전트의 셸 포함)에서 읽히지 않게 하려는 거예요.
- pnpm 워크스페이스: 워크플로가 러너에서 `package.json`의 `packageManager`를 읽어요. 필드가 있으면 `pnpm/action-setup`이 그 값을 쓰고, 없으면 pnpm 10을 넘겨요.
- `cursor` 프로바이더는 `curl --proto '=https' --tlsv1.2 -fsS https://cursor.com/install | bash`로 `cursor-agent`를 설치해요. Cursor는 이 설치에 고정 버전이나 체크섬을 제공하지 않아요. 그래서 남는 위험은 [보안 범위](#보안-범위)에 적었어요.

### 보안 범위

이 보호 장치들은 pull request의 코드가 닿을 수 있는 범위를 줄여요. 워크플로를 바꿀 수 있는 사람으로부터 워크플로를 지켜 주지는 않아요. GitHub는 포크에서 온 pull request의 워크플로 실행에 시크릿을 넘기지 않고 읽기 전용 토큰만 줘요. 그래서 포크의 pull request는 리뷰되지 않고, 시크릿 게이트가 green-skip 해요. 저장소에 push 권한이 있는 사람은 브랜치에서 워크플로 파일을 고쳐 프로바이더 시크릿으로 원하는 것을 실행할 수 있어요. 그러니 쓰기 권한은 그 시크릿을 맡겨도 되는 사람에게만 주세요.

`cursor` 프로바이더는 고정의 예외예요. 실행할 때마다 그 시점에 Cursor가 배포한 버전이 설치돼요. 설치 단계 자체에는 시크릿이 없지만, 설치된 바이너리는 다음 단계에서 `CURSOR_API_KEY`와 pull request 코멘트를 쓸 수 있는 `GH_TOKEN`을 받아 실행돼요. 다운로드가 변조되면 둘 다 넘어가요. 이 위험을 감수할 수 없는 저장소라면 다른 프로바이더를 고르세요.

### verdict 게이트

1. 모델이 요약 코멘트 끝에 기계 판독용 `archweave/findings@1` JSON 블록을 덧붙여요.
2. `review` 잡이 플러그인의 `archweave-review-verdict` bin으로 이 JSON 블록을 파싱해 verdict를 계산해요. P0/P1이 하나라도 있으면 `BLOCK`이에요.
3. `review-comment` 잡은 PR마다 짧은 verdict 코멘트 하나를 유지해요. 이 코멘트를 라운드마다 고치고, 라운드별 해결/잔존 이력과 판정한 커밋을 함께 적어요.
4. `review` 잡은 **BLOCK이면 check를 실패**시켜요. 그래서 `review`를 required check로 지정하면 P0/P1이 실제로 머지를 막아요. AI 리뷰가 성공하지 않아도 실패하고, 시크릿 게이트나 라운드 게이트가 리뷰를 끈 경우에는 녹색으로 끝나요.

verdict는 같은 실행이 게시한 요약만 판정해요. 어떤 실행의 리뷰가 요약을 남기지 않으면, 그 실행은 이전 커밋의 라운드를 다시 판정하지 않아요.

> [!NOTE]
> 한 PR의 리뷰 실행은 대기열에 들어가 하나씩 차례로 돌아요. 다른 실행이 대기 중일 때 push하면 새 실행이 대기 중인 실행을 대신해요. 그래서 중간 커밋은 리뷰 없이 지나갈 수 있어요.

그 밖의 문제는 모두 녹색으로 끝나요.

| 상황 | 결과 |
| --- | --- |
| 판독 불가 findings 블록 | "사람이 직접 리뷰" 고지 |
| 요약 없는 실행 | "사람이 직접 리뷰" 고지 |
| 플러그인이 제거된 레포 | 스텝 skip |
| verdict 코멘트 게시 실패 | 로그만 |

`review` check는 파싱된 차단 finding 말고도 세 가지 경우에 빨간색이 돼요. 모두 BLOCK인지 아닌지 알 수 없는 경우라서, BLOCK을 녹색으로 통과시키지 않으려고 실패로 끝나요.

- AI 리뷰가 성공하지 않은 경우(실패, 취소, skip).
- AI 리뷰 잡의 결과가 `review` 잡에 전달되지 않은 경우(예: 다시 실행할 때). 모든 잡을 다시 실행하세요(AI 리뷰도 다시 돌고 비용도 다시 들어요).
- `review` 잡이 pull request 코멘트를 읽지 못한 경우. 실패한 잡을 다시 실행하세요. 또 실패하면 `review` 잡에 `pull-requests: read`가 있는지 확인하세요.

> [!NOTE]
> `review` 잡의 설치 스텝은 락파일 불일치처럼 워크스페이스 자체가 깨진 경우 빨간색이 될 수 있어요. 이 빨간 X는 워크스페이스 결함이 드러난 것이고, verdict가 아니에요.

## 모드와 발견 항목

### 리뷰 모드

| 모드 | 프롬프트 구성 | 우선순위 |
| --- | --- | --- |
| `fast` | 간결한 통합 프롬프트 1개 | P0–P2 (Nit 제외) |
| `standard` | Correctness / Security 섹션 명시 | P0–P2 + Nit |
| `thorough` | standard + 과잉 설계 점검 | standard + P3 |

모드별 프롬프트:

- **`fast`** — 치명적인 문제에만 집중, 사소한 지적 생략.
- **`standard`** — Correctness와 Security를 최상위 섹션으로 명시 분리.
- **`thorough`** — standard 프롬프트에 과잉 설계 점검을 같은 1회 호출 안에서 덧붙임. P3는 별도 섹션으로 게시.

모드 실행 방식:

- 모드 3개 모두 프로바이더 호출 1회로 실행돼요. 과잉 설계 점검을 별도 호출로 나누면 두 번째 코멘트가 라운드 마커와 findings 블록 밖에 생겨요. 그러면 verdict 파이프라인이 P3를 끝내 보지 못해요.
- 모드 3개는 실제로 서로 다른 워크플로를 만들어요.

### 판정 정책

리뷰 프롬프트는 프로바이더에게 발견 항목의 우선순위를 `P0`, `P1`, `P2`, `P3`, `Nit`으로 매기라고 지시해요. 내장 리뷰 정책이 이 우선순위를 판정으로 바꿔요. 프리셋별로 설정하는 게 아니라 고정된 알고리즘이에요.

| 발견 항목 | 판정 |
| --- | --- |
| `P0` 또는 `P1` 존재 | `BLOCK` |
| `P2` 존재 | `CHANGES_RECOMMENDED` |
| `P3` / `Nit`만 존재 | `APPROVE_WITH_NOTES` |
| 없음 | `APPROVE` |
