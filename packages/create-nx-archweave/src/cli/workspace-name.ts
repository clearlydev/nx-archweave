/** npm's limit on a package name, which the workspace name becomes. */
const MAX_LENGTH = 214;
const EXAMPLE = 'my-app';

/**
 * Why `name` can't be a workspace name, or undefined when it can. The name becomes the
 * directory and the root package.json name, and it reaches create-nx-workspace as an
 * argument — on Windows through cmd.exe — so only npm's package-name characters pass:
 * lowercase letters, digits, "-", "_" and ".", not starting with "." or "_".
 */
export function workspaceNameProblem(name: string): string | undefined {
  if (name.length === 0) return 'it is empty';
  if (/\s/.test(name)) return 'it contains whitespace';
  if (name.length > MAX_LENGTH) return `it is ${name.length} characters long, and npm allows at most ${MAX_LENGTH}`;
  if (name.startsWith('.') || name.startsWith('_')) return `it starts with "${name[0]}"`;
  if (/[A-Z]/.test(name)) return 'it contains uppercase letters, and npm package names are lowercase';
  const others = [...new Set(name.replace(/[a-z0-9._-]/g, ''))];
  if (others.length > 0) {
    return `it contains ${others.map((char) => `"${char}"`).join(', ')} — only lowercase letters, digits, "-", "_" and "." are allowed`;
  }
  return undefined;
}

export function invalidWorkspaceNameMessage(name: string, problem: string): string {
  return `Invalid workspace name "${name}": ${problem}. For example: ${EXAMPLE}`;
}
