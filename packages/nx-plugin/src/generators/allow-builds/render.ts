import { yamlPackageKey, type AllowBuildsTarget, type BuildDecisionChange } from '@nx-archweave/template-engine';

export type AllowBuildsReport =
  | {
      packages: string[];
      target: AllowBuildsTarget;
      changes: BuildDecisionChange[];
      applied: boolean;
      /** There was no pnpm-lock.yaml to check the names against. */
      namesUnchecked?: true;
      refused?: undefined;
    }
  | { packages: string[]; refused: 'npm' | 'yarn' | 'bun' | 'no-package-manager' | 'no-workspace-yaml' }
  | { packages: string[]; refused: 'unknown-packages'; unknown: string[] }
  | { packages: string[]; refused: 'unrecognized'; reason: string };

const ALLOW_BUILDS_LABEL: Record<BuildDecisionChange['previous'], string> = {
  allowed: 'already true',
  denied: 'false → true',
  pending: 'awaiting a decision → true',
  other: 'another value → true',
  absent: 'added (true)',
};

export function renderAllowBuildsReport(report: AllowBuildsReport): string {
  const rebuild = `pnpm rebuild ${report.packages.join(' ')}`;

  if (report.refused === undefined) {
    const lines = [
      `allow-builds — ${report.applied ? 'applied' : 'preview (nothing written)'}`,
      '',
      `pnpm-workspace.yaml › ${report.target}`,
      ...report.changes.map((change) => `  ${change.name}: ${label(report.target, change.previous)}`),
      '',
    ];
    if (report.namesUnchecked) lines.push('The names were not checked: there is no pnpm-lock.yaml.', '');
    if (report.applied) {
      lines.push(`Running: ${rebuild}`);
    } else {
      lines.push(
        `Then: ${rebuild}`,
        "Allowing a build lets that package's install script run with your user's permissions.",
        '',
        `To apply: pnpm nx g @clearlydev/nx-archweave:allow-builds --packages=${report.packages.join(',')} --apply`,
      );
    }
    return lines.join('\n');
  }

  const head = 'allow-builds — refused (nothing written)';
  switch (report.refused) {
    case 'npm':
      return [
        head,
        'This is an npm workspace: allow-builds edits pnpm settings only. npm runs dependency install scripts',
        'itself unless ignore-scripts is set, so there is nothing to re-allow; npm 11 records an approval with',
        `  npm install-scripts approve ${report.packages.join(' ')}`,
      ].join('\n');
    case 'yarn':
      return [
        head,
        'This is a yarn workspace: allow-builds edits pnpm settings only. yarn classic runs dependency',
        'install scripts itself; yarn berry runs them unless .yarnrc.yml sets enableScripts: false —',
        'remove that line (or set it to true) and run `yarn install` to let them run.',
      ].join('\n');
    case 'bun':
      return [
        head,
        'This is a bun workspace: allow-builds edits pnpm settings only. bun blocks the install scripts of',
        'dependencies outside its trusted list; `bun pm untrusted` lists the blocked ones, and',
        `  bun pm trust ${report.packages.join(' ')}`,
        'runs their scripts and records them in package.json trustedDependencies.',
      ].join('\n');
    case 'no-package-manager':
      return [head, 'There is no pnpm-lock.yaml or pnpm-workspace.yaml here — allow-builds edits pnpm settings only.'].join('\n');
    case 'no-workspace-yaml':
      return [
        head,
        'This pnpm project has no pnpm-workspace.yaml, where pnpm keeps its build decisions. Add one with',
        '  allowBuilds:',
        ...report.packages.map((name) => `    ${yamlPackageKey(name)}: true`),
        `then run "${rebuild}".`,
      ].join('\n');
    case 'unknown-packages':
      return [
        head,
        `These packages are not in pnpm-lock.yaml: ${report.unknown.join(', ')} — check the names; only an installed package has a build to run.`,
      ].join('\n');
    case 'unrecognized':
      return [
        head,
        `pnpm-workspace.yaml is in a shape allow-builds does not edit: ${report.reason}.`,
        `Instead, allow ${report.packages.join(', ')} in pnpm-workspace.yaml yourself — "<package>: true" under allowBuilds`,
        `(pnpm 11; pnpm 10 from 10.28), or a "- <package>" item under onlyBuiltDependencies on older pnpm 10 — then run "${rebuild}".`,
      ].join('\n');
  }
}

function label(target: AllowBuildsTarget, previous: BuildDecisionChange['previous']): string {
  if (target === 'allowBuilds') return ALLOW_BUILDS_LABEL[previous];
  // a list item is either there or not — denied / pending / other only exist in allowBuilds
  return previous === 'allowed' ? 'already listed' : 'added to the list';
}
