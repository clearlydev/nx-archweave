import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const MANIFEST_FILENAME = 'archweave-integrations.json';

export interface IntegrationManifestEntry {
  source: string;
  repository: string;
  version?: string;
  method: string;
  managedBy: 'external-tool' | 'nx-archweave' | 'unknown';
  verification: 'passed' | 'failed';
  // Optional additions — all optional so older manifests/fixtures without them still
  // parse unchanged. Never persist installPath/installedAt/lastUpdated or any
  // other absolute/home-directory path, user name, or machine name here.
  target?: string;
  scope?: 'user' | 'project' | 'local' | 'managed';
  // For a Claude Code marketplace plugin, only 'claude-cli' is ever paired with
  // verification: 'passed' in a real written entry — 'package-json' exists
  // for a future integration whose own official mechanism is genuinely
  // npm-based.
  evidenceKind?: 'claude-cli' | 'package-json';
}

export interface IntegrationManifest {
  integrations: Record<string, IntegrationManifestEntry>;
}

export function createEmptyManifest(): IntegrationManifest {
  return { integrations: {} };
}

// Keeps the declared-vs-installed distinction: this file only ever represents
// "what was actually installed and verified", never "what the user asked for" (that lives in
// ToolkitConfig.integrations.enabled, owned by a different layer). A missing
// or unreadable manifest is not an error — it just means nothing has been
// installed through nx-archweave yet, so this never throws.
export function loadManifest(root: string): IntegrationManifest {
  const manifestPath = join(root, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    return createEmptyManifest();
  }
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && typeof parsed.integrations === 'object') {
      return { integrations: parsed.integrations ?? {} };
    }
    return createEmptyManifest();
  } catch {
    return createEmptyManifest();
  }
}

export function withManifestEntry(
  manifest: IntegrationManifest,
  id: string,
  entry: IntegrationManifestEntry,
): IntegrationManifest {
  return {
    integrations: {
      ...manifest.integrations,
      [id]: entry,
    },
  };
}

// No installedAt/generated ids/machine-specific paths — deterministic by
// construction, so rewriting an unchanged manifest is idempotent.
export function serializeManifest(manifest: IntegrationManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function writeManifest(root: string, manifest: IntegrationManifest): void {
  writeFileSync(join(root, MANIFEST_FILENAME), serializeManifest(manifest));
}

// Atomic (temp file in the same directory, then rename) so a crash mid-write
// never leaves a partial/corrupt manifest — record-integration (the first
// caller to actually write this file for real) requires
// this; writeManifest above remains for existing callers/tests that don't
// need the stronger guarantee. Also refuses to write through a symlinked
// manifest path rather than silently following it outside the workspace
// (a workspace containment check). The temp filename uses a random
// suffix only to avoid collisions between concurrent calls — it is never
// part of the persisted manifest content, so it does not affect the
// manifest's own determinism guarantee.
export function writeManifestAtomic(root: string, manifest: IntegrationManifest): void {
  const finalPath = join(root, MANIFEST_FILENAME);

  if (existsSync(finalPath) && lstatSync(finalPath).isSymbolicLink()) {
    throw new Error(
      `Refusing to write ${MANIFEST_FILENAME}: the path is a symlink. Remove or replace it with a regular file first.`,
    );
  }

  const suffix = randomBytes(6).toString('hex');
  const tempPath = join(root, `.${MANIFEST_FILENAME}.tmp-${suffix}`);

  try {
    writeFileSync(tempPath, serializeManifest(manifest));
    renameSync(tempPath, finalPath);
  } catch (error) {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw error;
  }
}
