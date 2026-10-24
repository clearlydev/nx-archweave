import { join } from 'node:path';
import type { Tree } from '@nx/devkit';
import type { ToolkitFrontend, ToolkitLocale } from '@nx-archweave/shared';
import {
  isEssenceSegmentName,
  isUsableSliceApiName,
  resolveSlicePublicApiName,
  SEGMENT_NAME_PATTERN,
  profileById,
  type FsdLayer,
  type FsdSliceLayer,
} from '@nx-archweave/template-engine';
import type { SliceAction, SliceRefusalReason, SliceReport } from './render.ts';
import { readToolkitConfig, RECORDED_FRONTENDS, recordedFrontends, resolveLocaleOption } from '../shared/toolkit-config-file.ts';
import { resolveFrontendApp } from '../shared/frontend-app.ts';
import { generatorFilesDir, renderTemplateFiles, type RenderedFile } from '../shared/template-files.ts';

interface SlicePlan {
  directory: string;
  publicApiName: string;
  files: RenderedFile[];
}

/**
 * A slice on a sliced layer, from this generator's `files/`:
 *   <src>/<layer>/<name>/index.ts             public API          (files/index)
 *   <src>/<layer>/<name>/model/<name>.ts      the stub            (files/module)
 *   <src>/<layer>/<name>/model/<name>.spec.ts
 *   <src>/<layer>/<name>/<segment>/index.ts   per --segments      (files/segment)
 * A shared segment holds no segments of its own, so its stub sits next to the index.
 */
export function composeSlice(input: {
  layer: FsdSliceLayer;
  name: string;
  publicApiName: string;
  locale: ToolkitLocale;
  sourceRoot: string;
  layerDirName: string;
  segments: string[];
  /** A slice group folder the slice goes in (`features/<group>/<name>`). */
  group?: string;
  /** False leaves out the model's .spec.ts. Default true. */
  withSpec?: boolean;
}): SlicePlan {
  const files = generatorFilesDir('slice', import.meta.url);
  const directory = `${input.sourceRoot}/${input.layerDirName}/${input.group === undefined ? '' : `${input.group}/`}${input.name}`;
  const shared = input.layer === 'shared';
  const values = {
    name: input.name,
    publicApiName: input.publicApiName,
    layer: input.layer,
    locale: input.locale,
    modulePath: shared ? `./${input.name}` : `./model/${input.name}`,
  };
  const module = renderTemplateFiles(join(files, 'module'), shared ? directory : `${directory}/model`, values)
    .filter((file) => input.withSpec !== false || !file.filePath.endsWith('.spec.ts'))
    // the stub before its test
    .sort((a, b) => Number(a.filePath.endsWith('.spec.ts')) - Number(b.filePath.endsWith('.spec.ts')));
  const segments = shared
    ? []
    : Array.from(new Set(input.segments))
        .filter((segment) => segment !== 'model')
        .flatMap((segment) => renderTemplateFiles(join(files, 'segment'), `${directory}/${segment}`, { ...values, segment }));
  return {
    directory,
    publicApiName: input.publicApiName,
    files: [...renderTemplateFiles(join(files, 'index'), directory, values), ...module, ...segments],
  };
}

/** Shared option shape for `page` / `widget` / `feature` / `entity` / `shared` — each
 * top-level generator's own `schema.d.ts` re-exports this under its own name so the
 * three thin `generator.ts` wrappers stay tiny while every real behavior lives here
 * once — each generator stays a thin Tree adapter over one shared core. */
