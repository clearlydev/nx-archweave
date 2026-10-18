import type { Tree } from '@nx/devkit';
import { readFsdEnforcement, type FsdEnforcement } from '@nx-archweave/shared';
import {
  applyFsdEslintConfig,
  buildFsdCheckTarget,
  buildFsdEslintPasteSnippet,
  buildSteigerConfig,
  composeFsdLayerGuide,
  detectYarnFlavor,
  ESLINT_CONFIG_CANDIDATES,
  FSD_CHECK_TARGET,
  packageManagerCommands,
  STEIGER_CONFIG_FILE,
  STEIGER_DEPENDENCIES,
} from '@nx-archweave/template-engine';
import type { AddFsdLiteGeneratorSchema } from './schema.d.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import { resolveFrontendApp } from '../shared/frontend-app.ts';
import { detectIndent, readToolkitConfig, resolveFrontendOption, resolveLocaleOption, treePackageManager } from '../shared/toolkit-config-file.ts';
import { renderAddFsdLiteReport, type AddFsdLiteReport, type FsdAppRefusal, type SteigerOutcome } from './render.ts';

/** Option > toolkit.config.json `fsd.enforcement` > 'warn'. An unrecognized value from either
 * source is ignored, never an abort (same best-effort shape as locale). */
function resolveEnforcement(option: unknown, config: Record<string, unknown> | null): FsdEnforcement {
  if (option === 'error' || option === 'warn') return option;
  return readFsdEnforcement(config?.['fsd']) ?? 'warn';
}

/**
 * add-fsd-lite no longer creates folders (canonical FSD: a layer directory appears with its
 * first slice — the slice generators do that). It picks the frontend app, wires the
 * `archweave/fsd-boundaries` ESLint rule into that app's config (written only with
 * `--applyEslint`, the add-backend contract; otherwise a paste-ready snippet), and prints
 * the layer guide.
 */
export function runAddFsdLite(tree: Tree, options: AddFsdLiteGeneratorSchema): AddFsdLiteReport {
  // A broken toolkit.config.json never aborts add-fsd-lite (it is not this generator's
  // write target) — the defaults just fall through.
  const config = readToolkitConfig(tree);
  const locale = resolveLocaleOption(options.locale, config);
  const enforcement = resolveEnforcement(options.enforcement, config);
  const frontend = resolveFrontendOption(options.frontend, config, 'add-fsd-lite');
  const dryRun = options.dryRun ?? false;
  const applyEslint = options.applyEslint ?? false;
  const snippet = buildFsdEslintPasteSnippet(enforcement, locale);

  const app = resolveFrontendApp(tree, options.project);
  if (app.kind !== 'found') {
    const appRefusal: FsdAppRefusal =
      app.kind === 'not-found'
        ? { reason: 'project-not-found', project: app.project }
        : app.kind === 'ambiguous'
          ? { reason: 'ambiguous-frontend', candidates: app.candidates }
          : app.kind === 'invalid-project-json'
            ? { reason: 'invalid-project-json', detail: app.detail }
            : { reason: 'no-frontend-app' };
    return { dryRun, aborted: true, appRefusal, project: null, sourceRoot: null, enforcement, eslint: 'not-applied', eslintPath: null, snippet, layerGuide: null, steiger: null };
  }

  const appDir = app.root === '' || app.root === '.' ? '' : `${app.root}/`;
  const eslintPath = ESLINT_CONFIG_CANDIDATES.map((name) => `${appDir}${name}`).find((path) => tree.exists(path)) ?? null;
  const configText = eslintPath === null ? null : tree.read(eslintPath, 'utf-8');

  let eslint: AddFsdLiteReport['eslint'];
  if (!applyEslint) {
    // report-only: the user pastes the snippet — unless the rule is already there
    eslint = configText !== null && applyFsdEslintConfig(configText, enforcement).status === 'already-applied' ? 'already-applied' : 'snippet-only';
  } else if (configText === null) {
    eslint = 'degraded-unrecognized';
  } else {
    const result = applyFsdEslintConfig(configText, enforcement);
    eslint = result.status === 'applied' ? 'applied' : result.status === 'already-applied' ? 'already-applied' : 'degraded-unrecognized';
    if (result.status === 'applied' && !dryRun && eslintPath !== null) tree.write(eslintPath, result.text);
  }

  const steiger = options.steiger ? addSteiger(tree, { appDir, appRoot: app.root, sourceRoot: app.sourceRoot, frontend, locale, write: !dryRun, config }) : null;

  return {
    dryRun,
    aborted: false,
    appRefusal: null,
    project: app.project,
    sourceRoot: app.sourceRoot,
    steiger,
    enforcement,
    eslint,
    eslintPath,
    snippet: eslint === 'applied' || eslint === 'already-applied' ? null : snippet,
    layerGuide: composeFsdLayerGuide({ frontend, sourceRoot: app.sourceRoot, locale }),
  };
}

