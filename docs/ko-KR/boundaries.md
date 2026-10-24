# 강제되는 경계 (풀스택)

[English](../boundaries.md) | 한국어

백엔드를 고르면 워크스페이스가 아래 모양으로 나와요. 화살표는 단순한 문서가 아니라 **린트 에러**로 강제돼요.

```
apps/
  <web>  (React/Next, 내부는 FSD Lite)  ──┐
                                          ├──▶  libs/shared-types (scope:shared)
  api    (Express/Nest, 공식 기본 모습)  ──┘
```

## 규칙

규칙은 **금지목록** 방식이에요.

| 태그 | 규칙 |
| --- | --- |
| `scope:frontend` | `scope:backend`에 의존할 수 없음 |
| `scope:backend` | `scope:frontend`에 의존할 수 없음(그 역도 금지) |
| `scope:shared` | 어느 쪽에도 기울지 않음 |

- **기존 그래프는 그대로 동작해요.** Nx가 만드는 allow-all 기준선 **위에 규칙 3개가 합성(AND)으로 얹혀요.** 그래서 풀스택 템플릿이 직접 태그한 라이브러리를 포함해 기존 프로젝트 그래프는 그대로 두고, 교차 import만 린트 에러가 돼요.
- **앱 2개는 자동으로 태그돼요.** 백엔드 전용 라이브러리에 `scope:backend`, 프론트엔드 전용 라이브러리에 `scope:frontend`만 달면 같은 규칙이 그 라이브러리에도 적용돼요.
- **`doctor`가 계속 감시해요.** 설정이 아직 맨 allow-all 기본 상태면 `boundary-constraints-applied` 체크가 "경계가 강제되지 않음"으로 보고해요.

> [!NOTE]
> **ESLint 설정을 함부로 고치지 않아요.** nx-archweave가 ESLint 설정에서 인식하지 못한 부분은 1바이트도 건드리지 않아요. 대신 복붙용 스니펫으로 알려줘요.

## 기존 워크스페이스

- `add-backend`는 프론트엔드 앱과 `api` 앱을 선언된 `projectType`으로 찾아요. 선언이 없으면 Nx가 스스로 추론한 타입으로 찾아요.
- 그래서 앱이 순수 `package.json` 프로젝트인 classic `react-monorepo` 프리셋 워크스페이스에서도 동작해요.
- `api` 앱이 없으면 `add-backend`는 거부하고, 프론트엔드 옆(`apps/api`)에 `api` 앱을 만드는 공식 명령을 출력해요.
- **기존 태그 체계 사용.** 워크스페이스에 이미 태그 체계가 있으면 `toolkit.config.json`에 역할별 태그 이름을 적어 주세요. `add-backend`가 그 이름으로 앱에 태그를 달고 deny 규칙을 쓰고, `doctor`도 그 이름으로 검사해요. 이미 있는 태그는 두 번 달지 않고, 기존 태그는 지우지 않아요.
- **shared-types 위치 지정, 또는 사용 안 함.** `sharedTypes`로 라이브러리 위치와 import 경로를 바꾸거나 끌 수 있어요.

```jsonc
{
  "boundaries": { "tags": { "frontend": "type:web", "backend": "type:api", "shared": "type:shared" } },
  "sharedTypes": { "path": "packages/types", "importPath": "@acme/types" }  // 또는 false
}
```

> [!NOTE]
> **Express 4.** `@nx/react`가 Express 4를 기대하는 워크스페이스에서 Express를 고르면, 출력되는 명령이 먼저 그 범위로 `express`를 선언해요. 그래야 npm이 생성된 앱을 거부하지 않아요.
