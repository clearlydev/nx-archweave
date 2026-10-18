# nx-archweave

[![npm: @clearlydev/nx-archweave](https://img.shields.io/npm/v/@clearlydev/nx-archweave?label=%40clearlydev%2Fnx-archweave)](https://www.npmjs.com/package/@clearlydev/nx-archweave) [![npm: create-nx-archweave](https://img.shields.io/npm/v/create-nx-archweave?label=create-nx-archweave)](https://www.npmjs.com/package/create-nx-archweave) [![CI](https://github.com/clearlydev/nx-archweave/actions/workflows/ci.yml/badge.svg)](https://github.com/clearlydev/nx-archweave/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | 한국어

> Nx를, JS 풀스택 개발자가 쉽게 쓸 수 있도록.

**nx-archweave**는 Nx 플러그인과 `create-*` CLI예요. 대부분의 팀이 결국 손으로 만들게 되는 Nx 워크스페이스 설정을 대신 해 줘요.

## 제공하는 것

- 모듈 경계가 강제되는 **Feature-Sliced Design (Lite)** 폴더 구조
- 사용하는 AI 코딩 도구를 위한 **AI 에이전트 규칙 파일**
- **GitHub 이슈/PR 템플릿**
- 원하는 AI 프로바이더로 동작하는 **자동 PR 리뷰**(완전 선택형)

## 빠른 시작

```bash
# 새 워크스페이스, 설정까지 한 번에 (npm)
npx create-nx-archweave my-app

# pnpm으로 같은 작업
pnpm dlx create-nx-archweave my-app

# 또는 기존 워크스페이스에 플러그인 추가 (pnpm: add -D -w)
npm install -D @clearlydev/nx-archweave
```

| 패키지 | 설명 |
| --- | --- |
| [`@clearlydev/nx-archweave`](https://www.npmjs.com/package/@clearlydev/nx-archweave) | Nx 플러그인, 제너레이터 16종 |
| [`create-nx-archweave`](https://www.npmjs.com/package/create-nx-archweave) | CLI: 빈 디렉터리에서 설정 완료된 워크스페이스까지 한 번에 |

**요구 사항:** Node >= 22.18, 그리고 npm, pnpm >= 10, yarn(classic·berry), bun 중 하나.

> [!NOTE]
> 도구의 리포트는 항상 영어로 출력돼요. `--locale` 옵션은 *생성되는 콘텐츠*(에이전트 규칙, 템플릿, 리뷰 프롬프트)의 언어를 정해요. CLI 출력은 바뀌지 않아요.

## 왜 만들었나

Nx는 강력해요. 그래도 풀스택 JS 개발자가 새 프로젝트를 시작하면, 제품 코드를 한 줄 쓰기 전에 정할 게 많아요.

- 폴더를 어떻게 나눌지
- 레이어가 거꾸로 import 하는 걸 어떻게 막을지
- `CLAUDE.md`에 무엇을 넣을지
- 어떤 GitHub 템플릿을 둘지
- AI 코드 리뷰를 붙일지 말지

nx-archweave는 이 5가지 질문에 **프리셋 기반** 제너레이터로 답해요. 그러면서도 각 조각을 따로 실행하고, 미리 보고, 건너뛸 수 있어요. 설계 전체를 이끄는 불변식은 2가지예요.

1. **AI 리뷰는 처음부터 끝까지 선택 사항이에요.** 리뷰를 끄고 생성한 워크스페이스에는 리뷰 관련 산출물이 하나도 없어요. AI 프로바이더가 없어도 라이브러리는 온전히 동작해요. 리뷰를 켜도, 생성된 워크플로는 프로바이더 시크릿을 등록하기 전까지 **실패하지 않고 green-skip** 해요.
2. **제너레이터는 예고 없이 아무것도 바꾸지 않아요.** 모든 제너레이터는 파일을 쓰기 전에 무엇을 할지 먼저 보여 줘요. 워크스페이스 제너레이터는 `--dryRun`으로 미리 봐요. 통합 제너레이터 2개는 워크스페이스 밖에서 동작해요. 그래서 `--apply`를 줄 때까지는 미리보기만 해요. 같은 제너레이터를 두 번 실행해도 달라지는 건 없어요. 전제 조건이 맞지 않으면 예외를 던지는 대신 이유를 알려 줘요.

## 문서

- **[시작하기](docs/ko-KR/getting-started.md)** — 설치, create CLI의 질문과 플래그, 기존 워크스페이스에 플러그인 추가
- **[제너레이터와 프리셋](docs/ko-KR/generators.md)** — 제너레이터 16종과 프리셋별로 켜지는 것
- **[자동 PR 리뷰](docs/ko-KR/pr-review.md)** — 프로바이더, 게이트, 모드, 발견 항목
- **[FSD Lite](docs/ko-KR/fsd-lite.md)** — 레이어 규칙, `archweave/fsd-boundaries` ESLint 규칙, Steiger
- **[강제되는 경계](docs/ko-KR/boundaries.md)** — 풀스택 워크스페이스의 프론트엔드·백엔드·shared 범위 규칙
- **[선택형 플러그인](docs/ko-KR/plugins.md)** — 호스트별 플러그인 카탈로그, 설치와 검증
- **[동작 계약](docs/ko-KR/behavioral-contracts.md)** — 모든 제너레이터가 지키는 약속: 미리보기, 멱등성, 거부 보고
- **[리포지토리 구조](docs/ko-KR/architecture.md)** — 패키지들이 어떻게 맞물리는지

## 기여하기

개발 환경, 엔드투엔드 스크립트, CI, 릴리스 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)에 있어요. 보안 문제는 [SECURITY.md](SECURITY.md)의 절차대로 알려 주세요.

## 라이선스

[MIT](LICENSE)
