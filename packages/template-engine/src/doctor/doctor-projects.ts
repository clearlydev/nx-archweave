/** A project as doctor sees it, read from the workspace's Nx configuration by the caller.
 * Without a list, the checks fall back to scanning the conventional `apps/` and `libs/`
 * folders (the layout nx-archweave's own workspaces have). */
export interface DoctorProject {
  name: string;
  /** Relative to the workspace root; `.` for a project at the root. */
  root: string;
  /** Where the code (and FSD layers) live, relative to the workspace root. */
  sourceRoot: string;
  tags: string[];
}

export function projectPrefix(root: string): string {
  return root === '' || root === '.' ? '' : `${root}/`;
}
