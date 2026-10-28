import type { Ask } from './prompts.ts';

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

export type PackageManagerSource = 'flag' | 'launcher' | 'default' | 'asked' | 'only-installed';

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
  /** stdin is a TTY — only then is a question asked. */
  interactive: boolean;
  probe: Probe;
}

const NOTHING_CREATED = 'Nothing was created.';

/**
 * Flag > (interactive) the question > launcher > npm. Every supported manager can create
 * every workspace (npm 10 and yarn 1 included, measured 2026-10-25 on the empty-preset
 * react-vite path and on next). Non-interactive runs launched by an unsupported manager are
 * refused before anything is created.
 */
export async function choosePackageManager(
  input: ChooseInput,
  ask: Ask,
  tell: (line: string) => void,
): Promise<PackageManagerResolution | { error: string }> {
  const launcher = parseUserAgent(input.userAgent);
  // flag / launcher / default: the version comes from the launcher when it is the same
  // manager, otherwise from a probe.
  const resolveNamed = (name: CliPackageManager, source: PackageManagerSource): PackageManagerResolution => {
    const version = launcher?.name === name && launcher.version ? launcher.version : input.probe(name)?.trim() || undefined;
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
  // Nothing to choose: the plan print names the manager (and why) next. npm is always listed.
  if (installed.length === 1) return { packageManager: installed[0].name, source: 'only-installed', version: installed[0].version };

  const defaultIndex = Math.max(0, installed.findIndex((manager) => manager.name === launcher?.name));
  tell('? Package manager');
  installed.forEach((manager, index) => {
    const head = `  ${index + 1}) ${manager.name.padEnd(6)}${manager.version ?? ''}`.trimEnd();
    tell(index === defaultIndex ? `${head}  (default)` : head);
  });

  for (;;) {
    const answer = (await ask(`Choose 1-${installed.length} [${defaultIndex + 1}]: `)).trim().toLowerCase();
    const byNumber = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
    const index = answer === '' ? defaultIndex : byNumber >= 0 ? byNumber : installed.findIndex((manager) => manager.name === answer);
    if (index >= 0 && index < installed.length) {
      return { packageManager: installed[index].name, source: 'asked', version: installed[index].version };
    }
    tell(`Choose a number from 1 to ${installed.length} (or a name: ${installed.map((manager) => manager.name).join(', ')}).`);
  }
}

const SUPPORTED_TEXT = 'npm, pnpm, yarn and bun';


const SOURCE_TEXT: Record<PackageManagerSource, string> = {
  flag: '--package-manager',
  launcher: 'the package manager that ran this command',
  default: 'default — no launching package manager detected',
  asked: 'chosen',
  'only-installed': 'the only one installed',
};

/** `npm 11.6.2 (the package manager that ran this command)` — for the plan print. */
export function describeResolution(resolution: PackageManagerResolution): string {
  const name = resolution.version ? `${resolution.packageManager} ${resolution.version}` : resolution.packageManager;
  return `${name} (${SOURCE_TEXT[resolution.source]})`;
}