export interface SliceGeneratorSchema {
  /** Kebab-case slice name, e.g. "add-to-cart". Validated here — never by a JSON
   * schema `pattern` — so an invalid value produces a refusal report instead of a
   * generator-invocation throw (invalid -> refusal report, zero writes). */
  name: string;
  /** Exported stub function name. Defaults to the camelCase form of `name`. */
  publicApiName?: string;
  /** Generated content language. Defaults to toolkit.config.json's locale, else en. */
  locale?: ToolkitLocale;
  /** The frontend app whose source root holds the layers. Defaults to the workspace's one
   * frontend application (the same lookup add-fsd-lite uses). */
  project?: string;
  /** Extra segments to start the slice with (`--segments=ui,api`); `model` always exists.
   * Refused on `shared` (a segment holds no segments). */
  segments?: string[];
  /** Decides the pages layer's directory (`_pages` on Next.js). Omitted: toolkit.config.json's
   * frontend, else detected from the app, else generic (layer names unchanged). Only the
   * `page` generator exposes it — every other layer's directory is the layer id. */
  frontend?: ToolkitFrontend;
  /** A slice group to put the slice in (`features/<group>/<name>`); refused on `shared`. */
  group?: string;
  /** Whether the stub gets a .spec.ts: `auto` (default) writes one when the app or workspace
   * has jest or vitest; toolkit.config.json's `fsd.unitTestRunner` comes before detection. */
  unitTestRunner?: 'auto' | 'jest' | 'vitest' | 'none';
  /** Preview the files that would be generated without writing anything. */
  dryRun?: boolean;
}

