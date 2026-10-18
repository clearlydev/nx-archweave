import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDoctorCheck, type DoctorCheck, type ToolkitBackend } from '@nx-archweave/shared';
import { classifyBoundaryConstraints, ESLINT_CONFIG_CANDIDATES } from '../backend/eslint-boundaries.ts';

const CONFIG_PATH = 'toolkit.config.json';
const SHARED_TYPES_PACKAGE = 'libs/shared-types/package.json';
/** Earlier releases shipped shared-types as a project.json library —
 * recognized so legacy workspaces never get a false warning. */
const SHARED_TYPES_LEGACY = 'libs/shared-types/project.json';

export const BACKEND_CHECK_IDS = [
  'backend-framework',
  'backend-config-consistency',
  'shared-types-lib',
  'boundary-constraints-applied',
  'boundary-tags-exist',
] as const;

const CHECK_LABELS: Record<(typeof BACKEND_CHECK_IDS)[number], string> = {
  'backend-framework': 'Backend framework (root package.json only)',
  'backend-config-consistency': 'Backend config consistency',
  'shared-types-lib': 'shared-types library',
  'boundary-constraints-applied': 'Module-boundary constraints',
  'boundary-tags-exist': 'Boundary tags exist',
};

/** Bounded scan for scope tags — one level under apps/
 * and libs/, and one or two levels under packages/, reading project.json
 * tags and package.json nx.tags. Unparseable files are skipped: a broken
 * file is another check's finding, never a false boundary verdict. */
