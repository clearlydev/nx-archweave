import { getProjects, joinPathFragments, type Tree } from '@nx/devkit';
import { createDoctorCheck, type DoctorCheck } from '@nx-archweave/shared';
import type { DoctorProject } from '@nx-archweave/template-engine';
import { indexFilePattern } from '../../eslint/fsd-boundaries.ts';
import { resolveFsdPolicy } from '../../eslint/fsd-policy.ts';
import { createGroupDetector } from '../../eslint/slice-groups.ts';
import { resolveFrontendApp, sourceRootOf } from '../shared/frontend-app.ts';
import { detectUnitTestRunner } from '../slice/core.ts';
import { readToolkitConfig, recordedFrontends } from '../shared/toolkit-config-file.ts';

/** The workspace's projects as Nx lists them, for the checks that used to scan fixed folders;
 * undefined when a project.json cannot be parsed (those checks then fall back to the scan). */
export function doctorProjects(tree: Tree): DoctorProject[] | undefined {
  try {
    return [...getProjects(tree).entries()]
      .map(([name, config]) => ({ name, root: config.root, sourceRoot: sourceRootOf(tree, config), tags: config.tags ?? [] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return undefined;
  }
}

const SLICED_LAYER_DIRS = ['pages', '_pages', 'widgets', 'features', 'entities'];
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
/** Enough files to see a pattern, few enough to stay quick on a large app. */
const SCAN_LIMIT = 2000;

function sourceFiles(tree: Tree, dir: string, out: string[] = []): string[] {
  for (const name of tree.children(dir)) {
    if (out.length >= SCAN_LIMIT) break;
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = joinPathFragments(dir, name);
    if (tree.isFile(path)) {
      if (SOURCE_FILE.test(name)) out.push(path);
    } else {
      sourceFiles(tree, path, out);
    }
  }
  return out;
}

/** What doctor can tell from the frontend app itself: where it is, its framework, the slice
 * groups the rule will see, the test runner the slice generators will find, and whether the
 * code's imports into shared fit the configured public-API unit. */
export function buildWorkspaceChecks(tree: Tree): DoctorCheck[] {
  const config = readToolkitConfig(tree);
  if (config?.['frontend'] === 'none') return [];
  const app = resolveFrontendApp(tree, undefined);

  const recorded = recordedFrontends(config);
  if (app.kind === 'ambiguous' && app.candidates.every((name) => recorded.includes(name))) {
    // init --project recorded them: the generators and a bare init rerun know which apps
    return [
      createDoctorCheck({
        id: 'frontend-resolution',
        label: 'Frontend app',
        status: 'pass',
        message: `${app.candidates.length} frontend apps, recorded in toolkit.config.json's frontends (pass --project to the slice generators)`,
        evidence: app.candidates,
      }),
    ];
  }
  if (app.kind !== 'found') {
    const resolution =
      app.kind === 'ambiguous'
        ? createDoctorCheck({
            id: 'frontend-resolution',
            label: 'Frontend app',
            status: 'warning',
            message: `${app.candidates.length} frontend apps — the FSD generators and init need to be told which one`,
            evidence: app.candidates,
            suggestedAction: `Pass --project=<name> to add-fsd-lite and the slice generators (e.g. --project=${app.candidates[0]}).`,
          })
        : app.kind === 'none'
          ? createDoctorCheck({
              id: 'frontend-resolution',
              label: 'Frontend app',
              status: 'warning',
              message: 'no project was recognised as a frontend app',
              evidence: app.otherProjects,
              suggestedAction:
                app.otherProjects.length > 0 ? 'If one of the listed projects is the app, pass --project=<name>.' : 'Create a frontend app (nx g @nx/react:app or @nx/next:app).',
            })
          : createDoctorCheck({
              id: 'frontend-resolution',
              label: 'Frontend app',
              status: 'error',
              message: app.kind === 'invalid-project-json' ? `a project file could not be parsed (${app.detail})` : `--project ${app.project} not found`,
              evidence: [],
            });
    return [resolution];
  }

  const checks: DoctorCheck[] = [
    createDoctorCheck({
      id: 'frontend-resolution',
      label: 'Frontend app',
      status: 'pass',
      message: `${app.project}${app.inferredRoot ? ' (the workspace root package)' : ''} — FSD layers live in ${app.sourceRoot}`,
      evidence: [app.project],
    }),
    app.framework === 'generic'
      ? createDoctorCheck({
          id: 'framework-profile',
          label: 'Frontend framework',
          status: 'warning',
          message: 'framework not recognised — the common FSD rules apply, with no framework-specific layer names',
          evidence: [app.project],
          suggestedAction: 'If it is React on Vite or Next.js, pass --frontend=react-vite|next (init records it).',
        })
      : createDoctorCheck({ id: 'framework-profile', label: 'Frontend framework', status: 'pass', message: app.framework, evidence: [app.project] }),
  ];

  const policy = resolveFsdPolicy(config?.['fsd']);
  if (policy.sliceGroups !== false) {
    const lister = (dir: string) => (tree.exists(dir) ? tree.children(dir).map((name) => ({ name, directory: !tree.isFile(joinPathFragments(dir, name)) })) : null);
    const isGroup = createGroupDetector(app.sourceRoot, policy, (name) => indexFilePattern(policy.platformSuffixes).test(name), lister);
    const groups = SLICED_LAYER_DIRS.flatMap((layer) =>
      tree.exists(joinPathFragments(app.sourceRoot, layer)) ? tree.children(joinPathFragments(app.sourceRoot, layer)).filter((name) => isGroup(layer, name)).map((name) => `${layer}/${name}`) : [],
    );
    checks.push(
      createDoctorCheck({
        id: 'slice-groups',
        label: 'Slice groups',
        status: 'pass',
        message: groups.length === 0 ? 'no slice groups found' : `the FSD rule treats ${groups.length === 1 ? 'this folder' : 'these folders'} as groups of separate slices`,
        evidence: groups,
      }),
    );
  }

  const runner = detectUnitTestRunner(tree, app.root);
  checks.push(
    runner === 'none'
      ? createDoctorCheck({
          id: 'test-runner',
          label: 'Test runner',
          status: 'warning',
          message: 'no jest or vitest found — the slice generators write no .spec.ts',
          evidence: [],
          suggestedAction: 'Add a test runner, or pass --unitTestRunner=jest|vitest to the slice generators.',
        })
      : createDoctorCheck({ id: 'test-runner', label: 'Test runner', status: 'pass', message: `${runner} — the slice generators write a .spec.ts`, evidence: [] }),
  );

  checks.push(buildPolicySuggestion(tree, app.sourceRoot, policy.sharedPublicApi));
  return checks;
}

/** Imports into shared that stop at a segment (`shared/ui`) against ones that reach further
 * (`shared/ui/button`, `shared/lib/format/currency`). With `segment`, the rule reports every
 * one of the latter; when they are most of them, a wider unit fits the code. */
function buildPolicySuggestion(tree: Tree, sourceRoot: string, current: 'segment' | 'component' | 'file'): DoctorCheck {
  const id = 'fsd-policy-suggestion';
  const label = 'Shared public API';
  let atSegment = 0;
  let deeper = 0;
  let examples: string[] = [];
  for (const file of sourceFiles(tree, sourceRoot)) {
    if (/(^|\/)shared\//.test(file.slice(sourceRoot.length))) continue;
    const text = tree.read(file, 'utf-8') ?? '';
    for (const [, specifier] of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const match = /(?:^|\/|@\/)shared\/(.+)$/.exec(specifier);
      if (match === null) continue;
      const parts = match[1].split('/').filter((part) => part !== '' && !/^index(\.[\w.]+)?$/.test(part));
      if (parts.length <= 1) atSegment++;
      else {
        deeper++;
        if (examples.length < 3) examples = [...examples, specifier];
      }
    }
  }
  if (current !== 'segment' || deeper === 0 || deeper < atSegment) {
    return createDoctorCheck({ id, label, status: 'pass', message: `sharedPublicApi: ${current} fits the imports found`, evidence: [] });
  }
  return createDoctorCheck({
    id,
    label,
    status: 'warning',
    message: `${deeper} of ${deeper + atSegment} imports into shared reach past a segment's index — with sharedPublicApi: segment the FSD rule reports each`,
    evidence: examples,
    suggestedAction: 'If that is how this code is meant to be organised, set "fsd": { "sharedPublicApi": "file" } (or "component") in toolkit.config.json.',
  });
}
