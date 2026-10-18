import { join } from 'node:path';
import type { Tree } from '@nx/devkit';
import type { ToolkitFrontend, ToolkitLocale } from '@nx-archweave/shared';
import {
  isEssenceSegmentName,
  isUsableSliceApiName,
  resolveSlicePublicApiName,
  SEGMENT_NAME_PATTERN,
  type FsdSliceLayer,
} from '@nx-archweave/template-engine';
import type { SliceAction, SliceRefusalReason, SliceReport } from './render.ts';
import { readToolkitConfig, RECORDED_FRONTENDS, resolveLocaleOption } from '../shared/toolkit-config-file.ts';
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
}): SlicePlan {
  const files = generatorFilesDir('slice', import.meta.url);
  const directory = `${input.sourceRoot}/${input.layerDirName}/${input.name}`;
  const shared = input.layer === 'shared';
  const values = {
    name: input.name,
    publicApiName: input.publicApiName,
    layer: input.layer,
    locale: input.locale,
    modulePath: shared ? `./${input.name}` : `./model/${input.name}`,
  };
  const module = renderTemplateFiles(join(files, 'module'), shared ? directory : `${directory}/model`, values)
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
   * frontend, else detected from the app (a next.config file), else react-vite. Only the
   * `page` generator exposes it — every other layer's directory is the layer id. */
  frontend?: ToolkitFrontend;
  /** Preview the files that would be generated without writing anything. */
  dryRun?: boolean;
}

/** Lowercase letters/digits, single hyphens, no leading/trailing/doubled hyphen, must
 * start with a letter (so `toCamelCase`/directory names stay valid identifiers). */
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Next.js reads `src/pages` as its Pages Router, so FSD's Next.js guide puts the pages
 * layer in `_pages/` there (as add-fsd-lite's guide says). Every other layer is its id. */
function layerDirNameFor(layer: FsdSliceLayer, frontend: ToolkitFrontend): string {
  return layer === 'pages' && frontend === 'next' ? '_pages' : layer;
}

function layerDirFor(layer: FsdSliceLayer, sourceRoot: string, frontend: ToolkitFrontend = 'react-vite'): string {
  return `${sourceRoot}/${layerDirNameFor(layer, frontend)}`;
}

const NEXT_CONFIG_FILES = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'];

/** option > toolkit.config.json's frontend (init records it) > a next.config file in the app
 * (Nx's Next.js app always has one) > react-vite. Best-effort: it only moves `pages` to
 * `_pages`, so a wrong guess costs a rename, never a broken file. */
function resolveFrontendForApp(option: ToolkitFrontend | undefined, config: Record<string, unknown> | null, appRoot: string, tree: Tree): ToolkitFrontend {
  if (option === 'react-vite' || option === 'next') return option;
  const recorded = config?.['frontend'];
  if (typeof recorded === 'string' && (RECORDED_FRONTENDS as readonly string[]).includes(recorded) && recorded !== 'none') {
    return recorded as ToolkitFrontend;
  }
  const prefix = appRoot === '' || appRoot === '.' ? '' : `${appRoot}/`;
  return NEXT_CONFIG_FILES.some((file) => tree.exists(`${prefix}${file}`)) ? 'next' : 'react-vite';
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
  extra: Pick<SliceReport, 'candidates' | 'detail'> = {},
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

  const app = resolveFrontendApp(tree, options.project);
  if (app.kind === 'not-found') return refusal('project-not-found', dryRun, layer, options.name, { project: app.project, sourceRoot: unresolved.sourceRoot });
  if (app.kind === 'ambiguous') return refusal('ambiguous-frontend', dryRun, layer, options.name, unresolved, { candidates: app.candidates });
  if (app.kind === 'invalid-project-json') return refusal('invalid-project-json', dryRun, layer, options.name, unresolved, { detail: app.detail });
  if (app.kind === 'none') return refusal('no-frontend-app', dryRun, layer, options.name, unresolved);

  // The layer directory is created with its first slice (canonical FSD) — add-fsd-lite makes
  // no folders. tree.write creates every missing parent.
  const config = readToolkitConfig(tree);
  const frontend = resolveFrontendForApp(options.frontend, config, app.root, tree);
  const layerDir = layerDirFor(layer, app.sourceRoot, frontend);
  const locale = resolveLocaleOption(options.locale, config);
  const plan = composeSlice({
    layer,
    name: options.name,
    publicApiName: resolveSlicePublicApiName(options.name, options.publicApiName),
    locale,
    sourceRoot: app.sourceRoot,
    layerDirName: layerDirNameFor(layer, frontend),
    segments,
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
  };
}
