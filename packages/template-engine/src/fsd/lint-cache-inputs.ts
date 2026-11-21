/** The input that makes Nx re-run lint after toolkit.config.json (the FSD policy) changes. */
export const TOOLKIT_CONFIG_INPUT = '{workspaceRoot}/toolkit.config.json';

/** For a workspace whose lint targets @nx/eslint/plugin infers, every one of them: "..." keeps
 * the inferred inputs and adds the policy file after them. */
export function lintInputsTargetDefaultsSnippet(target: string): string[] {
  return [
    'Add to nx.json:',
    `  "targetDefaults": { "${target}": { "inputs": ["...", "${TOOLKIT_CONFIG_INPUT}"] } }`,
    'Keep "...": it stands for the inputs @nx/eslint/plugin infers (the sources, the ESLint config). Without it',
    'they are dropped, and lint is served from the cache after a source change.',
  ];
}

/** For a workspace where some project writes its own lint target: targetDefaults would leave that
 * target with the policy file alone ("..." has nothing to keep there), so each FSD project gets
 * its inputs written out in full. */
export function lintInputsProjectSnippet(input: { file: string; target: string; ownInputs: boolean; eslintConfigs: string[] }): string[] {
  if (input.ownInputs) return [`Add "${TOOLKIT_CONFIG_INPUT}" to the inputs of the ${input.target} target in ${input.file}.`];
  const inputs = ['"default"', '"^default"', ...input.eslintConfigs.map((name) => `"${name}"`), `"${TOOLKIT_CONFIG_INPUT}"`, '{ "externalDependencies": ["eslint"] }'];
  return [
    `Add to the ${input.target} target in ${input.file} (not to targetDefaults: a lint target written in a project file`,
    'keeps only what targetDefaults lists, so its own files would drop out):',
    `  "inputs": [${inputs.join(', ')}]`,
  ];
}
