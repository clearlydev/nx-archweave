# 시작하기

[English](../getting-started.md) | 한국어

`create-nx-archweave` CLI로 새 Nx 워크스페이스를 만들거나, 이미 있는 워크스페이스에 플러그인을 추가할 수 있어요. 이 페이지에서는 설치, 요구 사항, 패키지 매니저별 주의점, CLI의 질문과 플래그, CLI가 실행하는 단계를 다뤄요.

## 설치

### 새 워크스페이스

미리 설치할 건 없어요. `npx`로 CLI를 바로 실행하세요.

```bash
npx create-nx-archweave my-app
```

### 기존 Nx 워크스페이스

플러그인을 워크스페이스 루트에 devDependency로 추가하세요. Nx 플러그인은 원래 루트에 둬요. 워크스페이스의 패키지 매니저로 실행하면 돼요.

```bash
npm install -D @clearlydev/nx-archweave        # npm
pnpm add -D -w @clearlydev/nx-archweave        # pnpm
yarn add -D @clearlydev/nx-archweave           # yarn berry (yarn 1은 add -W)
bun add -d @clearlydev/nx-archweave            # bun
```

그다음 설치를 확인하세요. 읽기만 하고 아무것도 바꾸지 않아요.

```bash
npm exec nx -- g @clearlydev/nx-archweave:doctor   # npm
pnpm nx g @clearlydev/nx-archweave:doctor          # pnpm
yarn nx g @clearlydev/nx-archweave:doctor          # yarn
bun nx g @clearlydev/nx-archweave:doctor           # bun
```

아래 예시는 `pnpm nx g`로 써요. 다른 패키지 매니저를 쓴다면 위 블록과 같은 방식으로 같은 제너레이터를 실행하세요.

> [!NOTE]
> 플러그인은 자기 완결형 번들로 배포돼요. 런타임 의존성은 `@nx/devkit`과 `tslib` 2개뿐이에요. 그래서 설치해도 워크스페이스에 전이 의존성 트리가 따라 들어오지 않아요.

## 요구 사항

- **Node** >= 22.18
- **패키지 매니저:** **npm**, **pnpm >= 10**, **yarn**(classic 1.x 또는 berry 2+) 또는 **bun**. 4종 모두 1급 지원이고, 어느 것도 기본값이 아니에요.
- **github.com 접근:** CLI가 Nx react 템플릿을 github.com에서 내려받아요.

### 어떤 패키지 매니저를 쓰나

| 상황 | 사용하는 매니저 |
| --- | --- |
| `--package-manager=npm\|pnpm\|yarn\|bun`을 준 경우 | 그 값. 항상 우선, 질문 생략 |
| 터미널 | CLI 질문에서 고른 매니저 |
| 터미널이 아닌 환경(CI, 에이전트) | 실행한 패키지 매니저, 없으면 npm |

- 터미널에서는 설치된 매니저만 목록에 보여 줘요.
- CLI를 실행한 방식에 맞는 매니저를 미리 선택해 둬요: `npx` → npm, `pnpm dlx` → pnpm, `yarn dlx` → yarn, `bunx` → bun.
- 터미널이 아닐 때 실행한 매니저를 감지하지 못하면 npm을 써요.

이후 생성되는 모든 명령, 워크스페이스 등록, 리뷰 워크플로가 이 선택을 따라요. 제너레이터는 lockfile을 보고 워크스페이스의 실제 패키지 매니저를 감지해요. 그래서 `toolkit.config.json`에 기록된 패키지 매니저가 실제와 달라져도 제너레이터는 올바른 파일을 써요.

## 패키지 매니저별 주의점

### npm 10과 yarn 1

> [!WARNING]
> **npm 10**과 **yarn 1**로는 react-vite 워크스페이스를 만들 수 없어요. `create-nx-workspace`가 Nx react 템플릿을 자체 설치하는 도중에 둘 다 실패해요. npm 11+, pnpm, yarn 2+(yarn berry는 Corepack으로: `corepack enable`) 또는 bun을 쓰세요.

