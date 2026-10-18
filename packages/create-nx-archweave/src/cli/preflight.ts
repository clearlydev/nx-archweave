/** The major version of a `<manager> --version`-style string, or undefined when it does
 * not start with one. The compatibility rule that uses it lives in package-manager.ts
 * (one gate for flag, launcher and question). */
export function parseMajor(version: string | undefined): number | undefined {
  const match = /^\s*v?(\d+)\./.exec(version ?? '');
  return match ? Number(match[1]) : undefined;
}
