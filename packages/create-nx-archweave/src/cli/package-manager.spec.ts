import {
  choosePackageManager,
  describeResolution,
  listInstalledManagers,
  parseUserAgent,
  type ChooseInput,
  type CliPackageManager,
  type Probe,
} from './package-manager.ts';
import type { Ask } from './prompts.ts';

const NPM_10 = 'npm/10.9.4 node/v22.22.0 linux x64 workspaces/false';
const NPM_11 = 'npm/11.6.2 node/v24.11.0 linux x64 workspaces/false';
const PNPM = 'pnpm/11.9.0 npm/? node/v22.22.0 linux x64';
const YARN_1 = 'yarn/1.22.22 npm/? node/v22.22.0 linux x64';
const YARN_4 = 'yarn/4.18.1 npm/? node/v22.22.0 linux x64';
const BUN = 'bun/1.4.2 npm/? node/v26.3.0 linux x64';

function scripted(answers: string[]) {
  const asked: string[] = [];
  const told: string[] = [];
  let index = 0;
  const ask: Ask = async (question) => {
    asked.push(question);
    return answers[index++] ?? '';
  };
  const tell = (line: string) => {
    told.push(line);
  };
  return { ask, tell, asked, told };
}

/** A probe that knows only the given versions; anything else is "not installed". */
function probeOf(versions: Partial<Record<CliPackageManager, string>>): Probe {
  return (name) => versions[name];
}

const base: ChooseInput = {
  flag: undefined,
  userAgent: undefined,
  interactive: true,
  probe: probeOf({}),
};

describe('parseUserAgent', () => {
  it.each([
    [NPM_10, { name: 'npm', version: '10.9.4' }],
    [PNPM, { name: 'pnpm', version: '11.9.0' }],
    [YARN_4, { name: 'yarn', version: '4.18.1' }],
    [BUN, { name: 'bun', version: '1.4.2' }],
    ['pnpm/? npm/? node/v22', { name: 'pnpm', version: undefined }],
  ])('%s', (agent, expected) => {
    expect(parseUserAgent(agent)).toEqual(expected);
  });

  it.each([undefined, '', '   ', 'not an agent'])('is undefined for %j', (agent) => {
    expect(parseUserAgent(agent)).toBeUndefined();
  });
});

describe('listInstalledManagers', () => {
  it('always lists npm (Node ships it), with the version the launcher reported', () => {
    expect(listInstalledManagers(parseUserAgent(NPM_10), probeOf({}))).toEqual([{ name: 'npm', version: '10.9.4' }]);
  });

  it('lists pnpm and yarn only when they run, or when they launched this command', () => {
    expect(listInstalledManagers(parseUserAgent(NPM_11), probeOf({ pnpm: '10.28.0', yarn: '1.22.22' }))).toEqual([
      { name: 'npm', version: '11.6.2' },
      { name: 'pnpm', version: '10.28.0' },
      { name: 'yarn', version: '1.22.22' },
    ]);
    // the probe cannot start yarn (Windows .cmd, no shell) — the launcher still proves it is there
    expect(listInstalledManagers(parseUserAgent(YARN_4), probeOf({ npm: '11.6.2' }))).toEqual([
      { name: 'npm', version: '11.6.2' },
      { name: 'yarn', version: '4.18.1' },
    ]);
  });

  it('lists bun when it runs, or when it launched this command (bunx)', () => {
    expect(listInstalledManagers(parseUserAgent(NPM_11), probeOf({ bun: '1.4.2' }))).toEqual([
      { name: 'npm', version: '11.6.2' },
      { name: 'bun', version: '1.4.2' },
    ]);
    expect(listInstalledManagers(parseUserAgent(BUN), probeOf({ npm: '11.6.2' }))).toEqual([
      { name: 'npm', version: '11.6.2' },
      { name: 'bun', version: '1.4.2' },
    ]);
  });

  it('keeps npm without a version when the probe cannot read one', () => {
    expect(listInstalledManagers(undefined, probeOf({}))).toEqual([{ name: 'npm', version: undefined }]);
  });
});

