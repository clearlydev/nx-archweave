import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { NxSupport } from '@nx-archweave/template-engine';

/** Nx's plugin publishing guide: "@nx/devkit itself declares a peer dependency on nx spanning
 * its own major plus one before and one after" (https://nx.dev/docs/kb/publish-plugin). So the
 * supported nx majors follow from the devkit's major alone; no range string is parsed. */
const MAJORS_EITHER_SIDE = 1;

function majorOf(version: string): number | undefined {
  const match = /^(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : undefined;
}

/** The version of the @nx/devkit this plugin runs on — resolved from the plugin's own
 * location, not the workspace's, because the plugin pins its devkit (a workspace on another
 * nx major can carry a second copy). */
function readOwnDevkitVersion(): string | undefined {
  try {
    const path = createRequire(import.meta.url).resolve('@nx/devkit/package.json');
    const version = (JSON.parse(readFileSync(path, 'utf-8')) as { version?: unknown }).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

function readInstalledNx(root: string): string | undefined {
  try {
    const version = (JSON.parse(readFileSync(join(root, 'node_modules', 'nx', 'package.json'), 'utf-8')) as { version?: unknown }).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

/** The nx majors the plugin supports against the workspace's installed nx; undefined when the
 * plugin's own @nx/devkit can't be read (doctor then judges the declared version alone). */
export function readNxSupport(
  root: string,
  deps: { devkitVersion?: () => string | undefined; installedNx?: (root: string) => string | undefined } = {},
): NxSupport | undefined {
  const devkitVersion = (deps.devkitVersion ?? readOwnDevkitVersion)();
  const devkitMajor = devkitVersion === undefined ? undefined : majorOf(devkitVersion);
  if (devkitVersion === undefined || devkitMajor === undefined) return undefined;
  const supportedMajors = { min: devkitMajor - MAJORS_EITHER_SIDE, max: devkitMajor + MAJORS_EITHER_SIDE };
  const installedVersion = (deps.installedNx ?? readInstalledNx)(root);
  const installedMajor = installedVersion === undefined ? undefined : majorOf(installedVersion);
  const inRange = installedMajor === undefined ? undefined : installedMajor >= supportedMajors.min && installedMajor <= supportedMajors.max;
  return { devkitVersion, supportedMajors, installedVersion, inRange };
}
