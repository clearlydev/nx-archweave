/** Where create-nx-archweave was started: a new workspace goes into a new folder, so a
 * directory that already belongs to a project is almost always a mistake — the workspace would
 * land inside that repository as untracked files, its `.github/` would have no effect, and the
 * suggested `git add -A` would stage the outer repository's changes too. */
export type InvocationCheck = { ok: true } | { ok: false; reason: 'git' | 'package'; at: string };

export interface LocationProbe {
  /** The top of the git repository containing `dir`, or null outside one. */
  gitRoot(dir: string): string | null;
  hasPackageJson(dir: string): boolean;
}

/** A package.json counts only in `dir` itself: one further up (a home directory's) says
 * nothing about the folder the workspace goes into. */
export function checkInvocationDirectory(dir: string, probe: LocationProbe): InvocationCheck {
  const gitRoot = probe.gitRoot(dir);
  if (gitRoot !== null) return { ok: false, reason: 'git', at: gitRoot };
  if (probe.hasPackageJson(dir)) return { ok: false, reason: 'package', at: dir };
  return { ok: true };
}

export function renderLocationRefusal(check: Extract<InvocationCheck, { ok: false }>): string {
  const where = check.reason === 'git' ? `${check.at} is a git repository` : `${check.at} has a package.json`;
  return [
    `create-nx-archweave makes a new workspace in a new folder, but ${where}.`,
    'To set up an existing repository instead, run these in it:',
    '  npx nx@latest init',
    '  nx g @clearlydev/nx-archweave:init',
    'To create a separate workspace, run create-nx-archweave from a folder outside it.',
    'To nest a workspace here anyway, pass --allow-nested.',
  ].join('\n');
}