| 매니저 | 실패 이유 |
| --- | --- |
| **npm 10**(Node 22에 번들) | `Cannot read properties of null (reading 'edgesOut')` |
| **yarn 1** | 템플릿의 `workspace:*` 패키지를 해석하지 못함 |

- CLI 질문 목록에는 npm 10과 yarn 1이 실패 이유와 함께 보이지만, 고를 수는 없어요.
- 플래그나 실행한 패키지 매니저가 npm 10이나 yarn 1이면, 아무것도 만들기 전에 멈춰요.
- `--frontend=next`는 npm 10과 yarn 1 모두 문제없이 설치돼요.

### yarn

- yarn berry 워크스페이스는 Plug'n'Play가 아니라 `nodeLinker: node-modules`를 써요. 이 설정은 `create-nx-workspace`가 직접 넣어요.

> [!NOTE]
> Yarn 4는 배포된 지 하루가 안 된 패키지 버전을 받지 않아요(`npmMinimalAgeGate`, 기본 1440분). 그래서 새 버전이 나온 뒤 24시간 동안은 yarn이 그 버전을 찾지 못해요. `yarn dlx create-nx-archweave`도, yarn 워크스페이스 안의 플러그인 설치도 마찬가지예요. 하루 기다리거나, 그 실행에만 `YARN_NPM_MINIMAL_AGE_GATE=0`을 주세요.

### bun

- bun은 신뢰 목록에 없는 의존성의 설치 스크립트를 알리지 않고 막아요.
- Nx react 템플릿에서는 `@swc/core`의 postinstall이 막혀요. 그래도 워크스페이스는 빌드돼요.
- CLI의 마지막 bun 단계가 `bun pm untrusted`로 막힌 스크립트 목록을 보여 줘요. 막힌 스크립트는 그대로 막혀 있어요.

막힌 스크립트를 허용하려면 워크스페이스 안에서 실행하세요.

```bash
bun pm trust <package>
```

### pnpm 11

pnpm 11은 `pnpm-workspace.yaml`에 허용/거부 결정이 없는 의존성 빌드 스크립트를 만나면 설치를 멈춰요(`ERR_PNPM_IGNORED_BUILDS`). Nx next 템플릿은 자체 설치 중에 여기에 걸려요. pnpm 10은 영향이 없어요.

- 그래서 CLI는 pnpm 단계를 이 검사를 끈 채로 실행해요.
- 마지막 단계에서 CLI는 pnpm이 건너뛴 빌드 스크립트를 모두 **허용 안 함**으로 기록해요. pnpm 자체 명령 `pnpm approve-builds '!<패키지>'`를 써요. 사용자가 허락하지 않으면 서드파티 설치 스크립트는 실행되지 않아요.
- 성공 리포트에 해당 패키지 이름이 나와요.

나중에 허용하려면 워크스페이스 안에서 실행하세요.

```bash
pnpm nx g @clearlydev/nx-archweave:allow-builds --packages=<패키지> --apply
```

이 제너레이터는 `allowBuilds`의 `<패키지>`를 `true`로 바꾸고 `pnpm rebuild <패키지>`까지 실행해요. 한 번 거부된 패키지는 `pnpm approve-builds` 목록에 더 이상 나오지 않아서 이 제너레이터가 필요해요.

## AI 코딩 도구

CLI는 어떤 **AI 코딩 도구**를 쓰는지도 물어요. Claude Code, Codex, Cursor, Gemini CLI 중에서 하나 이상 고를 수 있어요(`--ai-hosts=claude-code,cursor`). 터미널이 아니면 Claude Code를 골라요. 고른 도구에 따라 다음 3가지가 정해져요.

| 항목 | 고른 도구에 따라 |
| --- | --- |
| 에이전트 규칙 파일 | Claude Code는 `CLAUDE.md`, 나머지는 `AGENTS.md` |
| Nx 자체의 AI 설정 | `create-nx-workspace --aiAgents` |
| 리뷰 프로바이더 기본값 | 첫 번째로 고른 도구 |

Nx react 템플릿은 `--aiAgents` 값과 상관없이 모든 도구의 파일을 담고 있어요.

### 에이전트 규칙

