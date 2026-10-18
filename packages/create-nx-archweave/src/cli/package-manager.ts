import { parseMajor } from './preflight.ts';
import type { Ask } from './prompts.ts';
import type { CliFrontend } from './types.ts';

/** The managers this CLI builds workspaces with. */
export type CliPackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/** Question order: npm first (always installed), then the rest. */
const SUPPORTED = ['npm', 'pnpm', 'yarn', 'bun'] as const satisfies readonly CliPackageManager[];

export function isCliPackageManager(name: string): name is CliPackageManager {
  return (SUPPORTED as readonly string[]).includes(name);
}

export interface Launcher {
  name: string;
  version: string | undefined;
}

/** The package manager that started this process, from `npm_config_user_agent`
 * (`npm/10.9.4 node/v22 …`, `pnpm/11.9.0 npm/? node/v22 …`, `yarn/4.18.1 npm/? …`,
 * `bun/1.4.2 npm/? node/v26 …`) — set
 * by npm, pnpm, yarn and bun for everything they run, unset for a direct `node` call. */
export function parseUserAgent(userAgent: string | undefined): Launcher | undefined {
  const match = /^([a-z][a-z0-9-]*)\/(\S+)/.exec(userAgent?.trim() ?? '');
  if (!match) return undefined;
  return { name: match[1], version: match[2] === '?' ? undefined : match[2] };
}

export interface InstalledManager {
  name: CliPackageManager;
  version: string | undefined;
}

/** `<name> --version`, or undefined when it cannot be run. */
export type Probe = (name: CliPackageManager) => string | undefined;

/**
 * The supported managers that are installed. npm always is (Node ships it); pnpm, yarn
 * and bun are when they run (a Windows `*.cmd` shim runs through cmd.exe), or when they
 * launched this command. The launcher's own version is used instead of probing it again.
 */
export function listInstalledManagers(launcher: Launcher | undefined, probe: Probe): InstalledManager[] {
  const installed: InstalledManager[] = [];
  for (const name of SUPPORTED) {
    const version = launcher?.name === name ? launcher.version ?? '' : probe(name)?.trim();
    if (version !== undefined) installed.push({ name, version: version === '' ? undefined : version });
    // npm ships with Node, so it is listed even when its version cannot be read
    else if (name === 'npm') installed.push({ name, version: undefined });
  }
  return installed;
}

/**
 * Why this manager cannot create the chosen workspace, or undefined when it can.
 * Both known cases fail inside create-nx-workspace's own install of
 * Nx's react template, so a pick is never allowed — an unknown version is not held
 * against the manager.
 */
export function managerIncompatibility(manager: InstalledManager, frontend: CliFrontend): string | undefined {
  const major = parseMajor(manager.version);
  if (frontend !== 'react-vite' || major === undefined) return undefined;
  if (manager.name === 'npm' && major < 11) return "react-vite needs npm 11 — npm 10 crashes in Nx's react template";
  if (manager.name === 'yarn' && major < 2) return "react-vite needs yarn 2+ — yarn 1 cannot resolve the template's workspace:* packages";
  return undefined;
}

export type PackageManagerSource = 'flag' | 'launcher' | 'default' | 'asked' | 'only-installed' | 'only-compatible';

export interface PackageManagerResolution {
  packageManager: CliPackageManager;
  source: PackageManagerSource;
  /** The manager's version when it is known (launcher or probe). */
  version: string | undefined;
}

export interface ChooseInput {
  /** `--package-manager`, already validated by parse-args. */
  flag: CliPackageManager | undefined;
  userAgent: string | undefined;
  frontend: CliFrontend;
  /** stdin is a TTY — only then is a question asked. */
  interactive: boolean;
  probe: Probe;
}

const NOTHING_CREATED = 'Nothing was created.';

/**
 * Flag > (interactive) the question > launcher > npm. One rule everywhere: a manager
 * that cannot create the chosen workspace is never used — the question shows it with its
 * reason but does not offer it, and a flag or launcher naming it stops the run before
 * anything is created. Non-interactive runs launched by an unsupported manager are
 * refused the same way.
 */
