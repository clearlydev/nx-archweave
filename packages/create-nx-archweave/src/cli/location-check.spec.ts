import { checkInvocationDirectory, renderLocationRefusal } from './location-check.ts';

const probe = (gitRoot: string | null, packageJsonHere: boolean) => ({
  gitRoot: () => gitRoot,
  hasPackageJson: () => packageJsonHere,
});

describe('checkInvocationDirectory', () => {
  it('a plain directory is fine', () => {
    expect(checkInvocationDirectory('/tmp/new', probe(null, false))).toEqual({ ok: true });
  });

  it('inside a git repository it refuses, naming the repository', () => {
    expect(checkInvocationDirectory('/repo/apps', probe('/repo', false))).toEqual({ ok: false, reason: 'git', at: '/repo' });
  });

  it('in a directory with a package.json it refuses', () => {
    expect(checkInvocationDirectory('/proj', probe(null, true))).toEqual({ ok: false, reason: 'package', at: '/proj' });
  });
});

describe('renderLocationRefusal', () => {
  it('points at nx init for an existing repository, and at the flag that overrides', () => {
    const text = renderLocationRefusal({ ok: false, reason: 'git', at: '/repo' });
    expect(text).toContain('/repo is a git repository');
    expect(text).toContain('npx nx@latest init');
    expect(text).toContain('nx g @clearlydev/nx-archweave:init');
    expect(text).toContain('--allow-nested');
  });
});
