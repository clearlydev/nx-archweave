import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDoctorCheck, type DoctorCheck } from '@nx-archweave/shared';
import { ESLINT_CONFIG_CANDIDATES } from '../backend/eslint-boundaries.ts';
import { classifyFsdEslintConfig } from '../fsd/fsd-eslint-config.ts';
import { maskComments } from '../backend/eslint-boundaries.ts';
import { projectPrefix, type DoctorProject } from './doctor-projects.ts';

/** Whether toolkit.config.json says FSD is on: `fsd.enabled` when recorded, else a frontend
 * other than `none`. Unreadable → not managed (another check's finding). */
function fsdEnabledPerConfig(root: string): boolean | null {
  const path = join(root, 'toolkit.config.json');
  if (!existsSync(path)) return null;
  try {
    const config = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const fsd = config['fsd'];
    if (typeof fsd === 'object' && fsd !== null && typeof (fsd as Record<string, unknown>)['enabled'] === 'boolean') {
      return (fsd as Record<string, unknown>)['enabled'] as boolean;
    }
    return typeof config['frontend'] === 'string' && config['frontend'] !== 'none';
  } catch {
    return null;
  }
}

/** ESLint configs where the FSD rule may live: the root (a standalone app) and each project's
 * directory — or, without a project list, the apps one grouping level deep (apps/web,
 * apps/group/web), the bounded scan the other doctor checks use. */
function eslintConfigPaths(root: string, projects?: DoctorProject[]): string[] {
  if (projects !== undefined) {
    const dirs = ['', ...projects.map((project) => projectPrefix(project.root))];
    return [...new Set(dirs.flatMap((dir) => ESLINT_CONFIG_CANDIDATES.map((name) => `${dir}${name}`)))].filter((rel) => existsSync(join(root, rel)));
  }
  const dirsIn = (rel: string): string[] => {
    try {
      return readdirSync(join(root, rel), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => (rel === '' ? entry.name : `${rel}/${entry.name}`));
    } catch {
      return [];
    }
  };
  const apps = dirsIn('apps');
  const dirs = ['', ...apps, ...apps.flatMap((app) => dirsIn(app))];
  return dirs.flatMap((dir) => ESLINT_CONFIG_CANDIDATES.map((name) => (dir === '' ? name : `${dir}/${name}`))).filter((rel) => existsSync(join(root, rel)));
}

/** A toolkit-managed workspace with FSD on should have the
 * `archweave/fsd-boundaries` rule wired into a frontend app's ESLint config. Presence of
 * the import, outside comments — no content comparison. */
export function buildFsdEnforcementCheck(root: string, projects?: DoctorProject[]): DoctorCheck {
  const id = 'fsd-enforcement-applied';
  const label = 'FSD layer rule applied';
  const enabled = fsdEnabledPerConfig(root);
  if (enabled !== true) {
    return createDoctorCheck({
      id,
      label,
      status: 'pass',
      message: enabled === null ? 'not a toolkit-managed workspace — nothing to verify' : 'FSD is off for this workspace',
      evidence: [],
    });
  }
  const applied = appliedFsdConfigs(root, projects);
  if (applied.length > 0) {
    return createDoctorCheck({ id, label, status: 'pass', message: 'the archweave/fsd-boundaries rule is wired into an ESLint config', evidence: applied });
  }
  return createDoctorCheck({
    id,
    label,
    status: 'warning',
    message: 'no ESLint config imports @clearlydev/nx-archweave/eslint — FSD layer rules are NOT enforced',
    evidence: [],
    suggestedAction: 'Run add-fsd-lite --applyEslint (or paste the snippet it prints into the frontend app\'s eslint.config.mjs).',
  });
}

function appliedFsdConfigs(root: string, projects?: DoctorProject[]): string[] {
  return eslintConfigPaths(root, projects).filter((rel) => classifyFsdEslintConfig(readFileSync(join(root, rel), 'utf-8')) === 'applied');
}

/** The rule's paths resolve from ESLint's cwd unless the config passes its own directory
 * (`cwd: import.meta.dirname`): then `nx lint` works, but an editor or an `eslint` started at
 * the workspace root checks nothing — silently. */
export function buildFsdRuleAnchoredCheck(root: string, projects?: DoctorProject[]): DoctorCheck {
  const id = 'fsd-rule-anchored';
  const label = 'FSD rule anchored to its config';
  const applied = appliedFsdConfigs(root, projects);
  if (applied.length === 0) {
    return createDoctorCheck({ id, label, status: 'not-applicable', message: 'no ESLint config wires the FSD rule', evidence: [] });
  }
  const unanchored = applied.filter((rel) => !/fsdBoundaries\(\s*\{[^}]*\bcwd\s*:/s.test(maskComments(readFileSync(join(root, rel), 'utf-8'))));
  if (unanchored.length === 0) {
    return createDoctorCheck({ id, label, status: 'pass', message: 'every FSD rule config passes cwd', evidence: applied });
  }
  return createDoctorCheck({
    id,
    label,
    status: 'warning',
    message: 'fsdBoundaries() is called without cwd — run from the workspace root or an editor, the rule checks no file',
    evidence: unanchored,
    suggestedAction: "Pass the config's own directory: fsdBoundaries({ severity, cwd: import.meta.dirname, root: '<source root>' }).",
  });
}