describe('choosePackageManager — no question', () => {
  it('the flag always wins and nothing is asked; the version comes from a matching launcher', async () => {
    const io = scripted([]);
    const probe = jest.fn<string | undefined, [CliPackageManager]>(() => undefined);
    expect(await choosePackageManager({ ...base, flag: 'npm', userAgent: NPM_11, probe }, io.ask, io.tell)).toEqual({
      packageManager: 'npm',
      source: 'flag',
      version: '11.6.2',
    });
    expect(io.asked).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });

  it('a flag naming another manager probes its version (pnpm launcher, --package-manager=yarn)', async () => {
    const io = scripted([]);
    expect(await choosePackageManager({ ...base, flag: 'yarn', userAgent: PNPM, probe: probeOf({ yarn: '4.18.1' }) }, io.ask, io.tell)).toEqual({
      packageManager: 'yarn',
      source: 'flag',
      version: '4.18.1',
    });
  });

  it('--package-manager=bun from npx: bun, its version probed', async () => {
    const io = scripted([]);
    expect(await choosePackageManager({ ...base, flag: 'bun', userAgent: NPM_11, probe: probeOf({ bun: '1.4.2' }) }, io.ask, io.tell)).toEqual({
      packageManager: 'bun',
      source: 'flag',
      version: '1.4.2',
    });
  });

  it('a flag whose version cannot be read is taken as is', async () => {
    const io = scripted([]);
    expect(await choosePackageManager({ ...base, flag: 'yarn', userAgent: undefined, probe: probeOf({}) }, io.ask, io.tell)).toEqual({
      packageManager: 'yarn',
      source: 'flag',
      version: undefined,
    });
  });

  it.each([
    ['npm', NPM_10, '10.9.4'],
    ['yarn', YARN_1, '1.22.22'],
  ] as const)('a flag naming %s at its oldest supported major is taken (npm 10, yarn 1)', async (flag, userAgent, version) => {
    const io = scripted([]);
    expect(await choosePackageManager({ ...base, flag, userAgent }, io.ask, io.tell)).toEqual({ packageManager: flag, source: 'flag', version });
  });

  it.each([
    [NPM_11, { packageManager: 'npm', source: 'launcher', version: '11.6.2' }],
    [PNPM, { packageManager: 'pnpm', source: 'launcher', version: '11.9.0' }],
    [YARN_4, { packageManager: 'yarn', source: 'launcher', version: '4.18.1' }],
    [BUN, { packageManager: 'bun', source: 'launcher', version: '1.4.2' }],
    [undefined, { packageManager: 'npm', source: 'default', version: undefined }],
  ])('non-interactive, launched by %s', async (userAgent, expected) => {
    const io = scripted([]);
    expect(await choosePackageManager({ ...base, interactive: false, userAgent }, io.ask, io.tell)).toEqual(expected);
    expect(io.asked).toEqual([]);
  });

  it('non-interactive, launched by yarn 1: taken', async () => {
    const io = scripted([]);
    expect(await choosePackageManager({ ...base, interactive: false, userAgent: YARN_1 }, io.ask, io.tell)).toEqual({
      packageManager: 'yarn',
      source: 'launcher',
      version: '1.22.22',
    });
  });

  it('non-interactive, launched by another manager: refused without promising it', async () => {
    const io = scripted([]);
    const result = await choosePackageManager({ ...base, interactive: false, userAgent: 'cnpm/9.0.0 node/v22' }, io.ask, io.tell);
    expect(result).toEqual({
      error: expect.stringMatching(/started with cnpm, which it does not support \(npm, pnpm, yarn and bun are\)\..*npx, pnpm dlx, yarn dlx or bunx.*--package-manager=npm\|pnpm\|yarn\|bun.*Nothing was created/s),
    });
  });

  it('one installed manager: no question and nothing printed (the plan print names it)', async () => {
    const io = scripted([]);
    const result = await choosePackageManager({ ...base, userAgent: NPM_11 }, io.ask, io.tell);
    expect(result).toEqual({ packageManager: 'npm', source: 'only-installed', version: '11.6.2' });
    expect(io.asked).toEqual([]);
    expect(io.told).toEqual([]);
  });

});