/** Lowercase letters/digits, single hyphens, no leading/trailing/doubled hyphen, must
 * start with a letter (so `toCamelCase`/directory names stay valid identifiers). */
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The layer's directory: its id, unless the framework's router owns that name (Next.js reads
 * `src/pages` as its Pages Router, so FSD's Next.js guide puts the pages layer in `_pages/`). */
function layerDirNameFor(layer: FsdSliceLayer, frontend: ToolkitFrontend): string {
  return profileById(frontend).layerDirs[layer as FsdLayer] ?? layer;
}

function layerDirFor(layer: FsdSliceLayer, sourceRoot: string, frontend: ToolkitFrontend = 'react-vite'): string {
  return `${sourceRoot}/${layerDirNameFor(layer, frontend)}`;
}

/** option > toolkit.config.json's frontend (init records it) > what was detected in the app —
 * `generic` when nothing is recognised. Best-effort: it only decides directory names like
 * `_pages`, so a wrong guess costs a rename, never a broken file. */
function resolveFrontendForApp(option: ToolkitFrontend | undefined, config: Record<string, unknown> | null, detected: ToolkitFrontend): ToolkitFrontend {
  if (option !== undefined) return option;
  const recorded = config?.['frontend'];
  if (typeof recorded === 'string' && (RECORDED_FRONTENDS as readonly string[]).includes(recorded) && recorded !== 'none') {
    return recorded as ToolkitFrontend;
  }
  return detected;
}

/** A slice directory is:
 * - 'created' when it doesn't exist yet;
 * - 'unchanged' when it exists and contains exactly our generated files, byte-for-byte;
 * - 'skipped' for anything else (same-name slice already there with different/extra
 *   content — a name collision is a signal to pick a new name; merge is never proposed). */
/** Every file under `dir`, as paths relative to it (the generated set spans model/). */
function listFilesUnder(tree: Tree, dir: string, prefix = ''): string[] {
  return tree.children(dir).flatMap((child) => {
    const path = `${dir}/${child}`;
    return tree.isFile(path) ? [`${prefix}${child}`] : listFilesUnder(tree, path, `${prefix}${child}/`);
  });
}

function computeSliceAction(tree: Tree, plan: { directory: string; files: { filePath: string; content: string }[] }): SliceAction {
  if (!tree.exists(plan.directory)) return 'created';

  const expectedNames = plan.files.map((f) => f.filePath.slice(plan.directory.length + 1)).sort();
  const actualNames = listFilesUnder(tree, plan.directory).sort();
  if (actualNames.length !== expectedNames.length || !actualNames.every((n, i) => n === expectedNames[i])) {
    return 'skipped';
  }

  const allMatch = plan.files.every((f) => tree.read(f.filePath, 'utf-8') === f.content);
  return allMatch ? 'unchanged' : 'skipped';
}

function refusal(
  reason: SliceRefusalReason,
  dryRun: boolean,
  layer: FsdSliceLayer,
  name: string,
  app: { project: string | null; sourceRoot: string },
  extra: Pick<SliceReport, 'candidates' | 'detail' | 'recordedFrontends'> = {},
): SliceReport {
  const layerDir = layerDirFor(layer, app.sourceRoot);
  return {
    dryRun,
    layer,
    name,
    project: app.project,
    layerDir,
    directory: `${layerDir}/${name}`,
    publicApiName: null,
    refused: true,
    refusalReason: reason,
    action: null,
    files: [],
    ...extra,
  };
}

/**
 * Pure core shared by the `page` / `widget` / `feature` / `entity` / `shared` generators.
 * `layer` is fixed per top-level generator — only the option parsing, tree reads, and
 * report shape are shared here.
 *
 * The layer directory (`<app sourceRoot>/<layer>`) appears with its first slice (canonical
 * FSD) — nothing has to exist beforehand but the frontend app.
 */
export function runFsdSlice(tree: Tree, layer: FsdSliceLayer, options: SliceGeneratorSchema): SliceReport {
  const dryRun = options.dryRun ?? false;
  // Placeholder location for refusals raised before an app is picked.
  const unresolved = { project: null, sourceRoot: '<app>/src' };

  if (!KEBAB_CASE.test(options.name)) {
    return refusal('invalid-name', dryRun, layer, options.name, unresolved);
  }

  // Validate the SAME effective value the composer will embed — an explicit
  // publicApiName that isn't an identifier, or a slice name whose camelCase
  // default is a reserved word (e.g. "class", "delete"), would otherwise
  // silently produce syntactically broken TypeScript.
  if (!isUsableSliceApiName(resolveSlicePublicApiName(options.name, options.publicApiName))) {
    return refusal('invalid-public-api-name', dryRun, layer, options.name, unresolved);
  }

  // canonical FSD: a shared segment is named by purpose (ui, api, model, lib, config), never
  // by what it contains.
  if (layer === 'shared' && isEssenceSegmentName(options.name)) {
    return refusal('segment-by-essence', dryRun, layer, options.name, unresolved);
  }

  // --segments: a shared segment holds no segments; elsewhere each
  // name must be a directory-safe name by purpose, like the shared generator's own names.
  const segments = Array.from(new Set(options.segments ?? []));
  if (segments.length > 0 && layer === 'shared') {
    return refusal('segments-on-shared', dryRun, layer, options.name, unresolved);
  }
  const badSegment = segments.find((segment) => !SEGMENT_NAME_PATTERN.test(segment));
  if (badSegment !== undefined) return refusal('invalid-segment', dryRun, layer, options.name, unresolved, { detail: badSegment });
  const essenceSegment = segments.find((segment) => isEssenceSegmentName(segment));
  if (essenceSegment !== undefined) return refusal('segment-by-essence', dryRun, layer, options.name, unresolved, { detail: essenceSegment });

  if (options.group !== undefined && layer === 'shared') return refusal('group-on-shared', dryRun, layer, options.name, unresolved);
  if (options.group !== undefined && (!KEBAB_CASE.test(options.group) || SEGMENT_FOLDERS.includes(options.group) || isEssenceSegmentName(options.group))) {
    return refusal('invalid-group', dryRun, layer, options.name, unresolved, { detail: options.group });
  }

  const app = resolveFrontendApp(tree, options.project);
  if (app.kind === 'not-found') return refusal('project-not-found', dryRun, layer, options.name, { project: app.project, sourceRoot: unresolved.sourceRoot });
  if (app.kind === 'ambiguous') {
    return refusal('ambiguous-frontend', dryRun, layer, options.name, unresolved, { candidates: app.candidates, recordedFrontends: recordedFrontends(readToolkitConfig(tree)) });
  }
  if (app.kind === 'invalid-project-json') return refusal('invalid-project-json', dryRun, layer, options.name, unresolved, { detail: app.detail });
  if (app.kind === 'none') return refusal('no-frontend-app', dryRun, layer, options.name, unresolved, { candidates: app.otherProjects });

  // The layer directory is created with its first slice (canonical FSD) — add-fsd-lite makes
  // no folders. tree.write creates every missing parent.
  const config = readToolkitConfig(tree);
  const frontend = resolveFrontendForApp(options.frontend, config, app.framework);
  const layerDir = layerDirFor(layer, app.sourceRoot, frontend);
  const locale = resolveLocaleOption(options.locale, config);
  const requested = options.unitTestRunner !== undefined && options.unitTestRunner !== 'auto' ? options.unitTestRunner : recordedUnitTestRunner(config);
  const runner = requested ?? detectUnitTestRunner(tree, app.root);
  const plan = composeSlice({
    layer,
    name: options.name,
    publicApiName: resolveSlicePublicApiName(options.name, options.publicApiName),
    locale,
    sourceRoot: app.sourceRoot,
    layerDirName: layerDirNameFor(layer, frontend),
    segments,
    group: options.group,
    withSpec: runner !== 'none',
  });

  const action = computeSliceAction(tree, plan);
  if (action === 'created' && !dryRun) {
    for (const file of plan.files) tree.write(file.filePath, file.content);
  }

  return {
    dryRun,
    layer,
    name: options.name,
    project: app.project,
    layerDir,
    directory: plan.directory,
    publicApiName: plan.publicApiName,
    refused: false,
    refusalReason: null,
    action,
    files: plan.files,
    ...(runner === 'none' ? { specSkipped: requested === 'none' ? ('none-requested' as const) : ('no-test-runner' as const) } : {}),
  };
}

/** Folder names a group may not take: they are segments. */
const SEGMENT_FOLDERS = ['ui', 'model', 'api', 'lib', 'config'];

function recordedUnitTestRunner(config: Record<string, unknown> | null): 'jest' | 'vitest' | 'none' | undefined {
  const fsd = config?.['fsd'];
  const value = typeof fsd === 'object' && fsd !== null ? (fsd as Record<string, unknown>)['unitTestRunner'] : undefined;
  return value === 'jest' || value === 'vitest' || value === 'none' ? value : undefined;
}

function hasDependency(tree: Tree, manifest: string, name: string): boolean {
  const raw = tree.read(manifest, 'utf-8');
  if (raw === null) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown> | undefined>;
    return parsed['dependencies']?.[name] !== undefined || parsed['devDependencies']?.[name] !== undefined;
  } catch {
    return false;
  }
}

