# 제너레이터와 프리셋

[English](../generators.md) | 한국어

제너레이터 16종 전체와 각 옵션, 그리고 `init`이 구체적인 기본값으로 바꾸는 프리셋 3종을 정리했어요.

## 제너레이터

제너레이터 16종을 역할별로 묶었어요. 묶음마다 짧은 표가 먼저 나오고, 이어서 제너레이터별 섹션에 옵션을 정리했어요.

### 설정과 진단

| 제너레이터 | 역할 |
| --- | --- |
| `init` | 프리셋으로 워크스페이스 설정 |
| `doctor` | 읽기 전용 진단, 파일 쓰기 없음 |

#### `init`

프리셋 기반 파이프라인이에요. 프리셋과 스택 축에 따라 `add-fsd-lite`, `add-agent-rules`, `add-github-templates`, `add-review`, `add-backend`를 실행해요. 마지막에 best-effort 검증을 수행해요.

- `--preset`, `--frontend`, `--backend`, `--packageManager`, `--locale`
- `--aiHosts`, `--reviewProvider`
- `--fsd`, `--agentRules`, `--githubTemplates`, `--review`
- `--applyEslint`, `--allowDirty`, `--dryRun`

`init`은 대체값이 있는 옵션 5개를 이렇게 정해요.

| `init` 옵션 | 생략했을 때 |
| --- | --- |
| `--frontend` | init이 기록하기 전까지 필수(아래 참고) |
| `--backend` | 기록된 값, 없으면 none |
| `--packageManager` | lockfile, 기록된 값, pnpm 순 |
| `--locale` | 기록된 값, 없으면 `en` |
| `--reviewProvider` | 기록된 값, 없으면 첫 번째 AI 호스트의 것(아래 참고) |

- `--frontend`: `none`은 백엔드 단독이라는 뜻이고, 이때 FSD는 생략돼요.
- `--preset`과 `--frontend`는 init이 기록하기 전까지 필수예요. 그 뒤로는 생략하면 init이 기록한 값을 써요.
- `--locale` 값은 `toolkit.config.json`에 기록돼요.
- `--reviewProvider`: `--aiHosts`로 첫 번째 호스트가 바뀌면 기록된 값 대신 첫 번째 AI 호스트의 프로바이더를 써요.

#### `doctor`

읽기 전용으로 진단해요. 파일은 절대 쓰지 않아요.

- `--liveIntegrations`, `--json`

`doctor`는 아래 7개 항목을 진단해요. 여기에는 nx 버전 범위, 경계 태그 실존 여부, FSD 유사 구조, 드리프트 상태도 포함돼요.

- Nx 워크스페이스 감지
- 패키지 매니저
- 워크스페이스 루트
- Nx 버전
- 프레임워크 감지
- 리뷰 설정 정합성
- 통합 상태

### 배선

| 제너레이터 | 역할 |
| --- | --- |
| `add-fsd-lite` | 프론트엔드 앱에 FSD 경계 규칙 연결 |
| `add-agent-rules` | AI 호스트별 파일에 nx-archweave 규칙 기록 |
| `add-github-templates` | Issue Forms, PR 템플릿, CODEOWNERS 생성 |
| `add-review` | 자동 PR 리뷰 워크플로 설치 |
| `add-backend` | 워크스페이스에 백엔드 앱 배선 |

#### `add-fsd-lite`

프론트엔드 앱의 ESLint 설정에 `archweave/fsd-boundaries` 규칙을 연결하고 레이어 안내를 출력해요. 폴더는 만들지 않아요.

- `--frontend` — 생략하면 `toolkit.config.json`의 값(init이 기록)
- `--project` — 생략하면 유일한 프론트엔드 앱
- `--enforcement`, `--applyEslint`, `--steiger`, `--locale`, `--dryRun`

`--applyEslint`를 주면 `add-fsd-lite`가 ESLint 설정을 직접 써요. 주지 않으면 붙여넣기용 스니펫을 출력해요. `--steiger`는 FSD 공식 린터를 선택형 `fsd-check` 타깃으로 추가해요.

#### `add-agent-rules`

각 AI 호스트가 읽는 파일에 nx-archweave 규칙을 표시된 블록 하나로 기록해요. Claude Code는 `CLAUDE.md`, 나머지 호스트는 `AGENTS.md`예요.

- `--hosts` — 체크박스 질문. 기본값은 `toolkit.config.json`의 `aiHosts`, 없으면 Claude Code
- `--teamRules`, `--locale`, `--dryRun`

`add-agent-rules`는 파일을 새로 만들거나, 블록을 덧붙이거나, 블록만 갱신해요. 블록 주변 내용은 건드리지 않아요.

#### `add-github-templates`

GitHub Issue Forms, PR 템플릿, CODEOWNERS를 생성해요.

- `--issue`, `--pr`, `--codeowners`, `--locale`, `--dryRun`

#### `add-review`

자동 PR 리뷰 워크플로와 `toolkit.config.json`의 `review` 필드를 설치해요.

- `--provider`, `--mode`, `--maxRounds` — 생략하면 각각 이미 기록된 값, 없으면 `claude` / `standard` / `3`
- `--onConflict`, `--locale`, `--dryRun`

#### `add-backend`

백엔드 앱을 배선해요. `shared-types` lib, `scope:` 태그, 경계 제약을 추가해요.

- `--backend`(필수), `--apiName`, `--frontendProject`, `--applyEslint`, `--dryRun`

앱 생성 자체는 공식 경로를 따라요. `api` 프로젝트가 없으면 `add-backend`는 거부하고, 복사해 붙여 넣을 수 있는 `@nx` 명령을 보여줘요. 프론트엔드 없이 `api`만 있으면(백엔드 단독 워크스페이스) `api`만 배선해요.

