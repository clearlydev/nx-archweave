import { AI_HOST_CHOICES, type CliAiHost, type CliPluginChoice, type CliReviewProvider, type CliBackend, type CliFrontend, type CliLocale, type CliPreset } from './types.ts';
import { CLI_VERSION } from '../render-usage.ts';
import type { CliPackageManager } from './package-manager.ts';

export interface CreatePlanInput {
  name: string;
  preset: CliPreset;
  /** Resolved by package-manager.ts (flag, question, launcher) — there is nothing to
   * detect before the workspace exists. */
  packageManager: CliPackageManager;
  frontend: CliFrontend;
  backend: CliBackend;
  locale: CliLocale;
  /** The AI hosts picked: forwarded to create-nx-workspace as
   * `--aiAgents` (Nx's own AI files) and to init as `--aiHosts` (our rules, review default). */
  aiHosts: CliAiHost[];
  /** Plugins to install once the workspace is complete —
   * one optional install-integration step each, last. */
  plugins?: CliPluginChoice[];
  /** Explicit --review/--no-review override. Undefined means "not passed" — the
   * `nx g ...:init` call below then omits `--review` entirely and the init
   * generator's own preset default applies (the CLI carries no content/policy
   * knowledge of what that default is — see
   * `packages/template-engine/src/presets/preset-config.ts`). */
  review?: boolean;
  /** Picked or passed review provider; omitted → init's own default (the first AI host's). */
  reviewProvider?: CliReviewProvider;
  /** Overrides the plugin package/version installed in step 2 — local dev / E2E use this
   * to point at a tarball or local path instead of the published package. */
  pluginSource?: string;
}

/** Execution-time context for finalizeArgs — some arguments only exist after
 * step 1 created the workspace (its nx version, the frontend app's name). */
export interface StepContext {
  workspacePath: string;
  readFile(relativePath: string): string | undefined;
  listDir(relativePath: string): string[];
}

export interface PlanStep {
  id:
    | 'create-workspace'
    | 'add-react-plugin'
    | 'create-web-app'
    | 'install-plugin'
    | 'install-backend-plugin'
    | 'create-api-app'
    | 'run-init'
    | 'settle-build-approvals'
    | 'list-blocked-scripts'
    | 'install-ai-plugin';
  description: string;
  command: string;
  args: string[];
  /** Directory the step must run in, relative to the directory create-nx-archweave
   * itself was invoked from. `null` means "that directory itself" (step 1, before the
   * workspace exists); every later step runs inside the freshly created workspace. */
  cwd: string | null;
  /** When present, resolves the real args at execution time (the
   * @nx/<backend> version pin and --frontendProject are only knowable after
   * step 1 ran). Returning { error } stops the plan before executing the
   * step; { skip } records the step as satisfied without executing it
   * (express already declared, so there is nothing to align). */
  finalizeArgs?: (ctx: StepContext) => string[] | { error: string } | { skip: string };
  /** Printed under the failure report when this step's command exits non-zero — for
   * a known upstream failure the user cannot diagnose from the tool's own output. */
  failureHint?: string;
  /** Printed under the success report when the step actually ran, given the args it
   * ran with — for a step whose effect the user should know about afterwards. */
  successNote?: (args: string[]) => string;
  /** The workspace is complete without this step: when it fails, the run goes on and
   * still succeeds, and the report names the failure and its failureHint. */
  optional?: boolean;
}

export interface CreatePlan {
  steps: PlanStep[];
  /** Environment overrides every step runs with, on top of the inherited one. */
  env?: Record<string, string>;
  /** Guidance lines to print once every step succeeds.
   * Plain text only — create-nx-archweave never runs any of these itself (no
   * automatic commit — that stays outside what this CLI does). */
  nextSteps: string[];
}

/** The plugin release this CLI was built and tested with — caret-pinned so a later
 * breaking 0.x plugin never pairs with an older CLI (release prep, 2026-10-17). */
