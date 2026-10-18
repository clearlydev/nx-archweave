import { parseCliArgs } from './parse-args.ts';

describe('parseCliArgs', () => {
  it('parses a fully specified command line', () => {
    const outcome = parseCliArgs([
      'my-app',
      '--preset=solo',
      '--frontend=next',
      '--locale=ko',
      '--review',
      '--plugin-source=./local-plugin.tgz',
      '--package-manager=pnpm',
    ]);

    expect(outcome).toEqual({
      kind: 'ok',
      args: {
        name: 'my-app',
        preset: 'solo',
        frontend: 'next',
        backend: undefined,
        locale: 'ko',
        review: true,
        pluginSource: './local-plugin.tgz',
        packageManager: 'pnpm',
      },
    });
  });

  it('leaves every optional field undefined — packageManager included — when only the name is given', () => {
    const outcome = parseCliArgs(['my-app']);

    expect(outcome).toEqual({
      kind: 'ok',
      args: {
        name: 'my-app',
        preset: undefined,
        frontend: undefined,
        backend: undefined,
        locale: undefined,
        review: undefined,
        pluginSource: undefined,
        packageManager: undefined,
      },
    });
  });

  it('leaves name undefined when no positional argument is given', () => {
    const outcome = parseCliArgs(['--preset=quick-start']);
    expect(outcome).toEqual({
      kind: 'ok',
      args: expect.objectContaining({ name: undefined }),
    });
  });

  it.each([
    ['--no-review', false],
    ['--review=false', false],
    ['--review', true],
    ['--review=true', true],
  ])('parses %s as review=%s', (flag, expected) => {
    const outcome = parseCliArgs(['my-app', flag]);
    expect(outcome).toEqual({ kind: 'ok', args: expect.objectContaining({ review: expected }) });
  });

  it('parses the separated two-token form of string flags', () => {
    const outcome = parseCliArgs(['my-app', '--plugin-source', './local-plugin.tgz', '--preset', 'solo']);
    expect(outcome).toEqual({
      kind: 'ok',
      args: expect.objectContaining({ pluginSource: './local-plugin.tgz', preset: 'solo' }),
    });
  });

  it('never steals a separated string flag\'s dash-leading value as the review flag — parseArgs rejects it clearly instead', () => {
    const outcome = parseCliArgs(['my-app', '--plugin-source', '--review']);
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.message).toContain("Option '--plugin-source' argument is ambiguous");
      expect(outcome.message).toContain("'--plugin-source=-XYZ'");
    }
  });

  it('never reinterprets a --review=false-shaped separated value — parseArgs rejects it clearly instead', () => {
    const outcome = parseCliArgs(['my-app', '--plugin-source', '--review=false', '--review']);
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.message).toContain("Option '--plugin-source' argument is ambiguous");
    }
  });

  it('rejects an invalid --review value', () => {
    const outcome = parseCliArgs(['my-app', '--review=maybe']);
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Invalid --review value "maybe". Expected "true" or "false".',
    });
  });

  it('recognizes --help / -h', () => {
    expect(parseCliArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('recognizes --version / -v', () => {
    expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseCliArgs(['-v'])).toEqual({ kind: 'version' });
  });

  it('rejects an invalid --preset value', () => {
    const outcome = parseCliArgs(['my-app', '--preset=nope']);
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Invalid --preset value "nope". Expected one of: quick-start, solo, team',
    });
  });

  it('rejects an invalid --frontend value', () => {
    const outcome = parseCliArgs(['my-app', '--frontend=vue']);
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Invalid --frontend value "vue". Expected one of: react-vite, next, none',
    });
  });

  it('rejects an invalid --locale value', () => {
    const outcome = parseCliArgs(['my-app', '--locale=fr']);
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Invalid --locale value "fr". Expected one of: ko, en',
    });
  });

  it('rejects an unsupported --package-manager value, naming the supported ones', () => {
    const outcome = parseCliArgs(['my-app', '--package-manager=cnpm']);
    expect(outcome).toEqual({
      kind: 'error',
      message: '--package-manager "cnpm" is not supported — create-nx-archweave supports npm, pnpm, yarn and bun.',
    });
  });

  it('accepts an explicit --package-manager=pnpm', () => {
    const outcome = parseCliArgs(['my-app', '--package-manager=pnpm']);
    expect(outcome).toEqual({ kind: 'ok', args: expect.objectContaining({ packageManager: 'pnpm' }) });
  });

  it('rejects extra positional arguments', () => {
    const outcome = parseCliArgs(['my-app', 'extra-thing']);
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Unexpected extra argument(s): extra-thing',
    });
  });

  it('rejects unknown flags via the underlying parseArgs error', () => {
    const outcome = parseCliArgs(['my-app', '--not-a-real-flag']);
    expect(outcome.kind).toBe('error');
  });

  it('parses a valid --backend value', () => {
    const outcome = parseCliArgs(['my-app', '--backend=nest']);
    expect(outcome).toEqual({ kind: 'ok', args: expect.objectContaining({ backend: 'nest' }) });
  });

  it('rejects an invalid --backend value', () => {
    const outcome = parseCliArgs(['my-app', '--backend=fastify']);
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Invalid --backend value "fastify". Expected one of: express, nest, none',
    });
  });
});

