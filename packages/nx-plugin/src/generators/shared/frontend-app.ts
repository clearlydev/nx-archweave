import { getProjects, type ProjectConfiguration, type Tree } from '@nx/devkit';
import { resolveProjectType } from './project-type.ts';

/** Where the FSD generators put layers: the frontend app's source root, never the workspace
 * root's `src/` (which belongs to no project, so nothing lints, type-checks or builds it). */
export type FrontendAppResolution =
  | { kind: 'found'; project: string; root: string; sourceRoot: string }
  /** `--project` names a project the workspace does not have. */
  | { kind: 'not-found'; project: string }
  /** More than one frontend app — `--project` picks one. */
  | { kind: 'ambiguous'; candidates: string[] }
  /** No frontend app at all. */
  | { kind: 'none' }
  /** A project.json devkit cannot parse (getProjects throws on any). */
  | { kind: 'invalid-project-json'; detail: string };

const baseNameOf = (root: string): string => root.split('/').pop() ?? root;

function isEndToEnd(root: string): boolean {
  const dir = baseNameOf(root);
  return dir === 'e2e' || dir.endsWith('-e2e');
}

/** add-backend's api app (default name `api`) and anything tagged as the backend scope are
 * applications, but not frontends. */
function isBackend(root: string, config: ProjectConfiguration): boolean {
  return baseNameOf(root) === 'api' || (config.tags ?? []).includes('scope:backend');
}

function sourceRootOf(config: ProjectConfiguration): string {
  if (config.sourceRoot) return config.sourceRoot;
  return config.root === '' || config.root === '.' ? 'src' : `${config.root}/src`;
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
    sourceRoot: sourceRootOf(config),
  });

  if (explicitProject !== undefined) {
    const config = projects.get(explicitProject);
    return config ? found(explicitProject, config) : { kind: 'not-found', project: explicitProject };
  }

  const eligible = [...projects.entries()].filter(([, config]) => !isEndToEnd(config.root) && !isBackend(config.root, config));
  const declared = eligible.filter(([, config]) => config.projectType === 'application');
  const inferred = eligible.filter(
    ([, config]) =>
      config.projectType === undefined &&
      config.root !== '' &&
      config.root !== '.' &&
      resolveProjectType(tree, config.root, undefined) === 'application',
  );
  const candidates = (declared.length > 0 ? declared : inferred).sort(([a], [b]) => a.localeCompare(b));

  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length > 1) return { kind: 'ambiguous', candidates: candidates.map(([name]) => name) };
  const [project, config] = candidates[0];
  return found(project, config);
}