describe('choosePackageManager — the question', () => {
  it('numbers the installed managers and defaults to the launcher', async () => {
    const io = scripted(['']);
    const result = await choosePackageManager(
      { ...base, userAgent: PNPM, probe: probeOf({ npm: '11.6.2', yarn: '4.18.1' }) },
      io.ask,
      io.tell,
    );
    expect(io.told).toEqual(['? Package manager', '  1) npm   11.6.2', '  2) pnpm  11.9.0  (default)', '  3) yarn  4.18.1']);
    expect(io.asked).toEqual(['Choose 1-3 [2]: ']);
    expect(result).toEqual({ packageManager: 'pnpm', source: 'asked', version: '11.9.0' });
  });

  it('lists npm 10 and yarn 1 like any other manager, defaulting to the launcher', async () => {
    const io = scripted(['']);
    const result = await choosePackageManager({ ...base, userAgent: YARN_1, probe: probeOf({ npm: '10.9.4' }) }, io.ask, io.tell);
    expect(io.told).toEqual(['? Package manager', '  1) npm   10.9.4', '  2) yarn  1.22.22  (default)']);
    expect(result).toEqual({ packageManager: 'yarn', source: 'asked', version: '1.22.22' });
  });

  it('accepts the name (any case) as well as the number, and explains a wrong answer', async () => {
    const io = scripted(['cnpm', '9', 'PNPM']);
    const result = await choosePackageManager(
      { ...base, userAgent: NPM_11, probe: probeOf({ pnpm: '11.9.0' }) },
      io.ask,
      io.tell,
    );
    expect(result).toMatchObject({ packageManager: 'pnpm' });
    expect(io.asked).toHaveLength(3);
    expect(io.told.filter((line) => line.startsWith('Choose a number from 1 to 2'))).toHaveLength(2);
  });

  it('launched by bunx: bun is listed last with its version and is the default', async () => {
    const io = scripted(['']);
    const result = await choosePackageManager({ ...base, userAgent: BUN, probe: probeOf({ npm: '11.6.2', pnpm: '11.9.0' }) }, io.ask, io.tell);
    expect(io.told).toEqual(['? Package manager', '  1) npm   11.6.2', '  2) pnpm  11.9.0', '  3) bun   1.4.2  (default)']);
    expect(result).toEqual({ packageManager: 'bun', source: 'asked', version: '1.4.2' });
  });

  it('launched by an unsupported manager: says so, and offers what is installed with npm as the default', async () => {
    const io = scripted(['']);
    const result = await choosePackageManager(
      { ...base, userAgent: 'cnpm/9.0.0 node/v22', probe: probeOf({ npm: '11.6.2', pnpm: '11.9.0' }) },
      io.ask,
      io.tell,
    );
    expect(io.told[0]).toBe('cnpm is not supported (npm, pnpm, yarn and bun are) — choosing from the supported ones instead.');
    expect(result).toMatchObject({ packageManager: 'npm', source: 'asked' });
  });
});

describe('describeResolution', () => {
  it.each([
    [{ packageManager: 'npm', source: 'flag', version: '11.6.2' }, 'npm 11.6.2 (--package-manager)'],
    [{ packageManager: 'pnpm', source: 'launcher', version: undefined }, 'pnpm (the package manager that ran this command)'],
    [{ packageManager: 'npm', source: 'default', version: undefined }, 'npm (default — no launching package manager detected)'],
    [{ packageManager: 'yarn', source: 'asked', version: '4.18.1' }, 'yarn 4.18.1 (chosen)'],
    [{ packageManager: 'bun', source: 'launcher', version: '1.4.2' }, 'bun 1.4.2 (the package manager that ran this command)'],
    [{ packageManager: 'npm', source: 'only-installed', version: '11.6.2' }, 'npm 11.6.2 (the only one installed)'],
  ] as const)('%j', (resolution, text) => {
    expect(describeResolution(resolution)).toBe(text);
  });
});