export async function choosePackageManager(
  input: ChooseInput,
  ask: Ask,
  tell: (line: string) => void,
): Promise<PackageManagerResolution | { error: string }> {
  const launcher = parseUserAgent(input.userAgent);
  // flag / launcher / default: the version comes from the launcher when it is the same
  // manager, otherwise from a probe — so the compatibility rule can apply.
  const resolveNamed = (name: CliPackageManager, source: PackageManagerSource): PackageManagerResolution | { error: string } => {
    const version = launcher?.name === name && launcher.version ? launcher.version : input.probe(name)?.trim() || undefined;
    const reason = managerIncompatibility({ name, version }, input.frontend);
    if (reason) {
      return {
        error:
          `create-nx-archweave stopped before creating anything: ${name} ${version} cannot create this workspace — ${reason}. ` +
          `${INSTALL_ADVICE} ${NOTHING_CREATED}`,
      };
    }
    return { packageManager: name, source, version };
  };

  if (input.flag) return resolveNamed(input.flag, 'flag');

  if (!input.interactive) {
    if (!launcher) return resolveNamed('npm', 'default');
    if (!isCliPackageManager(launcher.name)) {
      return {
        error:
          `create-nx-archweave was started with ${launcher.name}, which it does not support (${SUPPORTED_TEXT} are). ` +
          `Re-run with npx, pnpm dlx, yarn dlx or bunx, or pass --package-manager=${SUPPORTED.join('|')}. ${NOTHING_CREATED}`,
      };
    }
    return resolveNamed(launcher.name, 'launcher');
  }

  if (launcher && !isCliPackageManager(launcher.name)) {
    tell(`${launcher.name} is not supported (${SUPPORTED_TEXT} are) — choosing from the supported ones instead.`);
  }
  const installed = listInstalledManagers(launcher, input.probe);
  const reasons = installed.map((manager) => managerIncompatibility(manager, input.frontend));
  const selectable = installed.filter((_, index) => reasons[index] === undefined);
  const unavailable = installed.filter((_, index) => reasons[index] !== undefined);
  const unavailableLines = unavailable.map(
    (manager) => `     ${manager.name.padEnd(6)}${manager.version ?? ''}  — not available: ${reasons[installed.indexOf(manager)]}`,
  );

  if (selectable.length === 0) {
    return {
      error: ['create-nx-archweave stopped before creating anything: no installed package manager can create this workspace.', ...unavailableLines, `${INSTALL_ADVICE} ${NOTHING_CREATED}`].join('\n'),
    };
  }
  // Nothing to choose: the plan print names the manager (and why) next.
  if (selectable.length === 1) {
    if (unavailable.length > 0) tell(['Package manager:', ...unavailableLines].join('\n'));
    return { packageManager: selectable[0].name, source: unavailable.length > 0 ? 'only-compatible' : 'only-installed', version: selectable[0].version };
  }

  const defaultIndex = Math.max(0, selectable.findIndex((manager) => manager.name === launcher?.name));
  tell('? Package manager');
  selectable.forEach((manager, index) => {
    const head = `  ${index + 1}) ${manager.name.padEnd(6)}${manager.version ?? ''}`.trimEnd();
    tell(index === defaultIndex ? `${head}  (default)` : head);
  });
  unavailableLines.forEach((line) => tell(line));

  for (;;) {
    const answer = (await ask(`Choose 1-${selectable.length} [${defaultIndex + 1}]: `)).trim().toLowerCase();
    const byNumber = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
    const index = answer === '' ? defaultIndex : byNumber >= 0 ? byNumber : selectable.findIndex((manager) => manager.name === answer);
    if (index >= 0 && index < selectable.length) {
      return { packageManager: selectable[index].name, source: 'asked', version: selectable[index].version };
    }
    const blocked = unavailable.find((manager) => manager.name === answer);
    tell(
      blocked
        ? `${blocked.name} is not available here: ${reasons[installed.indexOf(blocked)]}.`
        : `Choose a number from 1 to ${selectable.length} (or a name: ${selectable.map((manager) => manager.name).join(', ')}).`,
    );
  }
}

const SUPPORTED_TEXT = 'npm, pnpm, yarn and bun';

const INSTALL_ADVICE = 'Use npm 11+, pnpm, yarn 2+ (Corepack: corepack enable) or bun, or pass --package-manager= with one of them.';

const SOURCE_TEXT: Record<PackageManagerSource, string> = {
  flag: '--package-manager',
  launcher: 'the package manager that ran this command',
  default: 'default — no launching package manager detected',
  asked: 'chosen',
  'only-installed': 'the only one installed',
  'only-compatible': 'the only installed one that can create this workspace',
};

/** `npm 11.6.2 (the package manager that ran this command)` — for the plan print. */
export function describeResolution(resolution: PackageManagerResolution): string {
  const name = resolution.version ? `${resolution.packageManager} ${resolution.version}` : resolution.packageManager;
  return `${name} (${SOURCE_TEXT[resolution.source]})`;
}
