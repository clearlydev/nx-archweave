import { getProjects, type ProjectConfiguration, type Tree } from '@nx/devkit';
import type { ToolkitFrontend } from '@nx-archweave/shared';
import { detectFramework, readBoundaryTags } from '@nx-archweave/template-engine';
import { readToolkitConfig } from './toolkit-config-file.ts';
import { resolveProjectType } from './project-type.ts';

/** Where the FSD generators put layers: the frontend app's source root, never the workspace
 * root's `src/` (which belongs to no project, so nothing lints, type-checks or builds it). */
export type FrontendAppResolution =
  /** `inferredRoot`: a root package.json Nx itself does not list (no `nx` key), taken because
   * its framework was recognised at the workspace root. */
  | { kind: 'found'; project: string; root: string; sourceRoot: string; framework: ToolkitFrontend; inferredRoot?: true }
  /** `--project` names a project the workspace does not have. */
  | { kind: 'not-found'; project: string }
  /** More than one frontend app — `--project` picks one. */
  | { kind: 'ambiguous'; candidates: string[] }
  /** No frontend app. `otherProjects` are the projects that were not taken for one — the names
   * `--project` accepts if one of them is the app after all. */
  | { kind: 'none'; otherProjects: string[] }
  /** A project.json devkit cannot parse (getProjects throws on any). */
  | { kind: 'invalid-project-json'; detail: string };

const baseNameOf = (root: string): string => root.split('/').pop() ?? root;

function isEndToEnd(root: string): boolean {
  const dir = baseNameOf(root);
  return dir === 'e2e' || dir.endsWith('-e2e');
}

/** add-backend's api app (default name `api`) and anything carrying the backend tag
 * (`boundaries.tags.backend`, `scope:backend` by default) are applications, but not frontends. */
function isBackend(root: string, config: ProjectConfiguration, backendTag: string): boolean {
  return baseNameOf(root) === 'api' || (config.tags ?? []).includes(backendTag);
}

function prefixOf(root: string): string {
  return root === '' || root === '.' ? '' : `${root}/`;
}

/** Where the layers go: the declared sourceRoot — except that one equal to the project root
 * means the app's src/ when it has one (Nx's Next.js apps declare the project root) — else
 * `<root>/src`. */
export function sourceRootOf(tree: Tree, config: ProjectConfiguration): string {
  const prefix = prefixOf(config.root);
  const declared = config.sourceRoot?.replace(/\/$/, '');
  const atRoot = declared !== undefined && (declared === config.root || (prefix === '' && (declared === '.' || declared === '')));
  if (declared && !atRoot) return declared;
  if (atRoot && !tree.exists(`${prefix}src`)) return prefix === '' ? '.' : config.root;
  return `${prefix}src`;
}

function frameworkOf(tree: Tree, config: ProjectConfiguration): ReturnType<typeof detectFramework> {
  return detectFramework({
    exists: (path) => tree.exists(path),
    read: (path) => tree.read(path, 'utf-8'),
    projectRoot: config.root,
    executors: Object.values(config.targets ?? {}).flatMap((target) => (target.executor ? [target.executor] : [])),
  });
}

/**
 * Same two tiers as add-backend's frontend lookup: declared applications first; only when
 * there are none do undeclared projects count, typed the way Nx infers them (Nx's Next.js
 * and classic-preset apps are bare package.json projects). A declared root application
 * (a standalone workspace, root `.`) counts; an undeclared root package.json never does.
 */
export function resolveFrontendApp(tree: Tree, explicitProject: string | undefined): FrontendAppResolution {
  let projects: ReturnType<typeof getProjects>;
  try {
    projects = getProjects(tree);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const pathMatch = /Cannot parse ([^:]+):/.exec(message);
    return { kind: 'invalid-project-json', detail: pathMatch ? pathMatch[1] : message };
  }

  const found = (project: string, config: ProjectConfiguration): FrontendAppResolution => ({
    kind: 'found',
    project,
    root: config.root,
    sourceRoot: sourceRootOf(tree, config),
    framework: frameworkOf(tree, config).id,
  });

  if (explicitProject !== undefined) {
    const config = projects.get(explicitProject);
    if (config) return found(explicitProject, config);
    const rootApp = inferredRootApp(tree, projects);
    return rootApp?.kind === 'found' && rootApp.project === explicitProject ? rootApp : { kind: 'not-found', project: explicitProject };
  }

  const backendTag = readBoundaryTags(readToolkitConfig(tree)).backend;
  const eligible = [...projects.entries()].filter(([, config]) => !isEndToEnd(config.root) && !isBackend(config.root, config, backendTag));
  const declared = eligible.filter(([, config]) => config.projectType === 'application');
  // An undeclared project counts when Nx would call it an application — except the root
  // package.json, which every workspace has: that one only when its framework is recognised
  // (a repository `nx init` turned into a workspace).
  const inferred = eligible.filter(([, config]) => {
    if (config.projectType !== undefined) return false;
    if (config.root === '' || config.root === '.') return frameworkOf(tree, config).recognised;
    return resolveProjectType(tree, config.root, undefined) === 'application';
  });
  const candidates = (declared.length > 0 ? declared : inferred).sort(([a], [b]) => a.localeCompare(b));

  if (candidates.length === 0) {
    const rootApp = inferredRootApp(tree, projects);
    if (rootApp !== null) return rootApp;
    const otherProjects = [...projects.keys()].filter((name) => !isEndToEnd(projects.get(name)?.root ?? '')).sort();
    return { kind: 'none', otherProjects };
  }
  if (candidates.length > 1) return { kind: 'ambiguous', candidates: candidates.map(([name]) => name) };
  const [project, config] = candidates[0];
  return found(project, config);
}

/** A root package.json Nx does not list as a project (no `nx` key) whose framework is recognised
 * at the workspace root — a plain app repository opened as a workspace. */
function inferredRootApp(tree: Tree, projects: Map<string, ProjectConfiguration>): FrontendAppResolution | null {
  if ([...projects.values()].some((config) => config.root === '' || config.root === '.')) return null;
  const raw = tree.read('package.json', 'utf-8');
  if (raw === null) return null;
  let name: unknown;
  try {
    name = (JSON.parse(raw) as { name?: unknown }).name;
  } catch {
    return null;
  }
  if (typeof name !== 'string' || name === '') return null;
  const config: ProjectConfiguration = { name, root: '.' };
  const framework = frameworkOf(tree, config);
  if (!framework.recognised) return null;
  return { kind: 'found', project: name, root: '.', sourceRoot: sourceRootOf(tree, config), framework: framework.id, inferredRoot: true };
}