/** jest or vitest, from the app's test target executor, then a runner config in the app or at
 * the workspace root (a `test` block in a vite config counts), then a dependency; `none` when
 * nothing says. */
export function detectUnitTestRunner(tree: Tree, projectRoot: string): 'jest' | 'vitest' | 'none' {
  const prefix = projectRoot === '' || projectRoot === '.' ? '' : `${projectRoot}/`;
  const project = tree.read(`${prefix}project.json`, 'utf-8');
  if (project !== null) {
    try {
      const targets = (JSON.parse(project) as { targets?: Record<string, { executor?: string }> }).targets ?? {};
      for (const target of Object.values(targets)) {
        if (target?.executor?.startsWith('@nx/jest:')) return 'jest';
        if (target?.executor?.startsWith('@nx/vite:test') || target?.executor?.startsWith('@nx/vitest:')) return 'vitest';
      }
    } catch {
      // an unreadable project.json says nothing about the runner
    }
  }
  for (const dir of prefix === '' ? [''] : [prefix, '']) {
    if (['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].some((ext) => tree.exists(`${dir}jest.config.${ext}`))) return 'jest';
    if (['ts', 'mts', 'js', 'mjs'].some((ext) => tree.exists(`${dir}vitest.config.${ext}`) || tree.exists(`${dir}vitest.workspace.${ext}`))) return 'vitest';
    for (const ext of ['ts', 'mts', 'js', 'mjs']) {
      const vite = tree.read(`${dir}vite.config.${ext}`, 'utf-8');
      if (vite !== null && /\btest\s*:/.test(vite)) return 'vitest';
    }
  }
  for (const manifest of prefix === '' ? ['package.json'] : [`${prefix}package.json`, 'package.json']) {
    if (hasDependency(tree, manifest, 'vitest')) return 'vitest';
    if (hasDependency(tree, manifest, 'jest')) return 'jest';
  }
  return 'none';
}