/** A JSON file read and parsed before any write — a broken one is reported, never rewritten. */
function readJsonObject(tree: Tree, path: string): { raw: string; parsed: Record<string, unknown> } | null {
  const raw = tree.read(path, 'utf-8');
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? { raw, parsed: parsed as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

/**
 * `--steiger`: the official FSD linter as an opt-in `fsd-check`
 * target. Three writes, each idempotent and each reported on its own: the app's
 * steiger.config.mjs (an existing one with other content is kept, never replaced), the
 * target in the app's project.json / package.json `nx`, and the two devDependencies in the
 * root package.json. Nothing is installed — the report carries the install command.
 */
function addSteiger(
  tree: Tree,
  input: { appDir: string; appRoot: string; sourceRoot: string; frontend: 'react-vite' | 'next'; locale: 'ko' | 'en'; write: boolean; config: Record<string, unknown> | null },
): SteigerOutcome {
  const configPath = `${input.appDir}${STEIGER_CONFIG_FILE}`;
  const configText = buildSteigerConfig({ frontend: input.frontend, locale: input.locale });
  const existing = tree.read(configPath, 'utf-8');
  let configAction: SteigerOutcome['config'];
  if (existing === null) {
    configAction = 'created';
    if (input.write) tree.write(configPath, configText);
  } else {
    configAction = existing === configText ? 'unchanged' : 'kept';
  }

  // the source root relative to the app root is what the target hands steiger
  const rootPrefix = input.appRoot === '' || input.appRoot === '.' ? '' : `${input.appRoot}/`;
  const sourceRootName = input.sourceRoot.startsWith(rootPrefix) ? input.sourceRoot.slice(rootPrefix.length) : 'src';
  const target = buildFsdCheckTarget(sourceRootName);
  let targetAction: SteigerOutcome['target'] = 'unrecognized';
  let targetPath: string | null = null;
  for (const candidate of [`${input.appDir}project.json`, `${input.appDir}package.json`]) {
    const file = readJsonObject(tree, candidate);
    if (file === null) continue;
    targetPath = candidate;
    const holder = candidate.endsWith('project.json') ? file.parsed : ((file.parsed['nx'] ??= {}) as Record<string, unknown>);
    if (typeof holder !== 'object' || holder === null) break;
    const targets = ((holder as Record<string, unknown>)['targets'] ??= {}) as Record<string, unknown>;
    if (typeof targets !== 'object' || targets === null) break;
    if (targets[FSD_CHECK_TARGET] !== undefined) {
      targetAction = 'present';
    } else {
      targets[FSD_CHECK_TARGET] = target;
      targetAction = 'added';
      if (input.write) tree.write(candidate, `${JSON.stringify(file.parsed, null, detectIndent(file.raw))}\n`);
    }
    break;
  }

  let dependenciesAction: SteigerOutcome['dependencies'] = 'unrecognized';
  const rootPackage = readJsonObject(tree, 'package.json');
  if (rootPackage !== null) {
    const devDependencies = ((rootPackage.parsed['devDependencies'] ??= {}) as Record<string, unknown>);
    const dependencies = (rootPackage.parsed['dependencies'] ?? {}) as Record<string, unknown>;
    const missing = Object.entries(STEIGER_DEPENDENCIES).filter(([name]) => devDependencies[name] === undefined && dependencies[name] === undefined);
    if (missing.length === 0) {
      dependenciesAction = 'present';
    } else {
      for (const [name, range] of missing) devDependencies[name] = range;
      dependenciesAction = 'added';
      if (input.write) tree.write('package.json', `${JSON.stringify(rootPackage.parsed, null, detectIndent(rootPackage.raw))}\n`);
    }
  }

  const pm = treePackageManager(tree, input.config) ?? 'pnpm';
  const commands = packageManagerCommands(pm, pm === 'yarn' ? detectYarnFlavor((p) => tree.exists(p), (p) => tree.read(p, 'utf-8')) : undefined);
  return {
    configPath,
    config: configAction,
    targetPath,
    target: targetAction,
    dependencies: dependenciesAction,
    installCommand: commands.install,
    runCommand: `${commands.runNx} run <project>:${FSD_CHECK_TARGET}`,
  };
}

export async function addFsdLiteGenerator(tree: Tree, options: AddFsdLiteGeneratorSchema): Promise<void> {
  console.log(renderAddFsdLiteReport(runAddFsdLite(tree, { ...options, dryRun: resolveDryRun(options) })));
}

export default addFsdLiteGenerator;
