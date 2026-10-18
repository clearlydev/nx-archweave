# 리포지토리 구조

[English](../architecture.md) | 한국어

nx-archweave는 프로젝트 7개로 이루어진 Nx 모노레포예요. 내부(비공개) 패키지가 5개, 배포 대상 패키지가 2개예요.

## 프로젝트

| 프로젝트 | 패키지 | 역할 | 런타임 의존 |
| --- | --- | --- | --- |
| `shared` | `@nx-archweave/shared` | 타입·상수, 의존 트리의 리프 | `tslib` |
| `templates` | `@nx-archweave/templates` | 끼워 넣거나 조립하는 콘텐츠(아래 참고) | `tslib` |
| `review-policy` | `@nx-archweave/review-policy` | 리뷰 스키마, 모드, 프롬프트, 코멘트 렌더러 | `tslib` |
| `integrations` | `@nx-archweave/integrations` | 통합 레지스트리와 검증 | `shared`, `tslib` |
| `template-engine` | `@nx-archweave/template-engine` | 조립 계층(아래 참고) | `shared`, `templates`, `review-policy`, `tslib` |
| `nx-plugin` | **`@clearlydev/nx-archweave`** | 제너레이터 16종과 ESLint 규칙(아래 참고) | `@nx/devkit` |
| `create-nx-archweave` | **`create-nx-archweave`** | `npx` CLI | — |

- **`templates`**: 기존 파일에 끼워 넣거나 옵션별로 조립하는 콘텐츠예요. 에이전트 규칙 섹션, ESLint·Steiger 설정, shared 타입이 여기 있어요.
- **`template-engine`**: 조립 계층이에요. 프리셋, 리뷰 프로바이더, doctor 체크, `ToolkitConfig`가 여기 있어요.
- **`nx-plugin`**: 제너레이터 16종과 `archweave/fsd-boundaries` ESLint 규칙이 있어요. `@nx/devkit`을 import 하는 유일한 프로젝트예요.

> [!NOTE]
> **통째로 새로 만드는 파일은 `templates`에 없어요.** GitHub 템플릿, 슬라이스처럼 통째로 새로 만드는 파일은 각 제너레이터의 `files/` 템플릿에서 나와요.

## 의존 규칙

아키텍처 규칙 2가지는 관례에 맡기지 않아요. ESLint `@nx/enforce-module-boundaries`가 기계적으로 강제해요.

```
type:util (shared)       → 없음
type:assets (templates)  → util
type:policy              → util
type:integration         → util
type:engine              → util, policy, assets
type:plugin              → util, integration, engine
type:cli                 → plugin
```

## thin-adapter 불변식

제너레이터에는 콘텐츠 리터럴이 없어요. 콘텐츠는 `templates → template-engine → generator` 순서로 흘러요. 그래서 플러그인은 엔진 위의 얇은 어댑터로 남아요.