### 슬라이스

| 제너레이터 | 역할 |
| --- | --- |
| `page` | `src/pages` 아래 page 슬라이스 생성 |
| `widget` | `src/widgets` 아래 widget 슬라이스 생성 |
| `feature` | `src/features` 아래 feature 슬라이스 생성 |
| `entity` | `src/entities` 아래 entity 슬라이스 생성 |
| `shared` | `src/shared` 아래 shared 세그먼트 생성 |

#### `page`

앱의 `src/pages` 아래에 page 슬라이스를 만들어요. Next.js에서는 `src/_pages`를 써요.

- `--name`(필수), `--publicApiName`, `--segments`, `--project`
- `--frontend`, `--locale`, `--dryRun`

#### `widget`

앱의 `src/widgets` 아래에 widget 슬라이스를 만들어요. Lite 기본 범위에서 빠진 레이어지만, 명령 하나로 추가할 수 있어요.

- `page`와 같은 옵션(`--frontend` 제외)

#### `feature`

앱의 `src/features` 아래에 feature 슬라이스(`index.ts` + `model/`)를 만들어요. 레이어 폴더가 없으면 함께 만들어요.

- `--name`(필수), `--publicApiName`, `--project`, `--locale`, `--dryRun`
- `--segments` — 추가 세그먼트(예: `ui,api`)

#### `entity`

앱의 `src/entities` 아래에 entity 슬라이스를 만들어요.

- `feature`와 같은 옵션

#### `shared`

앱의 `src/shared` 아래에 shared 세그먼트를 만들어요. 이름은 목적으로 지어요: `ui`, `api`, `model`, `lib`, `config`.

- `feature`와 같은 옵션(`--segments` 제외). 이름이 곧 세그먼트예요.

### 외부 통합

| 제너레이터 | 역할 |
| --- | --- |
| `add-integration` | 카탈로그 플러그인의 공식 설치 흐름 미리보기 |
| `install-integration` | 호스트 CLI로 카탈로그 플러그인 설치 |
| `record-integration` | 외부에서 끝낸 설치를 검증하고 기록 |

#### `add-integration`

**미리보기 전용이에요.** 카탈로그 플러그인의 공식 설치 흐름만 보여줘요. 설치도, 파일 쓰기도 하지 않아요.

- `--tool`(필수), `--target`, `--scope`, `--versionRange`, `--dryRun`

미리보기에는 출처, 라이선스, 정확한 설치 명령, 수동 대안, 제거 방법이 나와요.

#### `install-integration`

`--apply`를 주면 호스트의 공식 CLI로 카탈로그 플러그인을 설치해요. `--apply`가 없으면 미리보기만 보여줘요.

- `--tool`(필수), `--target`, `--scope`, `--versionRange`, `--apply`

`install-integration --apply`는 기본적으로 project 범위로 설치해요. 그다음 플러그인을 라이브로 재검증하고, 매니페스트 항목을 기록하고, `toolkit.config.json`에 플러그인을 선언해요.

#### `record-integration`

nx-archweave 밖에서 끝낸 설치를 검증해요. `--apply`를 주면 검증 상태를 `archweave-integrations.json`에도 기록해요.

- `--tool`(필수), `--target`, `--apply`

### pnpm 빌드

#### `allow-builds`

pnpm 전용이에요. pnpm이 건너뛰었거나 거부로 기록된 의존성 빌드 스크립트를 허용해요. `--apply`가 없으면 미리보기만 보여줘요.

- `--packages`(필수, 쉼표로 구분), `--apply`

`--apply`를 주면 `allow-builds`는 `pnpm-workspace.yaml`에서 지정한 패키지를 `true`로 바꾸고 `pnpm rebuild`까지 실행해요. 기록 위치는 `allowBuilds`, 또는 pnpm 10의 `onlyBuiltDependencies` 목록이에요.

> [!NOTE]
> **알아볼 수 없는 파일은 건드리지 않아요.** `allow-builds`가 파일 형태를 알아보지 못하면 보고만 하고 파일은 고치지 않아요.

## 프리셋

`init`은 프리셋마다 실행할 서브 제너레이터의 구체적인 기본값을 정해요.

> [!IMPORTANT]
> 직접 넘긴 플래그는 항상 프리셋 기본값보다 우선해요.

| | `quick-start` | `solo` | `team` |
| --- | --- | --- | --- |
| FSD Lite | 활성 | 활성 | 활성 |
| FSD 규칙 심각도(`fsd.enforcement`) | `warn` | `warn` | `error` |
| 에이전트 규칙 | AI 호스트의 파일 | AI 호스트의 파일 | AI 호스트의 파일 + Team Rules 섹션 |
| 팀 규칙 섹션 | — | — | 포함 |
| GitHub 템플릿 | PR만 | PR만 | Issue + PR |
| 리뷰 기본 활성 | **아니오** (옵트인) | 예 | 예 |
| 리뷰 모드 | `fast` | `fast` | `standard` |
| 최대 리뷰 라운드 | 3 | 3 | 3 |
| 충돌 정책 | `merge-proposal` | `merge-proposal` | `merge-proposal` |
| 외부 통합 | 없음 (항상 사용자 주도) | 없음 | 없음 |

> [!NOTE]
> - **`frontend`/`backend`는 표에 없어요.** 두 값은 프리셋 정책이 아니라 축이에요. 프리셋 3종 모두 스택은 직접 골라요.
> - **판정(verdict) 동작은 프리셋 3종 모두 같아요.** 설정값이 아니라 고정된 알고리즘이에요.
