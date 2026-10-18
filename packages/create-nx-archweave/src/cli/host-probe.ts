import { AI_HOST_PROBES, AI_HOST_VALUES, type CliAiHost } from './types.ts';

/** The version each AI host's CLI reported; a host missing here was not found. */
export type InstalledHosts = Partial<Record<CliAiHost, string>>;

/** `<command> --version`'s output, or undefined when the command could not run or failed. */
export type VersionProbe = (command: string) => Promise<string | undefined>;

/** The version in a probe's output — `2.1.300 (Claude Code)` → `2.1.300`, `codex-cli
 * 0.162.1` → `0.162.1` (measured) — else its first line, shortened. */
export function parseProbeVersion(output: string): string {
  const firstLine = output.trim().split(/\r?\n/)[0]?.trim() ?? '';
  const version = /\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.]+)?/.exec(firstLine)?.[0];
  if (version) return version;
  return firstLine.length > 40 ? `${firstLine.slice(0, 39)}…` : firstLine;
}

/** Runs every host's probe at once (gemini alone takes ~2.4 s). A probe that cannot run
 * means "not found", never an error. */
export async function detectInstalledHosts(probe: VersionProbe): Promise<InstalledHosts> {
  const results = await Promise.all(
    AI_HOST_VALUES.map(async (host) => {
      try {
        return [host, await probe(AI_HOST_PROBES[host])] as const;
      } catch {
        return [host, undefined] as const;
      }
    }),
  );
  const installed: InstalledHosts = {};
  for (const [host, output] of results) if (output !== undefined) installed[host] = parseProbeVersion(output);
  return installed;
}
