import { getProjects, type Tree } from '@nx/devkit';
import { parse } from 'jsonc-parser';
import { ESLINT_CONFIG_CANDIDATES, lintInputsProjectSnippet, lintInputsTargetDefaultsSnippet, TOOLKIT_CONFIG_INPUT } from '@nx-archweave/template-engine';
import { applyJsonEdits } from '../shared/json-edit.ts';

const ESLINT_PLUGIN = '@nx/eslint/plugin';
const ESLINT_EXECUTOR = '@nx/eslint:lint';

/** Why init printed the snippet instead of writing nx.json. */
export type LintInputsReason = 'not-first-run' | 'no-plugin' | 'own-targets' | 'existing-inputs';

/** What init did about toolkit.config.json in lint's inputs (the FSD rule reads that file, so
 * without it Nx can replay a cached lint result after the fsd policy changes). */
export interface LintInputsOutcome {
  /** 'added': targetDefaults gets ["...", toolkit.config.json] (would get, in a dry run). */
  action: 'added' | 'present' | 'snippet';
  /** The lint target's name: @nx/eslint/plugin's targetName, `lint` by default. */
  target: string;
  reason?: LintInputsReason;
  /** The projects that write their own lint target (reason 'own-targets'). */
  ownTargets?: string[];
  /** What to add by hand (action 'snippet'). */
  snippet?: string[];
  /** The command that checks lint without the cache, per FSD project (action 'snippet'). */
  skipCache?: string[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * nx.json gets `targetDefaults.<lint>.inputs = ["...", toolkit.config.json]` only when that is
 * safe and expected: init sets the workspace up for the first time, @nx/eslint/plugin infers the
 * lint targets, no project writes its own (there "..." has nothing to keep, and its inputs would
 * become toolkit.config.json alone — a source change would come back from the cache), and
 * targetDefaults has no lint inputs yet. Otherwise the report gets the snippet that fits.
 */
export function applyLintInputs(
  tree: Tree,
  input: { firstRun: boolean; fsdProjects: string[]; dryRun: boolean; runNx: string },
): LintInputsOutcome | undefined {
  const raw = tree.read('nx.json', 'utf-8');
  if (raw === null) return undefined;
  const nxJson: unknown = parse(raw, [], { allowTrailingComma: true });
  if (!isObject(nxJson)) return undefined;

  const plugins = Array.isArray(nxJson['plugins']) ? nxJson['plugins'] : [];
  const plugin = plugins.find((entry) => entry === ESLINT_PLUGIN || (isObject(entry) && entry['plugin'] === ESLINT_PLUGIN));
  const options = isObject(plugin) && isObject(plugin['options']) ? plugin['options'] : {};
  const target = typeof options['targetName'] === 'string' ? options['targetName'] : 'lint';
  const targetDefaults = isObject(nxJson['targetDefaults']) ? nxJson['targetDefaults'] : {};
  const namedInputs = isObject(nxJson['namedInputs']) ? nxJson['namedInputs'] : {};
  const defaultsKey = [target, ESLINT_EXECUTOR].find((key) => isObject(targetDefaults[key]) && Array.isArray(targetDefaults[key]['inputs']));
  const defaultsInputs = defaultsKey === undefined ? undefined : ((targetDefaults[defaultsKey] as Json)['inputs'] as unknown[]);

  const carries = (inputs: unknown[]) =>
    inputs.some((entry) => {
      if (entry === TOOLKIT_CONFIG_INPUT) return true;
      const named = typeof entry === 'string' ? namedInputs[entry.replace(/^\^/, '')] : undefined;
      return Array.isArray(named) && named.includes(TOOLKIT_CONFIG_INPUT);
    });
  if (defaultsInputs !== undefined && carries(defaultsInputs)) return { action: 'present', target };

  const projects = getProjects(tree);
  const ownTarget = (name: string) => {
    const project = projects.get(name);
    if (project === undefined) return undefined;
    if (isObject(project.targets?.[target])) return { file: projectFile(tree, project.root), inputs: project.targets?.[target]?.inputs };
    // A package.json script of that name is a target too (Nx runs it with nx:run-script).
    const pkg = readJson(tree, `${prefix(project.root)}package.json`);
    if (isObject(pkg) && isObject(pkg['scripts']) && typeof pkg['scripts'][target] === 'string') return { file: `${prefix(project.root)}package.json`, inputs: undefined };
    return undefined;
  };
  const ownTargets = [...projects.keys()].filter((name) => ownTarget(name) !== undefined).sort();

  const reason: LintInputsReason | undefined = !input.firstRun
    ? 'not-first-run'
    : plugin === undefined
      ? 'no-plugin'
      : ownTargets.length > 0
        ? 'own-targets'
        : defaultsInputs !== undefined
          ? 'existing-inputs'
          : undefined;

  if (reason === undefined) {
    if (!input.dryRun) tree.write('nx.json', applyJsonEdits(raw, [[['targetDefaults', target, 'inputs'], ['...', TOOLKIT_CONFIG_INPUT]]]));
    return { action: 'added', target };
  }

  const fsdProjects = input.fsdProjects.filter((name) => prefix(projects.get(name)?.root ?? '') !== '');
  const snippet =
    reason === 'existing-inputs' && defaultsKey !== undefined
      ? [`Add "${TOOLKIT_CONFIG_INPUT}" to targetDefaults["${defaultsKey}"].inputs in nx.json.`]
      : plugin !== undefined && ownTargets.length === 0
        ? lintInputsTargetDefaultsSnippet(target)
        : fsdProjects.flatMap((name) => {
            const root = projects.get(name)?.root ?? '';
            const own = ownTarget(name);
            return lintInputsProjectSnippet({
              file: own?.file ?? projectFile(tree, root),
              target,
              ownInputs: own?.inputs !== undefined,
              eslintConfigs: eslintConfigs(tree, root),
            });
          });
  return {
    action: 'snippet',
    target,
    reason,
    ...(reason === 'own-targets' ? { ownTargets } : {}),
    snippet,
    skipCache: fsdProjects.map((name) => `${input.runNx} ${target} ${name} --skip-nx-cache`),
  };
}

function prefix(root: string): string {
  return root === '' || root === '.' ? '' : `${root}/`;
}

function readJson(tree: Tree, path: string): unknown {
  const raw = tree.read(path, 'utf-8');
  return raw === null ? null : parse(raw, [], { allowTrailingComma: true });
}

function projectFile(tree: Tree, root: string): string {
  return tree.exists(`${prefix(root)}project.json`) ? `${prefix(root)}project.json` : `${prefix(root)}package.json`;
}

function eslintConfigs(tree: Tree, root: string): string[] {
  const own = ESLINT_CONFIG_CANDIDATES.find((name) => tree.exists(`${prefix(root)}${name}`));
  const workspace = ESLINT_CONFIG_CANDIDATES.find((name) => tree.exists(name));
  return [...(own === undefined || prefix(root) === '' ? [] : [`{projectRoot}/${own}`]), ...(workspace === undefined ? [] : [`{workspaceRoot}/${workspace}`])];
}
