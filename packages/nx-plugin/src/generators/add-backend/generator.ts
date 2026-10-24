import type { ProjectConfiguration, Tree } from '@nx/devkit';
import { getProjects } from '@nx/devkit';
import {
  addSharedTypesNpmWorkspace,
  addSharedTypesWorkspaceGlob,
  detectYarnFlavor,
  packageManagerCommands,
  applyBoundaryConstraints,
  buildBoundarySnippet,
  composeBackendWiring,
  ESLINT_CONFIG_CANDIDATES,
  readBoundaryTags,
  readSharedTypesConfig,
} from '@nx-archweave/template-engine';
import type { AddBackendGeneratorSchema } from './schema.d.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import { readToolkitConfig, readToolkitConfigFile, TOOLKIT_CONFIG_PATH, treePackageManager } from '../shared/toolkit-config-file.ts';
import { appendJsonArrayItem, applyJsonEdits, setJsonValue } from '../shared/json-edit.ts';
import { resolveProjectType } from '../shared/project-type.ts';
import { renderAddBackendReport, type AddBackendReport, type TagResult } from './render.ts';

export interface AddBackendOptions {
  backend: 'express' | 'nest';
  apiName?: string;
  /** Escape hatch for workspaces with several apps — skips the auto-detection. */
  frontendProject?: string;
  applyEslint?: boolean;
  dryRun?: boolean;
}

interface ParsedTagFile {
  path: string;
  raw: string;
  /** 'project' → tags at parsed.tags; 'package' → tags at parsed.nx.tags
   * (the fullstack template's apps are package.json projects — E2E finding). */
  kind: 'project' | 'package';
  parsed: { tags?: string[]; nx?: { tags?: string[] } } & Record<string, unknown>;
}

/**
 * Orchestration core. Like every other run* core: a
 * failed precondition is a refusal REPORT, never a throw, and a refusal writes
 * nothing. Every target file is read AND parsed before the first write, so a
 * broken project.json can never leave a half-wired tree behind. The official
 * @nx generator is never invoked here — when the api app is missing, the
 * report carries the exact commands to run instead.
 */