const DEFAULT_PLUGIN_SOURCE = `@clearlydev/nx-archweave@^${CLI_VERSION}`;

/** The CLI pins the exact create-nx-workspace version its own E2E gate validated. Every
 * path is a preset, so this pins the workspace's nx too. Bumping this constant is done
 * together with a green `node tools/e2e-create.mjs` run for both PMs. */
const VALIDATED_CREATE_NX_WORKSPACE_VERSION = '24.0.1';


/** `nx` through the workspace's own manager. npm never gets a bare `nx` (its exec needs `--`). */
function nxArgs(pm: CliPackageManager): string[] {
  return pm === 'npm' ? ['exec', 'nx', '--'] : ['nx'];
}

/** `pnpm nx g` / `npm exec nx -- g` — how the user runs a generator in the new workspace. */
export function nxGenerateCommand(pm: CliPackageManager): string {
  return `${pm} ${nxArgs(pm).join(' ')} g`;
}

/** A dev dependency at the workspace root. pnpm: -w (it refuses a root install without
 * it — ERR_PNPM_ADDING_TO_ROOT). npm: plain root install, never -w (it means
 * --workspace=<name> there). bun: plain root add (measured, bun 1.4). yarn: classic
 * needs -W, berry rejects it — so the created workspace decides (`.yarnrc.yml` / a
 * `__metadata:` lockfile mark berry). */
function addDevArgs(pm: CliPackageManager, spec: string, ctx?: StepContext): string[] {
  if (pm === 'pnpm') return ['add', '-D', '-w', spec];
  if (pm === 'npm') return ['install', '-D', spec];
  if (pm === 'bun') return ['add', '-d', spec];
  return ctx && isYarnBerry(ctx) ? ['add', '-D', spec] : ['add', '-D', '-W', spec];
}

export function isYarnBerry(ctx: Pick<StepContext, 'readFile'>): boolean {
  return ctx.readFile('.yarnrc.yml') !== undefined || /^__metadata:/m.test(ctx.readFile('yarn.lock') ?? '');
}

/** yarn berry refuses to write a lockfile when it detects CI (YN0028, measured), which
 * would fail create-nx-workspace's own install in CI and agent runs. Classic ignores it. */