function collectScopeTags(root: string): Set<string> {
  const tags = new Set<string>();
  const dirsIn = (rel: string): string[] => {
    try {
      return readdirSync(join(root, rel), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${rel}/${entry.name}`);
    } catch {
      return [];
    }
  };
  // One nesting level everywhere: grouped Nx layouts (apps/group/web,
  // libs/shared/ui) keep their project files one level deeper.
  const apps = dirsIn('apps');
  const libs = dirsIn('libs');
  const packages = dirsIn('packages');
  const roots = [
    ...apps,
    ...apps.flatMap((p) => dirsIn(p)),
    ...libs,
    ...libs.flatMap((p) => dirsIn(p)),
    ...packages,
    ...packages.flatMap((p) => dirsIn(p)),
  ];
  for (const projectRoot of roots) {
    for (const [file, path] of [
      ['project.json', ['tags']],
      ['package.json', ['nx', 'tags']],
    ] as const) {
      try {
        let node: unknown = JSON.parse(readFileSync(join(root, projectRoot, file), 'utf-8'));
        for (const key of path) node = (node as Record<string, unknown> | null)?.[key];
        if (Array.isArray(node)) for (const tag of node) if (typeof tag === 'string') tags.add(tag);
      } catch {
        // missing or unparseable — skip
      }
    }
  }
  return tags;
}

function notApplicable(message: string): DoctorCheck[] {
  return BACKEND_CHECK_IDS.map((id) =>
    createDoctorCheck({ id, label: CHECK_LABELS[id], status: 'not-applicable', message, evidence: [] }),
  );
}

/** toolkit.config.json says `frontend: none` — a backend-only workspace. */
function readsBackendOnly(root: string): boolean {
  try {
    return (JSON.parse(readFileSync(join(root, CONFIG_PATH), 'utf-8')) as { frontend?: unknown }).frontend === 'none';
  } catch {
    return false;
  }
}

/** Reads the configured backend from toolkit.config.json. `null` means "no
 * usable backend claim" — file absent, unparseable, or backend missing/'none';
 * every backend check is then not-applicable. An unusable config is
 * already escalated by the review config-consistency check — no double error. */
function readConfiguredBackend(root: string): ToolkitBackend | 'invalid' | null {
  const configPath = join(root, CONFIG_PATH);
  if (!existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as { backend?: unknown };
    const backend = parsed.backend;
    if (backend === undefined || backend === 'none') return null;
    if (backend === 'express' || backend === 'nest') return backend;
    return 'invalid';
  } catch {
    return null;
  }
}

/** The four backend-axis checks. Read-only, root-level files only —
 * the same root-only caveat as the frontend framework checks. */
export function buildBackendChecks(root: string): DoctorCheck[] {
  const backend = readConfiguredBackend(root);
  if (backend === null) {
    return notApplicable('Skipped — no backend configured in toolkit.config.json');
  }

  const checks: DoctorCheck[] = [];

  if (backend === 'invalid') {
    checks.push(
      createDoctorCheck({
        id: 'backend-framework',
        label: CHECK_LABELS['backend-framework'],
        status: 'not-applicable',
        message: 'Skipped — backend value in toolkit.config.json is not recognized',
        evidence: [CONFIG_PATH],
      }),
      createDoctorCheck({
        id: 'backend-config-consistency',
        label: CHECK_LABELS['backend-config-consistency'],
        status: 'error',
        message: "toolkit.config.json declares an unknown backend (expected 'express', 'nest', or 'none')",
        evidence: [CONFIG_PATH],
        suggestedAction: 'Fix the backend field, then re-run doctor.',
      }),
    );
  } else {
    // dependency detection, root package.json only
    let hasDependency = false;
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const packageName = backend === 'nest' ? '@nestjs/core' : 'express';
      hasDependency = Boolean(pkg.dependencies?.[packageName] ?? pkg.devDependencies?.[packageName]);
    } catch {
      hasDependency = false;
    }
    checks.push(
      createDoctorCheck({
        id: 'backend-framework',
        label: CHECK_LABELS['backend-framework'],
        status: hasDependency ? 'pass' : 'warning',
        message: hasDependency
          ? `${backend} dependency detected in the root package.json`
          : `backend is configured as ${backend} but its dependency was not found in the root package.json`,
        evidence: hasDependency ? ['package.json'] : [],
        suggestedAction: hasDependency ? undefined : 'Run the official generator commands shown by add-backend.',
      }),
      createDoctorCheck({
        id: 'backend-config-consistency',
        label: CHECK_LABELS['backend-config-consistency'],
        status: 'pass',
        message: `backend '${backend}' is a recognized value`,
        evidence: [CONFIG_PATH],
      }),
    );
  }

  const sharedTypesCurrent = existsSync(join(root, SHARED_TYPES_PACKAGE));
  const sharedTypesLegacy = !sharedTypesCurrent && existsSync(join(root, SHARED_TYPES_LEGACY));
  const sharedTypesExists = sharedTypesCurrent || sharedTypesLegacy;
  checks.push(
    createDoctorCheck({
      id: 'shared-types-lib',
      label: CHECK_LABELS['shared-types-lib'],
      status: sharedTypesExists ? 'pass' : 'warning',
      message: sharedTypesCurrent
        ? 'libs/shared-types present'
        : sharedTypesLegacy
          ? 'libs/shared-types present (legacy project.json shape)'
          : 'libs/shared-types not found — run add-backend to wire it',
      evidence: sharedTypesCurrent ? [SHARED_TYPES_PACKAGE] : sharedTypesLegacy ? [SHARED_TYPES_LEGACY] : [],
    }),
  );

  const eslintPath = ESLINT_CONFIG_CANDIDATES.find((candidate) => existsSync(join(root, candidate)));
  const classification = eslintPath
    ? classifyBoundaryConstraints(readFileSync(join(root, eslintPath), 'utf-8'))
    : 'unknown';
  checks.push(
    createDoctorCheck({
      id: 'boundary-constraints-applied',
      label: CHECK_LABELS['boundary-constraints-applied'],
      status: classification === 'enforced' ? 'pass' : 'warning',
      message:
        classification === 'enforced'
          ? 'scope depConstraints are enforced'
          : classification === 'allow-all'
            ? 'ESLint still has the allow-all default — boundaries are NOT enforced'
            : 'could not verify the ESLint config (missing or unrecognized shape)',
      evidence: eslintPath ? [eslintPath] : [],
      suggestedAction:
        classification === 'enforced' ? undefined : 'Run add-backend with --applyEslint, or merge its snippet yourself.',
    }),
  );

  // Boundary tag existence: enforced rules that reference tags no
  // project carries are dead letters — the moat looks on but does nothing.
  if (classification !== 'enforced') {
    checks.push(
      createDoctorCheck({
        id: 'boundary-tags-exist',
        label: CHECK_LABELS['boundary-tags-exist'],
        status: 'not-applicable',
        message: 'Skipped — boundary constraints are not enforced (see boundary-constraints-applied)',
        evidence: [],
      }),
    );
  } else {
    const tags = collectScopeTags(root);
    // A backend-only workspace (frontend: none) has no frontend to tag yet — the frontend
    // deny rule waits for one; only the backend tag must be carried.
    const required = readsBackendOnly(root) ? (['scope:backend'] as const) : (['scope:frontend', 'scope:backend'] as const);
    const missing = required.filter((tag) => !tags.has(tag));
    checks.push(
      createDoctorCheck({
        id: 'boundary-tags-exist',
        label: CHECK_LABELS['boundary-tags-exist'],
        status: missing.length === 0 ? 'pass' : 'warning',
        message:
          missing.length === 0
            ? required.length === 1
              ? 'scope:backend is carried by at least one project (backend-only workspace — no frontend to tag)'
              : 'both scope:frontend and scope:backend are carried by at least one project'
            : `the toolkit's enforced deny rules reference ${missing.join(' and ')}, but no project in the scanned directories (apps/, libs/, packages/) carries ${missing.length === 1 ? 'it' : 'them'} — the boundary is a dead letter`,
        evidence: missing.length === 0 ? [] : missing,
        suggestedAction:
          missing.length === 0
            ? undefined
            : 'Add the missing scope tag(s) to the app project.json tags or package.json nx.tags (add-backend does this for the two apps).',
      }),
    );
  }

  return checks;
}
