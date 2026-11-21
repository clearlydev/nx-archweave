import type { ToolkitPackageManager } from '@nx-archweave/shared';

/** The package managers generators write for. */
export type SupportedPackageManager = ToolkitPackageManager;

/** yarn 1.x ("classic") and yarn 2+ ("berry") differ in a few command flags. */
export type YarnFlavor = 'classic' | 'berry';

const LOCKFILES: ReadonlyArray<readonly [Exclude<SupportedPackageManager, 'pnpm'>, readonly string[]]> = [
  ['yarn', ['yarn.lock']],
  ['bun', ['bun.lock', 'bun.lockb']],
  ['npm', ['package-lock.json']],
];

/** Detection is the truth generators act on. pnpm
 * markers outrank everything. A lone yarn, bun or npm lockfile names its manager.
 * Several together — a stray lockfile from a one-off `yarn`, `bun install` or
 * `npm install` — are settled by package.json's `packageManager` field; without one,
 * npm (the manager these repos most often started with, so a stray file never flips an
 * npm repo), else yarn over bun. Nothing → null, and every write path degrades with a
 * report. */
export function detectWorkspacePackageManager(
  exists: (relativePath: string) => boolean,
  read: (relativePath: string) => string | null | undefined = () => undefined,
): SupportedPackageManager | null {
  if (exists('pnpm-lock.yaml') || exists('pnpm-workspace.yaml')) return 'pnpm';
  const found = LOCKFILES.filter(([, files]) => files.some((file) => exists(file))).map(([pm]) => pm);
  if (found.length <= 1) return found[0] ?? null;
  const declared = /"packageManager"\s*:\s*"(npm|yarn|bun)@/.exec(read('package.json') ?? '')?.[1];
  const named = found.find((pm) => pm === declared);
  if (named) return named;
  return found.includes('npm') ? 'npm' : found[0];
}

/** berry when the workspace has a `.yarnrc.yml` (create-nx-workspace writes `nodeLinker`
 * there), a berry lockfile (`__metadata:`) or a `packageManager: "yarn@2+"` field; classic
 * otherwise — including when there is nothing to read yet. */
export function detectYarnFlavor(
  exists: (relativePath: string) => boolean,
  read: (relativePath: string) => string | null | undefined,
): YarnFlavor {
  if (exists('.yarnrc.yml')) return 'berry';
  if (/^__metadata:/m.test(read('yarn.lock') ?? '')) return 'berry';
  const major = /"packageManager"\s*:\s*"yarn@(\d+)\./.exec(read('package.json') ?? '')?.[1];
  return major !== undefined && Number(major) >= 2 ? 'berry' : 'classic';
}

export interface PackageManagerCommands {
  /** Add a dev dependency at the workspace root. */
  addDevAtRoot(spec: string): string;
  /** Add a (runtime) dependency at the workspace root. */
  addAtRoot(spec: string): string;
  /** Prefix that runs the workspace's local nx (`<runNx> g …`). */
  runNx: string;
  install: string;
  /** Where a new workspace package is registered. */
  workspaceRegistration: 'pnpm-workspace.yaml' | 'package.json workspaces';
}

/** The commands generators print for a package manager. npm never
 * gets `-w` (it means --workspace=<name> there); yarn classic needs `-W` to add at the
 * root, which berry rejects; bun adds at the root with no flag (measured, bun 1.4). */
export function packageManagerCommands(pm: SupportedPackageManager, flavor: YarnFlavor = 'classic'): PackageManagerCommands {
  switch (pm) {
    case 'pnpm':
      return { addDevAtRoot: (spec) => `pnpm add -D -w ${spec}`, addAtRoot: (spec) => `pnpm add -w ${spec}`, runNx: 'pnpm nx', install: 'pnpm install', workspaceRegistration: 'pnpm-workspace.yaml' };
    case 'yarn':
      return {
        addDevAtRoot: (spec) => (flavor === 'berry' ? `yarn add -D ${spec}` : `yarn add -D -W ${spec}`),
        addAtRoot: (spec) => (flavor === 'berry' ? `yarn add ${spec}` : `yarn add -W ${spec}`),
        runNx: 'yarn nx',
        install: 'yarn install',
        workspaceRegistration: 'package.json workspaces',
      };
    case 'bun':
      return { addDevAtRoot: (spec) => `bun add -d ${spec}`, addAtRoot: (spec) => `bun add ${spec}`, runNx: 'bun nx', install: 'bun install', workspaceRegistration: 'package.json workspaces' };
    case 'npm':
      return { addDevAtRoot: (spec) => `npm install -D ${spec}`, addAtRoot: (spec) => `npm install ${spec}`, runNx: 'npm exec nx --', install: 'npm install', workspaceRegistration: 'package.json workspaces' };
  }
}

/** How the printed nx commands run nx when the package manager is unknown (no lockfile, nothing
 * recorded): npx ships with Node and runs the nx in node_modules/.bin, whichever manager put it
 * there. Install commands can't take this form; they keep pnpm's, with a note. A yarn berry PnP
 * workspace has no node_modules, but its yarn.lock means the manager is never unknown there. */
export const UNKNOWN_PM_RUN_NX = 'npx nx';

/** The prefix that runs the workspace's local nx: the package manager's own form, npx nx when unknown. */
export function runNxCommand(pm: SupportedPackageManager | null | undefined): string {
  return pm === null || pm === undefined ? UNKNOWN_PM_RUN_NX : packageManagerCommands(pm).runNx;
}

/** Put next to an install command printed for an unknown package manager. */
export const INSTALL_ASSUMES_PNPM = "install commands assume pnpm; use your package manager's form";
