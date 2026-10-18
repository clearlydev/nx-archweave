# 선택형 플러그인 (AI 호스트별)

[English](../plugins.md) | 한국어

nx-archweave는 카탈로그의 플러그인을 AI 호스트에 **설치하고, 검증하고, 기록**해요. 호스트의 공식 설치 수단만 쓰고, 사용자가 명시적으로 요청할 때만 동작해요.

> [!NOTE]
> **선택 기능이고 실험적이에요.** 플러그인은 지금 쓰는 AI 코딩 도구(*호스트*)의 기능을 넓혀요. 워크스페이스 세팅의 일부가 아니고, 요청하지 않으면 이 문서의 어떤 것도 실행되지 않아요.

- **카탈로그**(데이터, `@nx-archweave/integrations` 안) — 플러그인의 출처인, 검토를 거친 목록
- **어댑터**(코드) — 호스트가 플러그인을 설치·검증하는 방법. 현재 어댑터가 있는 호스트는 Claude Code뿐

> [!TIP]
> **외부 도구를 쓰지 않나요?** 이 문서는 건너뛰어도 돼요. 직접 호출하지 않으면 아무것도 실행되지 않고, 어떤 프리셋도 사용자 대신 통합을 켜지 않아요.

`create-nx-archweave`의 마지막 질문은 고른 AI 호스트의 카탈로그 플러그인을 제안해요(엔터는 건너뛰기). 거기서 고른 플러그인마다 아래와 같은 `install-integration --apply`를 `project` 범위로 실행해요.

## 세 가지 규칙

이 기능 전체를 정하는 규칙 3개예요. 이 기능이 있는 이유이기도 해요.

### 공식 설치 경로만

nx-archweave는 호스트가 직접 문서화한 CLI 명령만 실행해요. 실행 파일과 인자를 따로 넘기기 때문에 셸을 거치지 않아요:

| 단계 | 명령 (Claude Code) |
| --- | --- |
| 1. 마켓플레이스 선언(`project` 범위만) | `claude plugin marketplace add <소스> --scope project` |
| 2. 플러그인 설치 | `claude plugin install <플러그인> --marketplace <소스>` |

nx-archweave가 하지 않는 일:

- 플러그인 사본 벤더링
- `enable`/`disable` 명령 실행
- 서드파티 도구 설정 직접 수정(Claude Code 파일은 Claude Code 자신의 명령이 씀)
- 마켓플레이스가 선언한 명령의 실행 확인 대행(사람이 판단할 몫)

### 기록된 상태는 증명되어야 해요

- 도구가 실제로 설치되어 있고 **활성 상태**인지 라이브 권위 신호로 확인한 뒤에만 매니페스트에 기록해요.
- 설치 직후에도 그 확인을 처음부터 다시 해요.
- 일어나지 않은 검증을 매니페스트에 적게 만드는 방법은 없어요.

### 기본은 미리보기

- 이 문서의 제너레이터는 `--apply`를 주지 않으면 미리보기만 해요. 이 플래그가 곧 승인이에요. Nx 자체의 `--dry-run`이 있으면 `--apply`보다 우선해요.
- nx-archweave가 직접 쓰는 건 최대 2개예요. 매니페스트 항목 1개, 그리고 워크스페이스에 `toolkit.config.json`이 있으면 그 파일 안의 `integrations.enabled` 선언 1개예요.
- 플러그인 기록은 Claude Code가 직접 해요. 어느 파일에 기록할지는 범위에 따라 다르고, 미리보기가 실행 전에 그 파일을 알려 줘요:

| 범위 | Claude Code가 플러그인을 기록하는 곳 |
| --- | --- |
| `--scope=project` (기본값) | 워크스페이스의 `.claude/settings.json` |
| `--scope=local` | 개인용 `.claude/settings.local.json` |
| `--scope=user` | 이 사용자의 모든 프로젝트 |

**그 파일을 커밋하면 어떤 플러그인을 골랐는지는 공유되지만, 플러그인 출처는 공유되지 않아요.** Claude Code는 마켓플레이스를 추가한 사용자 자신의 설정에만 선언하거든요. 그래서 project 범위에서는:

