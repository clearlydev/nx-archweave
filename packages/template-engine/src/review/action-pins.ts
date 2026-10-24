/** Every action the generated review workflows use, pinned to the commit its version tag
 * pointed at. A tag can be moved to other code at any time; a commit SHA cannot, and these
 * workflows run with repository secrets. The trailing version comment is what Dependabot
 * reads and rewrites. `.github/workflows/pinned-actions.yml` lists the same values so
 * Dependabot's update pull requests reach this file (a spec keeps the two in step). */
export const ACTION_PINS = {
  'actions/checkout': 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  'actions/setup-node': 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  'pnpm/action-setup': 'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0',
  'oven-sh/setup-bun': 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0',
  'anthropics/claude-code-action': 'anthropics/claude-code-action@6b6870e649b5ff408753befeaee5fc7989d4e6a9 # v1.0.258',
  'google-github-actions/run-gemini-cli': 'google-github-actions/run-gemini-cli@f77273f4c914e4bf38440cf36a0369cb64a37489 # v0.1.22',
  'openai/codex-action': 'openai/codex-action@bdf19a4a223ec2549a3e2274a0cf61556bc07675 # v1.13',
} as const;

export type PinnedAction = keyof typeof ACTION_PINS;

/** The value of a step's `uses:` key for `action`. */
export function pinnedUses(action: PinnedAction): string {
  return ACTION_PINS[action];
}
