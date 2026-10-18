// This file exists in packages/shared and packages/create-nx-archweave (which imports
// nothing); keep the two identical — the CLI's spec compares them.
import { statSync } from 'node:fs';
import { win32 } from 'node:path';

export interface SpawnableCommand {
  command: string;
  args: string[];
  /** Set for a cmd.exe call: the arguments are already quoted for it. */
  windowsVerbatimArguments?: boolean;
}

export interface SpawnableCommandEnv {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  isFile: (path: string) => boolean;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const DEFAULT_ENV: SpawnableCommandEnv = { platform: process.platform, env: process.env, isFile };

/** Windows keeps PATH and PATHEXT under any letter case. */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/** Where Windows would find `command`: as given when it has a path, else on PATH, trying
 * each PATHEXT extension unless it already has one. Undefined when nothing matches. */
export function resolveWindowsCommand(command: string, environment: SpawnableCommandEnv): string | undefined {
  const exts = (envValue(environment.env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const candidates = (base: string): string[] => (win32.extname(base) !== '' ? [base] : exts.map((ext) => base + ext));
  if (win32.isAbsolute(command) || /[\\/]/.test(command)) {
    return candidates(command).find(environment.isFile);
  }
  const dirs = (envValue(environment.env, 'PATH') ?? '').split(';').filter(Boolean);
  for (const dir of dirs) {
    const found = candidates(win32.join(dir, command)).find(environment.isFile);
    if (found !== undefined) return found;
  }
  return undefined;
}

// cmd.exe's metacharacters, escaped with ^ (the algorithm cross-spawn uses — MIT,
// https://github.com/moxystudio/node-cross-spawn — after https://qntm.org/cmd).
const META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

/** A project-local `node_modules\.bin\*.cmd` shim hands its arguments to cmd.exe a second
 * time, so they are escaped twice (cross-spawn does the same). */
const BIN_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

/** One argument for `cmd.exe /d /s /c "…"`: quoted for the program's own argv parsing,
 * then every cmd.exe metacharacter escaped (twice for a node_modules\.bin shim). `%VAR%`
 * is not fully protected from expansion — the arguments passed here are the program's own,
 * never user text, as with cross-spawn. */
export function escapeCmdArgument(arg: string, doubleEscape = false): string {
  let quoted = arg.replace(/(\\*)"/g, '$1$1\\"');
  quoted = quoted.replace(/(\\*)$/, '$1$1');
  const escaped = `"${quoted}"`.replace(META_CHARS, '^$1');
  return doubleEscape ? escaped.replace(META_CHARS, '^$1') : escaped;
}

/**
 * How to spawn `command args` without a shell, on every platform. Node cannot start a
 * Windows `.cmd` / `.bat` shim itself (ENOENT without the extension; EINVAL with it, since
 * the CVE-2024-27980 fix) — and npm, npx, pnpm, yarn and an npm-installed claude are all
 * such shims there. On Windows those run through `cmd.exe /d /s /c` with each argument
 * escaped; everything else (a real .exe, any other platform) is spawned unchanged.
 */
export function spawnableCommand(command: string, args: readonly string[], environment: SpawnableCommandEnv = DEFAULT_ENV): SpawnableCommand {
  if (environment.platform !== 'win32') return { command, args: [...args] };
  const resolved = resolveWindowsCommand(command, environment);
  if (resolved === undefined || !/\.(cmd|bat)$/i.test(resolved)) return { command, args: [...args] };
  const doubleEscape = BIN_SHIM.test(resolved);
  const line = [resolved.replace(META_CHARS, '^$1'), ...args.map((arg) => escapeCmdArgument(arg, doubleEscape))].join(' ');
  return {
    command: envValue(environment.env, 'COMSPEC') ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  };
}