- `install-integration`이 먼저 Claude Code 자신의 명령 `claude plugin marketplace add <소스> --scope project`를 실행해요.
- 같은 파일에 플러그인 출처(`extraKnownMarketplaces`)도 선언돼요. 그 파일을 커밋하면 팀원이 플러그인 선택과 출처를 함께 받아요.
- `install-integration`을 다시 실행해도 결과는 같아요. 이전에 project 범위로 설치한 플러그인의 출처도 채워 넣어요.
- `user` / `local` 범위는 개인용이라 추가로 아무것도 실행하지 않아요.

## 카탈로그

| 플러그인 | 호스트 | 내용 |
| --- | --- | --- |
| [ponytail](https://github.com/DietrichGebert/ponytail) | `claude-code` | 과설계 리뷰 규칙과 스킬 |

`ponytail`의 설치·검증:

- **공식 설치 경로:** `claude plugin install ponytail --marketplace DietrichGebert/ponytail`. Claude Code 2.1.285 이상 필요. 채팅 슬래시 명령 2개는 수동 대안으로 남음.
- **검증 신호:** `claude plugin list --json`에 `ponytail@ponytail` 플러그인 id가 정확히 있고 **활성** 상태.

> [!NOTE]
> **범위를 솔직히 말하면:** 호스트 어댑터 1종(Claude Code)과 검토를 거친 작은 카탈로그예요. 범용 플러그인 마켓플레이스가 아니라 일부러 좁게 만든 정책 우선 메커니즘이에요. 카탈로그에는 검토를 거친 항목이 하나씩 추가돼요. 다른 호스트는 설치·검증 경로가 정해진 뒤에 어댑터가 생겨요. [플러그인 추가하기](#플러그인-추가하기)를 참고하세요.

## 흐름

`--tool`은 카탈로그 id(여기서는 ponytail)를 받아요. 1단계는 설치도 쓰기도 하지 않아요. 2단계는 공식 CLI 명령을 실행하고, 다시 검증하고, 기록하고, 선언해요.

```bash
# 1. 공식 설치 절차가 정확히 무엇인지 확인
pnpm nx g @clearlydev/nx-archweave:add-integration --tool=ponytail

# 2. 설치
pnpm nx g @clearlydev/nx-archweave:install-integration \
  --tool=ponytail --apply

# 2'. 직접 설치했다면(채팅 슬래시 명령, 다른 기기 등)
#     그 설치를 검증하고 기록만
pnpm nx g @clearlydev/nx-archweave:record-integration \
  --tool=ponytail --apply
```

### 1단계 — `add-integration`

`add-integration`은 다음을 그대로 출력해요:

- 출처와 라이선스
- 정확한 설치 명령
- 채팅용 수동 대안
- 제거 방법

도구의 현재 감지 상태도 함께 보여 줘요. 그래서 "아직 미설치"와 "이미 설치됨"을 구분할 수 있어요.

> [!NOTE]
> **네트워크에 접속하지 않아요.** `--versionRange`를 주지 않으면, 미리보기에는 마켓플레이스가 버전을 정한다고 표시돼요. 마켓플레이스가 자체 최신 버전을 설치하기 때문이에요. 다만 나머지 제너레이터 2개와 같은 로컬 읽기 전용 `claude plugin list --json` 검사는 실행해요.

### 2단계 — `install-integration`

`install-integration`은 먼저 현재 상태를 라이브로 확인해요:

| 현재 상태 | 동작 |
| --- | --- |
| 이미 설치되어 활성 | 재설치 없이 기록만 |
| 설치되어 있지만 비활성 | 직접 실행할 enable 명령 안내 |
| 명시한 `--scope`와 다른 범위에 이미 설치됨 | 중복 설치 대신 그 사실을 보고 |
| 그 밖의 경우, `--apply`가 있으면 | 설치 후 재검증(아래 참고) |

마지막 경우에 `install-integration`이 하는 일:

- 워크스페이스 루트에서 공식 명령 1개 실행(`--scope` 기본값은 `project`)
- 처음부터 다시 검증
- 그 새 검증이 확인한 것만 기록·선언

`claude` CLI가 없거나, 스크립트로 플러그인을 설치하지 못하는 구버전이면 `install-integration`이 그렇다고 알려 줘요. 그리고 터미널에서 실행할 명령을 안내해요:

```bash
npm install -g @anthropic-ai/claude-code
# 또는
claude update
```

채팅 슬래시 명령은 그 뒤에야 대안으로 안내해요. 실패한 설치를 성공으로 보고하는 일은 없어요.

### 2'단계 — `record-integration`

`record-integration`은 nx-archweave 밖에서 이뤄진 설치에 써요.

- `archweave-integrations.json`에 항목을 딱 1개 기록해요. 권위 있는 CLI 신호가 성공했을 때만 기록해요.
- `toolkit.config.json`은 건드리지 않아요. 외부 설치를 받아들였다고 해서 선언까지 원하는지는 알 수 없거든요.
- `package.json` 기반의 약한 신호는 근거로 함께 보고될 수 있어요. 하지만 그 신호만으로는 절대 충분하지 않아요.
- 먼저 `--apply` 없이 실행해서 무엇을 왜 기록할지 확인하세요.

> [!IMPORTANT]
> **거짓 통과는 없어요.** 플러그인이 비활성이거나, 매칭이 모호하거나, `claude` 바이너리가 없거나, CLI 오류가 나면 거짓 `verification: passed` 대신 **쓰기 0**으로 끝나요.

## `doctor`가 보고하는 것

`doctor`는 알려진 통합마다 한 줄씩 출력해요. 각 줄은 서로 독립적인 사실 3가지를 담아요:

| 사실 | 위치 |
| --- | --- |
| **선언** | `toolkit.config.json` |
| **기록** | `archweave-integrations.json` |
| **감지** | 워크스페이스 |

이 3가지 사실이 서로 어긋날 때가 눈여겨볼 신호예요. 선언은 됐는데 기록이 없다면, 그 도구의 설치를 끝내지 않았거나 검증하지 않은 거예요.

| 모드 | 동작 |
| --- | --- |
| 기본값 | 기록된 매니페스트 신뢰 |
| `--liveIntegrations` | 라이브로 재검증 |

- 기본값은 빨라요. 해당 외부 도구의 CLI가 아예 없는 기기에서도 동작해요.
- `--liveIntegrations`를 쓰면 오래된 "passed" 기록이 나중에 비활성화·제거된 플러그인을 감추지 못해요.

어느 모드든 `doctor`는 아무것도 쓰지 않아요.

## 플러그인 추가하기

카탈로그는 내부 패키지 `@nx-archweave/integrations`(`src/catalog/plugin-catalog.ts`)에 있어요. 그래서 새 플러그인을 추가하려면 로컬 설정이 아니라 이 리포지토리를 바꿔야 해요.

### 이미 어댑터가 있는 호스트(Claude Code)

플러그인은 **카탈로그 항목 하나**이고, 다음을 담아요:

- id, 설명, 홈페이지, 저장소, 라이선스
- 공식 설치 문서와 제거 절차
- 그 호스트용 배포 정보(Claude Code는 플러그인 이름, 마켓플레이스 소스, `claude plugin list`가 보고하는 `<이름>@<마켓플레이스>` id)

제너레이터의 `--tool` enum은 테스트가 카탈로그와 같게 유지해요.

### 새 호스트

새 호스트에는 먼저 어댑터가 필요해요. 그 어댑터에는 다음 3가지가 모두 있어야 해요:

- **공식적이고 문서화된 설치 경로**(비공식 스크립트만 있으면 정책상 범위 밖)
- *설치됨+활성*, *설치됨+비활성*, *없음*을 구분하는 읽기 전용 **권위 있는 검증 신호**
- **실패 모드 테스트**: 비활성·모호한 매칭·CLI 없음·CLI 오류 각각이 쓰기가 아니라 "미검증"으로 끝나는지 확인

원하는 플러그인이 이 조건을 만족하지 못해도 이슈를 열어 주세요. 그 공백 자체가 유용한 정보예요. 검증할 수 없는 것을 검증한 척하는 제너레이터보다 훨씬 나은 결과이기도 해요.