- nx-archweave는 `CLAUDE.md`나 `AGENTS.md` 안에 표시된 블록 하나(`<!-- nx-archweave:agent-rules start -->` … `end -->`)로 규칙을 넣어요.
- Nx의 블록과, nx-archweave 블록 주변에 직접 쓴 내용은 절대 건드리지 않아요.
- 고른 도구 중 어느 것도 읽지 않는 파일에 nx-archweave 블록이 남아 있으면, 직접 지울 때까지 그대로 있어요.

나중에 도구를 바꾸려면 `add-agent-rules`를 실행하세요. 바꾼 도구는 `toolkit.config.json`에도 기록돼요.

```bash
nx g @clearlydev/nx-archweave:add-agent-rules --hosts=…
```

### 설치된 도구와 카탈로그 플러그인

- 질문에는 도구 4종 중 이 컴퓨터에 설치된 도구가 표시돼요. CLI가 `claude`, `codex`, `cursor-agent`, `gemini`를 `--version`으로 확인해요.
- 실행되지 않는 도구는 '없음'으로 쳐요. 그래도 도구 4종은 모두 고를 수 있어요.
- 마지막으로, 고른 도구 중 설치돼 있고 [카탈로그 플러그인](plugins.md)이 있는 도구마다 플러그인을 제안해요. 번호로 고르고, 엔터를 누르면 건너뛰어요(`--plugins=ponytail` 또는 `--plugins=none`). 터미널이 아니면 설치하지 않아요.
- 고른 플러그인마다 마지막에 `install-integration --scope=project --apply` 단계가 추가돼요.
- 그 단계가 실패해도 워크스페이스는 완성된 상태예요. 리포트가 재시도 명령을 알려 줘요.

## 빠른 시작

### 새 워크스페이스 (CLI)

```bash
npx create-nx-archweave my-app \
  --preset=quick-start --frontend=react-vite --review
```

CLI는 실행할 3단계를 먼저 출력한 뒤, 고른 패키지 매니저로 차례대로 실행해요.

| 단계 | 실행 내용 |
| --- | --- |
| 1 | Nx react 템플릿으로 `create-nx-workspace` |
| 2 | 플러그인 설치 |
| 3 | 플러그인의 `init` 제너레이터 |

npm이면 3단계 명령은 다음과 같아요.

```bash
npx -y create-nx-workspace@23.3.0 my-app \
  --template=nrwl/react-template \
  --pm=npm --nxCloud=skip --interactive=false
npm install -D @clearlydev/nx-archweave@^<cli-version>
npm exec nx -- g @clearlydev/nx-archweave:init \
  --preset=… --frontend=… --backend=… --locale=… \
  --allowDirty=true
```

pnpm이면 3번째 단계의 `init`에 위 npm 명령과 같은 플래그가 붙어요.

```bash
pnpm dlx create-nx-workspace@23.3.0 my-app \
  --template=nrwl/react-template \
  --pm=pnpm --nxCloud=skip --interactive=false
pnpm add -D -w @clearlydev/nx-archweave@^<cli-version>
pnpm nx g @clearlydev/nx-archweave:init …
```