const YARN_PLAN_ENV: Record<string, string> = { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' };

/** No e2e project on any path: Nx's Playwright setup installs browsers outside the
 * workspace (measured 2026-10-25 on create-nx-workspace 23.3.0 and 24.0.1). The
 * getting-started guide shows how to add one later with Nx's own generator. */
const NO_E2E = ['--e2eTestRunner=none'];

/**
 * Maps our `frontend` option to the create-nx-workspace preset the workspace starts from:
 * react-vite → `--preset=empty` (the React app comes next, from Nx's own generator — see
 * reactAppSteps), next → `--preset=next --appName=web`.
 *
 * Why react-vite starts empty (2026-10-25): `--preset=react-monorepo` turns into a download
 * of Nx's react template whenever create-nx-workspace detects an AI agent in the
 * environment, and that template is a demo shop that follows its repository's latest
 * commit, nx version included. `empty` is never redirected, downloads nothing, and stays
 * on this create-nx-workspace's nx (measured with and without agent variables).
 *
 * `--preset=next` needs no further flag with `--interactive=false` — Nx fills
 * every unspecified option with its own default (non-interactive probe against
 * create-nx-workspace v23.2.1, 2026-09-16; re-measured on 24.0.1). `--appName=web` puts the app at apps/web;
 * without it Nx names the app after the workspace, so a workspace called `api` or
 * `*-e2e` would get an app the frontend lookup skips.
 */
function createWorkspaceSourceArgs(frontend: CliFrontend, backend: CliBackend): string[] {
  if (frontend === 'react-vite') return ['--preset=empty'];
  if (frontend === 'next') return ['--preset=next', '--appName=web', ...NO_E2E];
  // Backend-only: Nx's own preset builds the api, named the way every other path names
  // it (measured 2026-10-25, 24.0.1: express → apps/api, a scoped package with a typecheck
  // target; nest → apps/api with a project.json named `api`). vitest like the api the other
  // paths create.
  return [`--preset=${backend}`, '--appName=api', ...NO_E2E, '--unitTestRunner=vitest'];
}

function buildNextSteps(input: CreatePlanInput): string[] {
  const lines = [
    `cd ${input.name}`,
    ...(input.backend !== 'none'
      ? [`${input.packageManager} install   (links the new shared-types workspace package — do this before the first commit)`]
      : []),
    'git add -A && git commit -m "chore: initial commit"',
    '(create-nx-archweave never commits for you — review what the init report above generated first.)',
  ];

  if (input.review === false) return lines;

  // Deliberately vague about WHICH secret: the init report above prints the
  // authoritative secret name for the chosen provider (owned by
  // template-engine/review) — repeating a specific name here would duplicate
  // that content knowledge into the CLI.
  if (input.review === true) {
    lines.push(
      'AI PR review is enabled: add the review secret named in the init report above to the repository before opening a pull request.',
      'Verify the default branch matches what the init report above expects before relying on branch protection.',
    );
  } else {
    lines.push(
      'If the init report above shows AI PR review enabled, add the review secret it names to the repository before opening a pull request, and verify the default branch first.',
    );
  }

  return lines;
}

/**
 * Pure: builds the ordered command list plus the next-steps guidance text
 * (step 5). No I/O — `cli/execute.ts` is what actually runs
 * these commands.
 */
export function buildPlan(input: CreatePlanInput): CreatePlan {
  const pluginSource = input.pluginSource ?? DEFAULT_PLUGIN_SOURCE;
  const workspaceSource = createWorkspaceSourceArgs(input.frontend, input.backend);
  // One flag per host — create-nx-workspace rejects a comma list (measured, 23.2.0). With
  // none, `none` says so explicitly: an omitted flag makes Nx add whatever agent it detects
  // in the environment.
  const aiAgentArgs =
    input.aiHosts.length === 0
      ? ['--aiAgents=none']
      : input.aiHosts.map((host) => `--aiAgents=${AI_HOST_CHOICES.find((choice) => choice.id === host)?.nxAgent ?? host}`);
  const pm = input.packageManager;
  // npm's -w means --workspace=<name>, never "workspace root" — npm installs
  // at the root by default, so the flag is simply absent there.
  const nxPrefix = nxArgs(pm);

  const initArgs = [
    ...nxPrefix,
    'g',
    '@clearlydev/nx-archweave:init',
    `--preset=${input.preset}`,
    `--frontend=${input.frontend}`,
    `--backend=${input.backend}`,
    `--locale=${input.locale}`,
    `--aiHosts=${input.aiHosts.join(',')}`,
    `--packageManager=${pm}`,
    // Step 2 (the plugin install) always dirties the fresh workspace's tree
    // (package.json + lockfile), so init's clean-tree refusal would otherwise
    // always fire here. This is orchestration knowledge, not policy: the CLI
    // knows what its own previous step did. For the same reason the report's note about
    // reverting earlier user changes doesn't apply: the only changes are that install's.
    '--allowDirty=true',
    '--dirtyFromCaller=true',
  ];
  if (input.review !== undefined) {
    initArgs.push(`--review=${input.review}`);
  }
  if (input.reviewProvider !== undefined && input.review !== false) {
    initArgs.push(`--reviewProvider=${input.reviewProvider}`);
  }
  // Decision (i): the CLI just created this workspace, so init writes the ESLint rules for
  // real instead of printing snippets — the scope constraints (backend axis) and the FSD
  // layer rule alike.
  initArgs.push('--applyEslint=true');

  const steps: PlanStep[] = [
    {
      id: 'create-workspace',
      description: `Create the Nx workspace "${input.name}"`,
      // pnpm launches with its own dlx; npm, yarn and bun through npx (always present
      // with Node, and how every yarn and bun row of the measurements was produced).
      command: pm === 'pnpm' ? 'pnpm' : 'npx',
      args:
        pm === 'pnpm'
          ? [
              'dlx',
              `create-nx-workspace@${VALIDATED_CREATE_NX_WORKSPACE_VERSION}`,
              input.name,
              ...workspaceSource,
              ...aiAgentArgs,
              '--pm=pnpm',
              '--nxCloud=skip',
              '--interactive=false',
            ]
          : [
              '-y',
              `create-nx-workspace@${VALIDATED_CREATE_NX_WORKSPACE_VERSION}`,
              input.name,
              ...workspaceSource,
              ...aiAgentArgs,
              `--pm=${pm}`,
              '--nxCloud=skip',
              '--interactive=false',
            ],
      cwd: null,
    },
    ...(input.frontend === 'react-vite' ? reactAppSteps(input.name, pm) : []),
    {
      id: 'install-plugin',
      description: `Install ${pluginSource}`,
      command: pm,
      args: addDevArgs(pm, pluginSource),
      cwd: input.name,
      // yarn's flags depend on its flavor, which only the created workspace tells.
      ...(pm === 'yarn' ? { finalizeArgs: (ctx: StepContext) => addDevArgs(pm, pluginSource, ctx) } : {}),
    },
    // Backend-only: the preset already built apps/api, so neither official step runs.
    ...(input.backend === 'none' || input.frontend === 'none'
      ? []
      : backendSteps(input.backend, input.name, pm, `${pm} ${initArgs.join(' ')}`)),
    {
      id: 'run-init',
      description: 'Run the nx-archweave init generator',
      command: pm,
      args: initArgs,
      cwd: input.name,
    },
    ...(pm === 'pnpm' ? [settleBuildApprovalsStep(input.name)] : []),
    ...(pm === 'bun' ? [listBlockedScriptsStep(input.name)] : []),
    ...(input.plugins ?? []).map((plugin) => installPluginStep(plugin, input.name, pm)),
  ];

  return {
    steps,
    nextSteps: buildNextSteps(input),
    ...(pm === 'pnpm' ? { env: PNPM_PLAN_ENV } : {}),
    ...(pm === 'yarn' ? { env: YARN_PLAN_ENV } : {}),
  };
}

/** Last of all: install-integration runs the host's own
 * installer, verifies the result live and records it — at project scope, so the plugin is
 * recorded in the workspace rather than in the user's settings. Optional: the workspace is
 * complete without it. The generator reports a failed install itself and still exits 0, so
 * the note points at its report; a non-zero exit (it crashed) gets the retry command. */
function installPluginStep(plugin: CliPluginChoice, workspaceName: string, pm: CliPackageManager): PlanStep {
  const hostLabel = AI_HOST_CHOICES.find((choice) => choice.id === plugin.host)?.label ?? plugin.host;
  const args = [
    ...nxArgs(pm),
    'g',
    '@clearlydev/nx-archweave:install-integration',
    `--tool=${plugin.id}`,
    `--target=${plugin.host}`,
    '--scope=project',
    '--apply',
  ];
  return {
    id: 'install-ai-plugin',
    description: `Install the ${plugin.label} plugin for ${hostLabel} (project scope)`,
    command: pm,
    args,
    cwd: workspaceName,
    optional: true,
    successNote: () =>
      `the ${plugin.label} report above says whether it was installed and recorded; if not, it names what to do next.`,
    failureHint: `The workspace itself is complete. To retry inside "${workspaceName}": ${pm} ${args.join(' ')}`,
  };
}

/** pnpm 11 turned `strictDepBuilds` on: an install that meets a dependency build
 * script with no `allowBuilds` decision writes a placeholder and fails
 * (ERR_PNPM_IGNORED_BUILDS) — inside create-nx-workspace's own install of the next
 * preset, and in any install an Nx generator runs later. Every pnpm step runs with
 * it off (pnpm 11 reads `pnpm_config_<snake_case>` variables), so a skipped script
 * stays skipped; the final settle step records those skips as decisions. pnpm 10
 * never fails here, so this is a no-op there. */
const PNPM_PLAN_ENV: Record<string, string> = { pnpm_config_strict_dep_builds: 'false' };

/** The value pnpm 11 writes under `allowBuilds` for a dependency whose build script
 * it skipped without a decision (pnpm 11.9 `handleIgnoredBuilds`). Left in place,
 * the next plain `pnpm install` fails on it again. */
export const PNPM_PENDING_BUILD_PLACEHOLDER = 'set this to true or false';

/** Package names pnpm left awaiting a build decision in pnpm-workspace.yaml — the
 * `allowBuilds` entries still holding the placeholder, in the block form pnpm's
 * writer uses and the single-line flow form it keeps when the file had
 * `allowBuilds: {}`. Keys may contain colons (`foo@file:../foo`), so a line is
 * anchored on the placeholder, not split at the first colon; comments never count.
 * The file is pnpm's own output, and an unexpected shape just yields no names (the
 * user then sees pnpm's own ERR_PNPM_IGNORED_BUILDS guidance on the next install). */
export function pendingBuildDecisions(workspaceYaml: string): string[] {
  const placeholder = PNPM_PENDING_BUILD_PLACEHOLDER;
  const entry = new RegExp(`^(['"]?)(.+)\\1:\\s+(['"]?)${placeholder}\\3$`);
  const pendingKey = (text: string): string | undefined => {
    const trimmed = text.trim();
    if (trimmed.startsWith('#')) return undefined;
    return entry.exec(trimmed)?.[2];
  };
  const names: string[] = [];
  let inAllowBuilds = false;
  for (const line of workspaceYaml.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue; // a comment, even at column 0, neither ends nor joins a block
    if (/^\S/.test(line)) {
      inAllowBuilds = /^allowBuilds:\s*$/.test(line);
      const flow = /^allowBuilds:\s*\{(.*)\}\s*$/.exec(line);
      if (flow) {
        for (const item of flow[1].split(',')) {
          const name = pendingKey(item);
          if (name !== undefined) names.push(name);
        }
      }
      continue;
    }
    if (!inAllowBuilds) continue;
    const name = pendingKey(line);
    if (name !== undefined) names.push(name);
  }
  return names;
}

/** Last pnpm step: every build script pnpm skipped during the flow (and wrote down
 * as pending) is recorded as NOT allowed, through pnpm's own non-interactive
 * `approve-builds !<pkg>` — the conservative choice (no third-party install script
 * runs without the user's say), and the one Nx's own templates make for @swc/core
 * and esbuild. Without it the user's first `pnpm install` fails on the placeholders. */
function settleBuildApprovalsStep(workspaceName: string): PlanStep {
  return {
    id: 'settle-build-approvals',
    description: 'Record the dependency build scripts pnpm skipped as not allowed (pnpm-workspace.yaml allowBuilds)',
    command: 'pnpm',
    args: ['approve-builds'],
    cwd: workspaceName,
    finalizeArgs: (ctx) => {
      const yaml = ctx.readFile('pnpm-workspace.yaml');
      const pending = yaml === undefined ? [] : pendingBuildDecisions(yaml);
      if (pending.length === 0) return { skip: 'no dependency build script is awaiting a decision' };
      return ['approve-builds', ...pending.map((name) => `!${name}`)];
    },
    // Once denied, pnpm 11.9's `approve-builds` no longer lists a package (it only
    // offers what is still pending), so the way back is the file plus a rebuild —
    // which the plugin's allow-builds generator (installed by an earlier step) does.
    successNote: (args) => {
      const names = args.filter((arg) => arg.startsWith('!')).map((arg) => arg.slice(1));
      return (
        `pnpm skipped the build scripts of ${names.join(', ')}; they stay disabled (allowBuilds: false in pnpm-workspace.yaml). ` +
        `To allow one later, run inside "${workspaceName}": pnpm nx g @clearlydev/nx-archweave:allow-builds --packages=<package> --apply`
      );
    },
    failureHint:
      'The workspace itself is complete — every earlier step finished; only recording the build decisions failed. ' +
      'Inside it, set each allowBuilds entry in pnpm-workspace.yaml that still reads "set this to true or false" to true or false yourself, then run pnpm install.',
  };
}

/** Last bun step: bun blocks the install scripts of dependencies outside its trusted
 * list without a word during the install (measured: @swc/core's postinstall in an Nx
 * workspace). Read-only — `bun pm untrusted` prints bun's own list, and exits 0 with
 * "Found 0 untrusted dependencies" when nothing was blocked (measured, bun 1.4.2). The
 * scripts stay blocked; the note names the one-line way back. */
function listBlockedScriptsStep(workspaceName: string): PlanStep {
  return {
    id: 'list-blocked-scripts',
    description: 'List the dependency install scripts bun blocked (bun pm untrusted)',
    command: 'bun',
    args: ['pm', 'untrusted'],
    cwd: workspaceName,
    successNote: () =>
      'bun blocks the install scripts of dependencies it does not trust; the list above (bun pm untrusted) shows the ones it blocked here — they stay blocked. ' +
      `To allow one later, run inside "${workspaceName}": bun pm trust <package>`,
    failureHint:
      'The workspace itself is complete — every earlier step finished; only listing the blocked install scripts failed. ' +
      `Inside "${workspaceName}", run bun pm untrusted to see them.`,
  };
}

/** The react-vite path's React app, from Nx's own generators on the empty workspace:
 * `nx add @nx/react` (Nx installs the plugin at the workspace's nx version), then
 * `@nx/react:app` with every option it would otherwise ask about, and no e2e project
 * (see NO_E2E). */
function reactAppSteps(workspaceName: string, pm: CliPackageManager): PlanStep[] {
  return [
    {
      id: 'add-react-plugin',
      description: 'Add @nx/react with nx add (at the workspace nx version)',
      command: pm,
      args: [...nxArgs(pm), 'add', '@nx/react'],
      cwd: workspaceName,
    },
    {
      id: 'create-web-app',
      description: 'Create the React + Vite app in apps/web with the official @nx/react generator',
      command: pm,
      args: [...nxArgs(pm), 'g', '@nx/react:app', 'apps/web', ...REACT_APP_OPTIONS],
      cwd: workspaceName,
    },
  ];
}

/** Every option @nx/react:app would prompt for in a terminal (measured with a TTY on
 * 23.3.0; the 24.0.1 schema asks the same), so it never stops to ask. ESLint because init writes ESLint rules; vitest because Vite. */
const REACT_APP_OPTIONS = ['--bundler=vite', '--linter=eslint', '--style=css', '--unitTestRunner=vitest', ...NO_E2E, '--routing=false'];

/** The api generators ask for a unit test runner in a terminal (an x-prompt on both
 * @nx/express and @nx/nest, measured 23.3.0, unchanged in 24.0.1); vitest matches the
 * frontend's runner. `--e2eTestRunner=none` (see NO_E2E) is @nx/nest's own option;
 * @nx/express hands its options to @nx/node's application generator, which takes it.
 * No bundler flag: neither schema has one, and both pick webpack themselves (24.0.1:
 * @nx/express passes `bundler: 'webpack'` to @nx/node, @nx/nest forces it), so
 * e2e-create checks for the api's webpack config instead. */
const API_APP_OPTIONS = ['--unitTestRunner=vitest', ...NO_E2E];

/** The two official-generator steps (3 and 4). Both need
 * execution-time facts: the created workspace's nx version (so @nx/* versions
 * can never drift from nx's) and the frontend app's directory name. */
function backendSteps(
  backend: 'express' | 'nest',
  workspaceName: string,
  pm: CliPackageManager,
  initCommand: string,
): PlanStep[] {
  const nxG = nxGenerateCommand(pm);
  // Both frontend paths build apps/web with no api (react-vite: Nx's React generator; next:
  // the next preset, re-measured 2026-10-25 on Nx 24.0.1), so both official steps run.
  // A workspace without apps/ (a layout neither path builds) stops with the manual path,
  // and one that somehow has an apps/api already stops instead of colliding with it.
  const apiExists = (ctx: StepContext): boolean => ctx.listDir('apps').includes('api');
  const standaloneError =
    'this workspace has no apps/ directory — CLI backend wiring needs the frontend under apps/. ' +
    'Create the api app with the official @nx generator, then run ' +
    `\`${nxG} @clearlydev/nx-archweave:add-backend\` yourself. ` +
    `Finish setup inside "${workspaceName}" with: ${initCommand}`;
  const apiExistsError =
    'the workspace already has an apps/api — wire it with ' +
    `\`${nxG} @clearlydev/nx-archweave:add-backend --backend=${backend}\`, or remove it and run the official generator yourself. ` +
    `Either way, finish setup inside "${workspaceName}" with: ${initCommand}`;

  return [
    {
      id: 'install-backend-plugin',
      description: `Install @nx/${backend} (pinned to the workspace's nx version)`,
      command: pm,
      args: addDevArgs(pm, `@nx/${backend}`),
      cwd: workspaceName,
      finalizeArgs: (ctx) => {
        if (ctx.listDir('apps').length === 0) return { error: standaloneError };
        if (apiExists(ctx)) return { error: apiExistsError };
        const raw = ctx.readFile('package.json');
        if (raw === undefined) return { error: "could not read the created workspace's package.json to pin the @nx version" };
        try {
          const parsed = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
          const nxVersion = parsed.devDependencies?.['nx'] ?? parsed.dependencies?.['nx'];
          if (!nxVersion) return { error: "nx version not found in the created workspace's package.json" };
          return addDevArgs(pm, `@nx/${backend}@${nxVersion}`, ctx);
        } catch {
          return { error: "could not parse the created workspace's package.json" };
        }
      },
    },
    {
      id: 'create-api-app',
      description: `Create the api app with the official @nx/${backend} generator`,
      command: pm,
      // Since Nx 20 the positional is a directory relative to the workspace root —
      // a bare `api` would land at the root instead of beside the frontend.
      args: [...nxArgs(pm), 'g', `@nx/${backend}:application`, 'apps/api', ...API_APP_OPTIONS],
      cwd: workspaceName,
      finalizeArgs: (ctx) => {
        const all = ctx.listDir('apps');
        if (all.length === 0) return { error: standaloneError };
        if (all.includes('api')) return { error: apiExistsError };
        const apps = all.filter((name) => name !== 'api' && name !== 'e2e' && !name.endsWith('-e2e'));
        if (apps.length === 0) return { error: 'no frontend app directory found under apps/ in the created workspace' };
        if (apps.length > 1) return { error: `multiple app directories found under apps/ (${apps.join(', ')}) — cannot pick --frontendProject` };
        // Nx registers SCOPED project names (@org/web) while the
        // directory stays apps/web — --frontendProject needs the project name
        // (E2E-CI finding: the directory name made nx fail with "Cannot find
        // configuration"). project.json name, then package.json name, then dir.
        const frontendProject = ((): string => {
          for (const file of [`apps/${apps[0]}/project.json`, `apps/${apps[0]}/package.json`]) {
            const raw = ctx.readFile(file);
            if (raw === undefined) continue;
            try {
              const name = (JSON.parse(raw) as { name?: unknown }).name;
              if (typeof name === 'string' && name.length > 0) return name;
            } catch {
              // unreadable — fall through
            }
          }
          return apps[0];
        })();
        return [...nxArgs(pm), 'g', `@nx/${backend}:application`, 'apps/api', `--frontendProject=${frontendProject}`, ...API_APP_OPTIONS];
      },
    },
  ];
}