describe('parseCliArgs — next × backend', () => {
  it('accepts --frontend=next with a backend: Nx 23 builds next in apps/ like react (measured 2026-10-16)', () => {
    for (const backend of ['express', 'nest', 'none']) {
      const outcome = parseCliArgs(['my-app', '--frontend=next', `--backend=${backend}`]);
      expect(outcome.kind).toBe('ok');
      if (outcome.kind === 'ok') expect(outcome.args.backend).toBe(backend);
    }
  });
});

describe('parseCliArgs — --package-manager=npm', () => {
  it('accepts npm', () => {
    const outcome = parseCliArgs(['my-app', '--package-manager=npm']);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') expect(outcome.args.packageManager).toBe('npm');
  });

  it.each(['yarn', 'bun'])('accepts --package-manager=%s (yarn-bun spec)', (pm) => {
    const outcome = parseCliArgs(['my-app', `--package-manager=${pm}`]);
    expect(outcome).toEqual({ kind: 'ok', args: expect.objectContaining({ packageManager: pm }) });
  });
});

describe('parseCliArgs — --ai-hosts', () => {
  it('takes a comma list, deduped, in the order given; absent means undefined', () => {
    const outcome = parseCliArgs(['my-app', '--ai-hosts=Cursor,claude-code,cursor']);
    expect(outcome).toEqual({ kind: 'ok', args: expect.objectContaining({ aiHosts: ['cursor', 'claude-code'] }) });
    const separated = parseCliArgs(['my-app', '--ai-hosts', 'codex']);
    expect(separated).toEqual({ kind: 'ok', args: expect.objectContaining({ aiHosts: ['codex'] }) });
    expect(parseCliArgs(['my-app'])).toEqual({ kind: 'ok', args: expect.objectContaining({ aiHosts: undefined }) });
  });

  it.each(['claude', 'claude-code,nope', ''])('rejects %j, naming the hosts', (value) => {
    const outcome = parseCliArgs(['my-app', `--ai-hosts=${value}`]);
    expect(outcome).toEqual({
      kind: 'error',
      message: expect.stringMatching(/^Invalid --ai-hosts value ".*"\. Expected one of: claude-code, codex, cursor, gemini-cli \(comma-separated\)$/),
    });
  });
});

describe('parseCliArgs — --plugins', () => {
  it('takes a comma list, deduped; none means an empty list; absent means undefined', () => {
    expect(parseCliArgs(['my-app', '--plugins=Ponytail,ponytail'])).toEqual({ kind: 'ok', args: expect.objectContaining({ plugins: ['ponytail'] }) });
    expect(parseCliArgs(['my-app', '--plugins', 'none'])).toEqual({ kind: 'ok', args: expect.objectContaining({ plugins: [] }) });
    expect(parseCliArgs(['my-app'])).toEqual({ kind: 'ok', args: expect.objectContaining({ plugins: undefined }) });
  });

  it.each(['nope', 'ponytail,none', ''])('rejects %j, naming the plugins', (value) => {
    expect(parseCliArgs(['my-app', `--plugins=${value}`])).toEqual({
      kind: 'error',
      message: expect.stringMatching(/^Invalid --plugins value ".*"\. Expected one of: ponytail, none \(comma-separated\)$/),
    });
  });
});

describe('parseCliArgs — --review-provider', () => {
  it('takes one of the providers; absent means undefined', () => {
    expect(parseCliArgs(['my-app', '--review-provider=gemini'])).toEqual({ kind: 'ok', args: expect.objectContaining({ reviewProvider: 'gemini' }) });
    expect(parseCliArgs(['my-app'])).toEqual({ kind: 'ok', args: expect.objectContaining({ reviewProvider: undefined }) });
    expect(parseCliArgs(['my-app', '--review-provider=openai'])).toEqual({
      kind: 'error',
      message: 'Invalid --review-provider value "openai". Expected one of: claude, gemini, gpt, cursor',
    });
  });
});

describe('parseCliArgs — backend-only (--frontend=none)', () => {
  it('accepts --frontend=none with a backend', () => {
    const outcome = parseCliArgs(['my-api', '--frontend=none', '--backend=express']);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') expect(outcome.args).toMatchObject({ frontend: 'none', backend: 'express' });
  });

  it('refuses --frontend=none --backend=none up front', () => {
    const outcome = parseCliArgs(['my-api', '--frontend=none', '--backend=none']);
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') expect(outcome.message).toContain('--backend=express or --backend=nest');
  });
});