- `--frontend=next`면 템플릿 대신 `--preset=next`를 써요.
- pnpm은 4번째 단계가 추가돼요. pnpm이 건너뛴 의존성 빌드 스크립트를 기록하는 단계예요([pnpm 11](#pnpm-11) 참고).
- bun도 4번째 단계가 추가돼요. bun이 막은 설치 스크립트를 `bun pm untrusted`로 보여 주는 단계예요.

**템플릿을 이름으로 지정하는 이유.** react-vite 워크스페이스는 Nx의 fullstack 템플릿이고, CLI는 이 템플릿을 이름으로 지정해 만들어요.

- `create-nx-workspace`는 환경에서 AI 에이전트(Claude Code, Codex, Cursor 등)를 감지했을 때만 `--preset=react-monorepo`를 이 템플릿으로 만들어요.
- 일반 터미널에서는 같은 플래그로 `apps/api`가 없는 다른 워크스페이스가 만들어져요.
- 템플릿을 이름으로 지정하면 언제 실행해도 같은 워크스페이스가 나와요.
- 템플릿은 github.com에서 내려받아요. `create-nx-workspace` 버전은 CLI의 E2E 게이트가 검증한 버전으로 고정돼요.

**CLI가 하는 일과 하지 않는 일:**

- `create-nx-workspace`를 다시 구현하지 않고, 커밋도 절대 대신 하지 않아요.
- 플래그로 주지 않은 값은 대화형으로 물어요. `quick-start`는 일부러 질문 수를 최소로 줄였어요.
- 어느 단계든 실패하면 바로 멈추고 복구 방법을 알려 줘요. 생성된 디렉터리는 **자동으로 지우지 않고** 그대로 둬요.

### 백엔드 추가

`--backend=express|nest`를 주면 plan에 공식 단계 2개가 추가돼요.

```bash
pnpm add -D -w @nx/<backend>@<워크스페이스의 정확한 nx 버전>
pnpm nx g @nx/<backend>:application apps/api --frontendProject=<감지된 앱>
```

- 생성은 끝까지 Nx가 맡아요. 그다음 init이 shared-types와 scope 태그를 배선하고, 경계 제약을 기록해요.
- 이 경로에서는 `--applyEslint=true`예요. CLI가 방금 만든 워크스페이스라서요.

Nx 템플릿에 대해 알아 둘 점 2가지:

| 템플릿 | `--backend=express` | `--backend=nest` |
| --- | --- | --- |
| react | "템플릿이 이미 제공"으로 기록 | 안내와 함께 중단 |
| Next | 공식 단계 2개 실행 | express와 같음 |

- **react + express:** Nx react 템플릿에는 이미 Express `apps/api`가 들어 있어요. 그래서 CLI는 공식 단계 2개를 "템플릿이 이미 제공"으로 기록해요.
- **react + nest:** api 자리가 이미 차 있어서 CLI가 안내와 함께 멈춰요. express를 쓰거나, Nest를 직접 깐 뒤 `add-backend`를 실행하세요.
- **Next + 두 백엔드 모두:** 공식 단계 2개가 그대로 실행돼요. `apps/api`는 Next 앱 옆에 생기고, `--frontendProject`는 Next 앱의 패키지 이름을 써요.

Next 워크스페이스는 앱이 `apps/<이름>`에 있고 api가 없어요. 그래서 어느 백엔드를 고르든 공식 단계 2개가 그대로 실행돼요.

### 백엔드 단독 워크스페이스

`--frontend=none --backend=express|nest`를 쓰세요. 프론트엔드 질문에도 `none`이 있어요.

- api는 Nx 자체 프리셋이 만들어요(`create-nx-workspace --preset=<backend> --appName=api` → `apps/api`). 그래서 위의 공식 단계 2개는 필요 없어요.
- init은 FSD를 건너뛰어요. 구조를 잡을 프론트엔드가 없으니까요.
- `add-backend`가 api만 배선해요: `scope:backend`, `libs/shared-types`, 그리고 같은 deny 규칙. 이 deny 규칙은 나중에 어떤 프론트엔드가 합류하든 그대로 막아 줘요.

두 프리셋은 구조가 달라요.

| 프리셋 | 워크스페이스 | `shared-types` 연결 방식 |
| --- | --- | --- |
| express | 패키지 기반 | 워크스페이스 링크 |
| nest | integrated(워크스페이스 패키지 없음) | `tsconfig.base.json`의 paths 별칭 |

이런 워크스페이스에서 `add-backend`를 직접 실행해도 결과는 같아요.

### CLI 플래그

| 플래그 | 값 |
| --- | --- |
| `<name>` | 위치 인자: 워크스페이스 디렉터리 이름 |
| `--preset` | `quick-start` \| `solo` \| `team` |
| `--frontend` | `react-vite` \| `next` \| `none` |
| `--backend` | `express` \| `nest` \| `none` |
| `--locale` | `ko` \| `en` |
| `--review` / `--no-review` | — |
| `--review-provider` | `claude` \| `gemini` \| `gpt` \| `cursor` |
| `--plugin-source` | 패키지 스펙·경로·tarball |
| `--ai-hosts` | `claude-code`, `codex`, `cursor`, `gemini-cli` |
| `--plugins` | 카탈로그 id(`ponytail`) 또는 `none` |
| `--package-manager` | `npm` \| `pnpm` \| `yarn` \| `bun` |
| `-h`, `--help` / `-v`, `--version` | — |

stdin이 TTY가 아니고 필수 입력이 빠졌다면, CLI는 명확한 메시지와 함께 바로 실패해요. 멈춘 채 기다리거나, 조용히 성공으로 끝나지 않아요.

#### `--preset`

- 생략하면 CLI가 물어요.

#### `--frontend`

- 생략하면 CLI가 물어요.
- `none`은 백엔드 단독 워크스페이스예요. `--backend`가 필요해요.

#### `--backend`

- 생략하면 CLI가 물어요.
- 백엔드를 고르면 `apps/api`와 shared-types, **강제되는** 경계가 추가돼요.

#### `--locale`

- 생략하면 CLI가 물어요.
- `quick-start`는 묻지 않고 기본값 `en`을 써요.

#### `--review` / `--no-review`

둘 다 주지 않으면:

- `quick-start`는 y/N으로 물어요. 터미널이 아니면 플래그를 달라며 실패해요.
- `solo`와 `team`은 리뷰를 켜요.

#### `--review-provider`

- 리뷰가 켜지면 CLI가 물어요. 번호로 고르세요.
- 엔터를 누르면 첫 번째로 고른 AI 도구의 프로바이더를 써요(예: Codex → GPT).
- 터미널이 아니면 이 기본값을 써요.
- 리뷰가 결국 꺼진 상태면 이 플래그를 거부해요.

#### `--plugin-source`

- 2단계에서 설치할 대상을 바꿔요.
- 기본값은 이 CLI와 짝이 맞는 플러그인 릴리스, `^<CLI 버전>`이에요.
- 버전을 고정하거나(`@clearlydev/nx-archweave@1.2.3`) 로컬 빌드를 지정할 때 써요.

#### `--ai-hosts`

- 쉼표로 구분해서 줘요.
- 생략하면 CLI가 물어요. 번호로 고르고, 엔터를 누르면 Claude Code예요.
- 터미널이 아니면 Claude Code를 써요.

#### `--plugins`

- 카탈로그 id를 쉼표로 구분해서 주거나, `none`을 줘요.
- 생략하면 고른 도구 중 설치된 도구마다 물어요. 번호로 고르고, 엔터를 누르면 설치하지 않아요.
- 터미널이 아니면 설치하지 않아요.
- 각 플러그인은 고른 도구의 플러그인이어야 해요.

#### `--package-manager`

- 생략하면 CLI가 물어요. 설치돼 있고 이 워크스페이스를 만들 수 있는 매니저만 보여 주고, 실행한 패키지 매니저를 미리 선택해 둬요.
- 터미널이 아니면 실행한 패키지 매니저를 쓰고, 감지되지 않으면 npm을 써요.

### 기존 워크스페이스 (플러그인)

읽기 전용 진단:

```bash
pnpm nx g @clearlydev/nx-archweave:doctor
```

CI 게이트:

```bash
pnpm nx g @clearlydev/nx-archweave:doctor --json --quiet |
  jq -e '.overallStatus == "safe" or .overallStatus == "manual-review-required"'
```

> [!TIP]
> yarn 1은 stdout에 배너를 찍어요. 그래서 yarn 1에서는 `yarn --silent nx g …`로 실행하세요. yarn berry는 이 플래그가 필요 없어요.

`--dryRun`으로 `init`을 미리 본 뒤 실행하세요.

```bash
pnpm nx g @clearlydev/nx-archweave:init --preset=team --frontend=next --dryRun
pnpm nx g @clearlydev/nx-archweave:init --preset=team --frontend=next
```

> [!IMPORTANT]
> `init`은 깨끗한 git 워킹 트리가 필요해요. 그래야 중간에 멈춘 실행도 `git restore .` 한 번으로 항상 되돌릴 수 있어요. `--allowDirty`를 주면 이 검사를 건너뛸 수 있어요. 이때 리포트는 "`git restore .`가 기존 미커밋 변경까지 되돌린다"고 경고해요.
