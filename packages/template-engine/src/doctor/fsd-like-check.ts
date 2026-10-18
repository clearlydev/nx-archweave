import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createDoctorCheck, type DoctorCheck } from '@nx-archweave/shared';

// _app/_pages: FSD's Next.js naming (Next.js reads src/app and src/pages as its routers)
const FSD_LAYERS = ['app', '_app', 'pages', '_pages', 'widgets', 'features', 'entities', 'shared'] as const;

/** Pre-install safety: an existing FSD-like
 * layout under src/ or apps/<app>/src/ can collide with init's FSD section.
 * Presence-only — no content comparison (no fuzzy verdicts). A
 * workspace that already carries toolkit.config.json is OUR structure, so
 * it never warns about itself. */
export function buildFsdLikeCheck(root: string): DoctorCheck {
  const scanRoots = ['src'];
  try {
    for (const entry of readdirSync(join(root, 'apps'), { withFileTypes: true })) {
      if (entry.isDirectory()) scanRoots.push(`apps/${entry.name}/src`);
    }
  } catch {
    // no apps/ — root src only
  }

  const found: string[] = [];
  for (const scanRoot of scanRoots) {
    for (const layer of FSD_LAYERS) {
      if (existsSync(join(root, scanRoot, layer))) found.push(`${scanRoot}/${layer}`);
    }
  }

  if (existsSync(join(root, 'toolkit.config.json'))) {
    return createDoctorCheck({
      id: 'fsd-like-structure',
      label: 'FSD-like structure',
      status: 'pass',
      message:
        found.length > 0
          ? 'FSD-like layers found, but this workspace is already managed by the toolkit'
          : 'no FSD-like layers found; workspace is toolkit-managed',
      evidence: found,
    });
  }

  if (found.length >= 2) {
    return createDoctorCheck({
      id: 'fsd-like-structure',
      label: 'FSD-like structure',
      status: 'warning',
      message: `an existing FSD-like layout was found (${found.length} layer directories) — init's FSD section may overlap it`,
      evidence: found,
      suggestedAction: 'Review the existing structure before running init, or run init with --fsd=false.',
    });
  }

  return createDoctorCheck({
    id: 'fsd-like-structure',
    label: 'FSD-like structure',
    status: 'pass',
    message: 'no collision signal — fewer than two FSD layer directories found',
    evidence: found,
  });
}