export function runAddBackend(tree: Tree, options: AddBackendOptions): AddBackendReport {
  const backend = options.backend;
  const apiName = options.apiName ?? 'api';
  const applyEslint = options.applyEslint ?? false;
  const dryRun = options.dryRun ?? false;
  const write = !dryRun;

  const base = { backend, apiName } as const;
  const refusalShape: Pick<AddBackendReport, 'sharedTypes' | 'tags' | 'tsconfigPaths' | 'eslint'> = {
    sharedTypes: 'skipped',
    tags: [],
    tsconfigPaths: 'unrecognized',
    eslint: 'snippet-only',
  };

  // devkit's getProjects throws on ANY unparseable project.json — fold that
  // into the refusal contract instead of letting it escape as an exception.
  let projects: ReturnType<typeof getProjects>;
  try {
    projects = getProjects(tree);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const pathMatch = /Cannot parse ([^:]+):/.exec(message);
    return {
      ...base,
      refused: 'invalid-project-json',
      invalidProjects: [pathMatch ? pathMatch[1] : message],
      ...refusalShape,
    };
  }

  // --- frontend resolution: explicit option first, then auto-detection ---
  // Matching is by the project ROOT's basename, not the project name: Nx's
  // fullstack template names its projects with an npm scope (@org/api,
  // @org/shop) while their directories stay apps/api, apps/shop (E2E
  // finding, 2026-10-05). The directory is the convention we own.
  const detectedPm = treePackageManager(tree, readToolkitConfig(tree));
  const packageManager = detectedPm ?? 'pnpm';
  const pmCommands = packageManagerCommands(
    packageManager,
    packageManager === 'yarn' ? detectYarnFlavor((p) => tree.exists(p), (p) => tree.read(p, 'utf-8')) : undefined,
  );
  const packageManagerNote =
    detectedPm === null
      ? 'the package manager could not be detected (no pnpm, yarn, bun or npm markers) — commands below assume pnpm.'
      : undefined;
  const baseNameOf = (root: string): string => root.split('/').pop() ?? root;
  // Two tiers, so inference never changes a workspace that already worked:
  // declared applications first; only when a lookup finds none there do
  // UNDECLARED projects count, typed the way Nx itself infers them — classic-
  // preset Nx 23 apps are bare package.json projects (2026-10-14 finding). The
  // workspace root is never inferred (a root package.json with an `nx` field is a
  // project, and Nx's rule would call it an application).
  type Entry = [string, ProjectConfiguration];
  const entries: Entry[] = [...projects.entries()];
  const declaredApp = ([, config]: Entry): boolean => config.projectType === 'application';
  const inferredApp = ([, config]: Entry): boolean =>
    config.projectType === undefined &&
    config.root !== '' &&
    config.root !== '.' &&
    resolveProjectType(tree, config.root, undefined) === 'application';
  const apiNamed = entries.filter(([, config]) => baseNameOf(config.root) === apiName);
  // An inferred api must also carry tsconfig.app.json — every official backend
  // app generator emits one, a types-only package named `api` does not.
  const apiEntry =
    apiNamed.find(declaredApp) ??
    apiNamed.find((entry) => inferredApp(entry) && tree.exists(`${entry[1].root}/tsconfig.app.json`));

  // undefined = a backend-only workspace: no frontend app, an api app to wire.
  let frontendProject: string | undefined;
  if (options.frontendProject !== undefined) {
    if (!projects.has(options.frontendProject)) {
      return { ...base, refused: 'frontend-not-found', frontendProject: options.frontendProject, ...refusalShape };
    }
    frontendProject = options.frontendProject;
  } else {
    const eligible = entries.filter(([, config]) => {
      const dir = baseNameOf(config.root);
      return dir !== apiName && dir !== 'e2e' && !dir.endsWith('-e2e');
    });
    const declared = eligible.filter(declaredApp);
    const candidates = (declared.length > 0 ? declared : eligible.filter(inferredApp)).map(([name]) => name).sort();
    if (candidates.length === 0 && !apiEntry) {
      return { ...base, refused: 'no-frontend', ...refusalShape };
    }
    if (candidates.length > 1) {
      return { ...base, refused: 'ambiguous-frontend', frontendCandidates: candidates, ...refusalShape };
    }
    // No frontend but the api app is there: a backend-only workspace (Nx's express/nest
    // preset). It gets the same wiring minus the frontend tag; the deny rules then guard
    // whichever frontend joins later.
    frontendProject = candidates[0];
  }

  if (!apiEntry) {
    // Without an api there is no backend-only reading: a frontend was found above.
    if (frontendProject === undefined) return { ...base, refused: 'no-frontend', ...refusalShape };
    // Pin the copy-paste install to the workspace's nx version when known —
    // the same version the CLI pins against.
    let nxPin = '';
    let expressDeclared = false;
    const rootPkgRaw = tree.read('package.json', 'utf-8');
    if (rootPkgRaw !== null) {
      try {
        const pkg = JSON.parse(rootPkgRaw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const nxVersion = pkg.devDependencies?.['nx'] ?? pkg.dependencies?.['nx'];
        // only a real version/range pins — 'catalog:', 'workspace:*', 'latest'
        // would render a broken or wrong command
        if (nxVersion && /^[~^]?\d/.test(nxVersion)) nxPin = `@${nxVersion}`;
        // dependencies/devDependencies only — an express pinned through a pnpm
        // catalog, overrides or peerDependencies is not seen, which only costs one
        // redundant (harmless) express line below.
        expressDeclared = pkg.dependencies?.['express'] !== undefined || pkg.devDependencies?.['express'] !== undefined;
      } catch {
        // unreadable root package.json — fall back to the unpinned command
      }
    }
    // Since Nx 20 the generator's positional is a DIRECTORY relative to the
    // workspace root. Put the api beside the frontend (apps/web → apps/api, web → api); a
    // frontend at the workspace root itself gets apps/api. The lookup above matches by basename.
    const frontendRoot = projects.get(frontendProject)?.root ?? '';
    const frontendParent = frontendRoot.split('/').slice(0, -1).join('/');
    const apiDirectory =
      frontendRoot === '' || frontendRoot === '.' ? `apps/${apiName}` : `${frontendParent === '' ? '' : `${frontendParent}/`}${apiName}`;
    // @nx/express's init adds express@^5 unless express is already declared, while
    // @nx/react (23.2/23.3) peers on express ^4.21.2 — npm refuses that tree
    // (ERESOLVE). Declaring express in @nx/react's own range first makes the
    // official generator keep it and pick the matching @types/express.
    const expressAlignment = backend === 'express' && !expressDeclared ? readExpressPeerRange(tree) : undefined;
    const quotedExpress = expressAlignment ? `"express@${expressAlignment}"` : undefined;
    return {
      ...base,
      refused: 'missing-api-project',
      frontendProject,
      ...(expressAlignment !== undefined ? { expressRange: expressAlignment } : {}),
      commands: [
        pmCommands.addDevAtRoot(`@nx/${backend}${nxPin}`),
        ...(quotedExpress ? [pmCommands.addAtRoot(quotedExpress)] : []),
        `${pmCommands.runNx} g @nx/${backend}:application ${apiDirectory} --frontendProject=${frontendProject}`,
      ],
      ...refusalShape,
    };
  }

  // --- pre-flight: parse every file this run will touch, BEFORE any write ---
  // package.json is the current shape; project.json covers libs created by older builds
  // toolkit.config.json may name the role tags (boundaries.tags) and where the shared-types
  // lib goes (sharedTypes: { path, importPath }) — or that there is none (sharedTypes: false).
  const recordedConfig = readToolkitConfigFile(tree).parsed;
  const boundaryTags = readBoundaryTags(recordedConfig);
  const sharedTypesConfig = readSharedTypesConfig(recordedConfig);
  const withSharedTypes = sharedTypesConfig !== false;
  const sharedTypesRoot = sharedTypesConfig === false ? '' : sharedTypesConfig.path;
  const sharedTypesExists =
    withSharedTypes && (tree.exists(`${sharedTypesRoot}/package.json`) || tree.exists(`${sharedTypesRoot}/project.json`));
  const rootPackageJson = tree.read('package.json', 'utf-8');
  const workspaceName = rootPackageJson
    ? ((JSON.parse(rootPackageJson) as { name?: string }).name ?? 'workspace')
    : 'workspace';
  const wiring = composeBackendWiring({ workspaceName, tags: boundaryTags, ...(sharedTypesConfig === false ? {} : { sharedTypes: sharedTypesConfig }) });
  const [apiProjectName, apiConfig] = apiEntry;
  const tagTargets: { project: string; root: string }[] = [
    ...(frontendProject === undefined
      ? []
      : [{ project: frontendProject, root: projects.get(frontendProject)?.root ?? `apps/${frontendProject}` }]),
    { project: apiProjectName, root: apiConfig.root },
  ];
  if (sharedTypesExists) tagTargets.push({ project: wiring.sharedTypesPackageName, root: sharedTypesRoot });

  const parsedTargets = new Map<string, ParsedTagFile>();
  const invalidProjects: string[] = [];
  for (const target of tagTargets) {
    const projectJsonPath = `${target.root}/project.json`;
    const packageJsonPath = `${target.root}/package.json`;
    const kind: ParsedTagFile['kind'] = tree.exists(projectJsonPath) ? 'project' : 'package';
    const path = kind === 'project' ? projectJsonPath : packageJsonPath;
    const raw = tree.read(path, 'utf-8');
    if (raw === null) {
      invalidProjects.push(path);
      continue;
    }
    try {
      parsedTargets.set(target.project, { path, raw, kind, parsed: JSON.parse(raw) as ParsedTagFile['parsed'] });
    } catch {
      invalidProjects.push(path);
    }
  }
  if (invalidProjects.length > 0) {
    return { ...base, refused: 'invalid-project-json', frontendProject, invalidProjects, ...refusalShape };
  }

  // --- wiring (E2E-measured: package-link is the wiring) ---
  const sharedTypes: AddBackendReport['sharedTypes'] = !withSharedTypes ? 'disabled' : sharedTypesExists ? 'skipped' : 'created';
  if (sharedTypes === 'created' && write) {
    for (const file of wiring.sharedTypesFiles) tree.write(file.filePath, file.content);
  }

  // toolkit.config.json: persist the backend axis so doctor's backend checks
  // gate open — merge-preserving, idempotent.
  let configOutcome: AddBackendReport['config'] = 'unchanged';
  {
    const { raw: configRaw, parsed: configParsed } = readToolkitConfigFile(tree);
    // an unreadable or non-object file is left alone and reported unchanged
    const parseOk = configRaw === null || configParsed !== null;
    const existing = configParsed ?? {};
    if (parseOk && existing['backend'] !== backend) {
      configOutcome = configRaw === null ? 'created' : 'updated';
      if (write) tree.write(TOOLKIT_CONFIG_PATH, applyJsonEdits(configRaw, [[['backend'], backend]]));
    }
  }

  // Workspace registration — the link that makes the import resolve. The
  // pnpm file wins when present (detection priority); an npm, yarn
  // or bun workspace registers in the root package.json's workspaces field instead
  // (all three read it; only a detected manager is written for).
  let workspaceGlob: AddBackendReport['workspaceGlob'] = withSharedTypes ? 'unrecognized' : undefined;
  const workspaceYaml = withSharedTypes ? tree.read('pnpm-workspace.yaml', 'utf-8') : null;
  if (!withSharedTypes) {
    // no shared-types lib, nothing to register
  } else if (workspaceYaml !== null) {
    const globResult = addSharedTypesWorkspaceGlob(workspaceYaml, sharedTypesRoot);
    workspaceGlob = globResult.status;
    if (globResult.status === 'added' && write) tree.write('pnpm-workspace.yaml', globResult.text);
  } else if ((detectedPm === 'npm' || detectedPm === 'yarn' || detectedPm === 'bun') && rootPackageJson !== null) {
    // yarn 1 refuses workspaces unless the root is "private": true — Nx roots set it;
    // a hand-made root without it is reported, not written.
    const yarnNeedsPrivate = detectedPm === 'yarn' && (JSON.parse(rootPackageJson) as { private?: unknown }).private !== true;
    const npmResult = yarnNeedsPrivate ? ({ status: 'unrecognized' } as const) : addSharedTypesNpmWorkspace(rootPackageJson, sharedTypesRoot);
    workspaceGlob = npmResult.status;
    if (npmResult.status === 'added' && write) tree.write('package.json', npmResult.text);
  }

  const mergeTag = (project: string, tag: string): TagResult => {
    const target = parsedTargets.get(project);
    if (!target) return { project, action: 'added' }; // shared-types freshly created — tag ships in the template
    const holder = target.kind === 'project' ? target.parsed : (target.parsed.nx ??= {});
    const tags = holder.tags ?? [];
    if (tags.includes(tag)) return { project, action: 'present' };
    holder.tags = [...tags, tag];
    target.raw = appendJsonArrayItem(target.raw, target.kind === 'project' ? ['tags'] : ['nx', 'tags'], tag);
    if (write) tree.write(target.path, target.raw);
    return { project, action: 'added' };
  };
  const tags: TagResult[] = [
    ...(frontendProject === undefined ? [] : [mergeTag(frontendProject, wiring.tagByRole.frontend)]),
    mergeTag(apiProjectName, wiring.tagByRole.backend),
    ...(withSharedTypes ? [mergeTag(wiring.sharedTypesPackageName, wiring.tagByRole.shared)] : []),
  ];

  // tsconfig.base.json path alias — for classic setups that carry a baseUrl, and for
  // integrated ones that resolve libs through `paths` without one (Nx 23's nest preset:
  // `paths: {}`, no baseUrl, no workspace packages — measured 2026-10-16); there the
  // target is written relative ("./…"), which TS accepts without a baseUrl. The modern
  // TS setup has neither (a bare non-relative target there is TS5090, E2E-measured), and
  // the workspace link above IS the wiring.
  let tsconfigPaths: AddBackendReport['tsconfigPaths'] = withSharedTypes ? 'workspace-link' : 'none';
  const tsconfigRaw = withSharedTypes ? tree.read('tsconfig.base.json', 'utf-8') : null;
  if (tsconfigRaw !== null) {
    try {
      const tsconfig = JSON.parse(tsconfigRaw) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
      const baseUrl = tsconfig.compilerOptions?.baseUrl;
      if (tsconfig.compilerOptions && (baseUrl || tsconfig.compilerOptions.paths !== undefined)) {
        const paths = tsconfig.compilerOptions.paths ?? {};
        if (paths[wiring.sharedTypesPackageName]) {
          tsconfigPaths = 'present';
        } else {
          tsconfigPaths = 'added';
          const entry = [`${baseUrl ? '' : './'}${sharedTypesRoot}/src/index.ts`];
          if (write) tree.write('tsconfig.base.json', setJsonValue(tsconfigRaw, ['compilerOptions', 'paths', wiring.sharedTypesPackageName], entry));
        }
      }
    } catch {
      tsconfigPaths = 'unrecognized';
    }
  }

  // ESLint constraints — write only on explicit opt-in
  let eslint: AddBackendReport['eslint'];
  let snippet: string | undefined;
  if (!applyEslint) {
    eslint = 'snippet-only';
    snippet = buildBoundarySnippet(boundaryTags);
  } else {
    const configPath = ESLINT_CONFIG_CANDIDATES.find((candidate) => tree.exists(candidate));
    const configText = configPath ? tree.read(configPath, 'utf-8') : null;
    const result = configText !== null ? applyBoundaryConstraints(configText, boundaryTags) : ({ status: 'unrecognized' } as const);
    if (result.status === 'applied') {
      eslint = 'applied';
      if (write && configPath) tree.write(configPath, result.text);
    } else if (result.status === 'already-applied') {
      eslint = 'already-applied';
    } else {
      eslint = 'degraded-unrecognized';
      snippet = buildBoundarySnippet(boundaryTags);
    }
  }

  return {
    ...base,
    frontendProject,
    sharedTypes,
    tags,
    workspaceGlob,
    tsconfigPaths,
    eslint,
    snippet,
    sharedTypesPackage: withSharedTypes ? wiring.sharedTypesPackageName : undefined,
    sharedTypesRoot: withSharedTypes ? sharedTypesRoot : undefined,
    config: configOutcome,
    packageManager,
    ...(packageManagerNote !== undefined ? { packageManagerNote } : {}),
  };
}

/** The express range the installed @nx/react declares as a peer, if any — read
 * from node_modules so a widened range needs no change here. No @nx/react (or no
 * express peer) means nothing for @nx/express's express@^5 to conflict with, so
 * no line is needed. */
function readExpressPeerRange(tree: Tree): string | undefined {
  const raw = tree.read('node_modules/@nx/react/package.json', 'utf-8');
  if (raw === null) return undefined;
  try {
    const range = (JSON.parse(raw) as { peerDependencies?: Record<string, unknown> }).peerDependencies?.['express'];
    return typeof range === 'string' && range.trim().length > 0 ? range.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function addBackendGenerator(tree: Tree, options: AddBackendGeneratorSchema): Promise<void> {
  const dryRun = resolveDryRun(options);
  const report = runAddBackend(tree, { ...options, dryRun });
  console.log(renderAddBackendReport(report, dryRun));
}

export default addBackendGenerator;
