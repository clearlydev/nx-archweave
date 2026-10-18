# FSD Lite

[English](../fsd-lite.md) | 한국어

프론트엔드 앱은 정식 [Feature-Sliced Design](https://feature-sliced.design)을 따라요. 이 문서는 레이어, `add-fsd-lite` 설정, 경계 린트 규칙, 슬라이스 제너레이터, 선택형 steiger 검사를 다뤄요.

> [!NOTE]
> **"Lite"는 부분집합이지 변형이 아니에요.** 규칙, 폴더 모양, public API 관례는 정식 FSD 그대로예요. 기본으로 켜는 범위만 작아요.

## 정식 FSD와 FSD Lite

| | 정식 FSD | FSD Lite |
| --- | --- | --- |
| 레이어 | app, pages, widgets, features, entities, shared | React + Vite 5개, Next.js 4개 |
| 슬라이스 | 세그먼트(`ui/`, `model/`, `api/`, `lib/`, `config/`) | 같음 |
| public API | 슬라이스당 `index.ts` 하나, 레이어 단위 배럴 없음 | 같음 |
| import | 아래 레이어로만, 슬라이스는 index로만 | 같음, 규칙 1개 |
| 강제 수준 | 도구에 맡김 | 프리셋에 따라 `error` / `warn` |
| 빈 레이어 | 첫 슬라이스가 생길 때 레이어가 생김 | 같음, placeholder 폴더 없음 |

표에서 줄인 내용:

- **레이어** — FSD Lite의 기본 범위는 React + Vite에서 레이어 5개, Next.js에서 4개예요(아래 '레이어' 참고). `widgets`는 `widget` 제너레이터로 요청할 때만 생겨요. 린트 규칙은 레이어 6개를 모두 알아요.
- **슬라이스** — 슬라이스 안에 세그먼트가 들어가요. `page`/`widget`/`feature`/`entity` 제너레이터가 `index.ts` + `model/`을 만들고, `--segments`로 더 추가할 수 있어요.
- **import** — 같은 레이어의 슬라이스끼리는 import하지 않아요. 예외는 `@x/<consumer>`를 거치는 경우예요. FSD Lite에서는 린트 규칙 1개가 이 import 규칙을 모두 검사해요.
- **강제 수준** — `team`은 `error`, `solo`와 `quick-start`는 `warn`이에요. 프리셋별로 다른 건 심각도뿐이에요.

## 레이어

어떤 레이어를 쓰는지는 **프레임워크**에 따라 정해져요. 프리셋과는 상관없어요.

| 프레임워크 | 레이어 |
| --- | --- |
| `react-vite` | `app`, `pages`, `features`, `entities`, `shared` |
| `next` | `pages`(`_pages/` 폴더), `features`, `entities`, `shared` |

Next.js에서는 pages 레이어가 `_pages/`에 있어요. Next.js가 `app/`을 쓰고 `src/pages`를 Pages Router로 읽어요. 그래서 FSD 공식 Next.js 가이드도 이 레이어 이름을 `_pages`로 둬요.

레이어가 놓이는 곳:

- **폴더** — 프론트엔드 앱의 소스 루트(`apps/<app>/src`, 또는 프로젝트의 `sourceRoot`).
- **대상 앱** — 워크스페이스에 하나뿐인 프론트엔드 애플리케이션, 또는 `--project`로 지정한 앱. e2e 프로젝트와 백엔드 `api`는 후보가 아님.
- **후보가 2개 이상** — 실행을 멈추고 후보 목록을 보여 줌.
- **React + Vite** — Nx 템플릿의 `src/app`(`app.tsx`가 있는 곳)이 곧 app 레이어.

## 설정: `add-fsd-lite`

> [!NOTE]
> **`add-fsd-lite`는 폴더를 만들지 않아요.** 레이어는 첫 슬라이스를 추가할 때 생겨요.

`add-fsd-lite`가 하는 일 3가지:

1. 앱 선택
2. `archweave/fsd-boundaries` ESLint 규칙을 앱의 `eslint.config.mjs`에 연결. 이 규칙은 플러그인 안에 `@clearlydev/nx-archweave/eslint`로 들어 있어서 추가 의존성이 없음
3. 레이어 안내 출력

`eslint.config.mjs`를 쓰는 방식은 `add-backend`와 같아요.

| 워크스페이스 | `eslint.config.mjs`에 일어나는 일 |
| --- | --- |
| CLI가 방금 만든 것 | 실제로 기록(`--applyEslint`) |
| 기존 워크스페이스 | `--applyEslint` 없이는 붙여넣기 스니펫 |
| 인식하지 못하는 설정 모양 | 절대 건드리지 않음 |

추가되는 코드는 두 줄이에요.

```js
import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';
export default [...baseConfig, ...fsdBoundaries({ severity: 'error' })];
```

## 경계 규칙

규칙이 보고하는 문제는 3가지예요.

- 상위 레이어 import
- 같은 레이어의 다른 슬라이스 import
- public API 우회(다른 슬라이스나 shared 세그먼트의 내부 파일 직접 import)

규칙이 검사하는 import:

- **상대 경로** — 규칙이 경로를 실제로 해석해요. 그래서 자기 슬라이스 안의 `../model/x`는 통과하고, 옆 슬라이스의 `../sign-in`은 걸려요.
- **별칭** — Nx Next.js 템플릿이 쓰는 `@/`를 검사해요. 앱 tsconfig `paths`의 `"<prefix>*": ["<dir>/*"]` 항목도 `extends` 체인까지 포함해 모두 검사해요. `aliases`를 넘기면 이 별칭 목록 전체를 바꾸고, `tsconfig: false`를 넘기면 tsconfig 조회를 건너뛰어요.
- **패키지 지정자** — 검사하지 않음.

심각도:

- `--enforcement=error|warn`은 `toolkit.config.json`의 `fsd.enforcement`보다 우선해요. `fsd.enforcement` 값은 `init`이 프리셋을 보고 기록해요.

## 제너레이터

| 제너레이터 | 만드는 것 |
| --- | --- |
| `page`, `widget`, `feature`, `entity` | `<src>/<layer>/<name>/`에 슬라이스 |
| `shared` | `<src>/shared/<name>/`에 세그먼트 |

제너레이터가 만드는 파일:

- **슬라이스** — `<src>/<layer>/<name>/index.ts`, `model/<name>.ts`, `model/<name>.spec.ts`. `--segments=ui,api`로 요청한 추가 세그먼트마다 `index.ts`도 하나씩.
- **세그먼트** — `<src>/shared/<name>/index.ts`, `<name>.ts`, `<name>.spec.ts`.

제너레이터 동작:

- 슬라이스 제너레이터는 레이어 폴더가 없으면 함께 만들어요.
- Next.js에서는 `page`가 `_pages/`에 슬라이스를 만들어요. Next.js인지는 기록된 frontend로 판단해요. 기록이 없으면 앱의 `next.config` 파일을 보고, `next.config` 파일도 없으면 `--frontend`를 봐요.
- `shared` 세그먼트 이름은 목적을 나타내야 해요(`ui`, `api`, `model`, `lib`, `config`). 무엇인지를 말하는 이름(`components`, `hooks`, `utils`, `types` …)은 `shared` 제너레이터가 거부해요.
- 같은 이름의 슬라이스가 이미 있으면 덮어쓰지 않고 건너뛰어요.
- 제너레이터는 `--publicApiName`이 쓸 수 있는 TypeScript 식별자인지 확인해요.

## 주변

- FSD를 켜면 에이전트 규칙 블록에 "프론트엔드 구조 (FSD Lite)" 섹션이 들어가요.
- doctor의 `fsd-enforcement-applied` 검사는 경계 규칙을 import하는 ESLint 설정이 하나도 없으면 경고해요.

## 선택: steiger

[steiger](https://github.com/feature-sliced/steiger)는 FSD 공식 린터예요. 구조가 정식 FSD라서 steiger를 그대로 쓸 수 있어요. `add-fsd-lite --steiger`로 켜면 다음 3가지가 추가돼요.

- 앱의 `steiger.config.mjs` — recommended 규칙. 갓 만든 슬라이스는 참조가 없어서 `insignificant-slice`는 경고. Next.js에선 `_pages` 오타 규칙 끔
- 앱의 `fsd-check` 타깃
- 루트 `package.json`의 devDependencies 2개 — 설치는 출력된 명령을 직접 실행

steiger 검사는 `nx lint`에 포함되지 않아요. 따로 실행하세요.

```sh
nx run <app>:fsd-check
```

> [!IMPORTANT]
> steiger는 **Node ≥ 22.18**이 필요해요.
