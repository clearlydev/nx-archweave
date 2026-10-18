import { escapeCmdArgument, resolveWindowsCommand, spawnableCommand, type SpawnableCommandEnv } from './spawnable-command.ts';

// Windows looks files up case-insensitively; PATHEXT is upper case.
const files = new Set(
  [
    'C:\\Program Files\\nodejs\\npx.cmd',
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd',
    'C:\\Users\\me\\.local\\bin\\claude.exe',
    'C:\\work\\app\\node_modules\\.bin\\nx.cmd',
  ].map((p) => p.toLowerCase()),
);
const win = (path = 'C:\\Program Files\\nodejs;C:\\Users\\me\\AppData\\Roaming\\npm'): SpawnableCommandEnv => ({
  platform: 'win32',
  env: { Path: path, PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' },
  isFile: (p) => files.has(p.toLowerCase()),
});

describe('spawnableCommand', () => {
  it('outside Windows: unchanged', () => {
    expect(spawnableCommand('npx', ['-y', 'a b'], { platform: 'linux', env: {}, isFile: () => true })).toEqual({ command: 'npx', args: ['-y', 'a b'] });
  });

  it('a Windows .cmd shim runs through cmd.exe, every argument escaped (PATH / PATHEXT in any case)', () => {
    expect(spawnableCommand('npx', ['-y', 'create-nx-workspace@23.2.0', 'my app', '--aiAgents=claude'], win())).toEqual({
      command: 'C:\\Windows\\system32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '"C:\\Program^ Files\\nodejs\\npx.CMD ^"-y^" ^"create-nx-workspace@23.2.0^" ^"my^ app^" ^"--aiAgents=claude^""',
      ],
      windowsVerbatimArguments: true,
    });
  });

  it('a real .exe is spawned directly; an unknown command is left for spawn to report', () => {
    expect(spawnableCommand('node', ['-v'], win())).toEqual({ command: 'node', args: ['-v'] });
    expect(spawnableCommand('claude', ['--version'], win('C:\\Users\\me\\.local\\bin'))).toEqual({ command: 'claude', args: ['--version'] });
    expect(spawnableCommand('nope', [], win())).toEqual({ command: 'nope', args: [] });
  });

  it('a project-local node_modules\\.bin shim gets its arguments escaped twice (it re-invokes cmd.exe)', () => {
    const result = spawnableCommand('nx', ['graph', '--file=a&b.json'], win('C:\\work\\app\\node_modules\\.bin'));
    expect(result.args[3]).toBe('"C:\\work\\app\\node_modules\\.bin\\nx.CMD ^^^"graph^^^" ^^^"--file=a^^^&b.json^^^""');
  });

  it('PATH order decides: the first match wins', () => {
    expect(resolveWindowsCommand('claude', win('C:\\Users\\me\\.local\\bin;C:\\Users\\me\\AppData\\Roaming\\npm'))).toBe('C:\\Users\\me\\.local\\bin\\claude.EXE');
    expect(resolveWindowsCommand('claude', win('C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Users\\me\\.local\\bin'))).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.CMD');
  });
});

describe('escapeCmdArgument', () => {
  it.each([
    ['plain', '^"plain^"'],
    ['', '^"^"'],
    ['a"b', '^"a\\^"b^"'],
    ['C:\\dir\\', '^"C:\\dir\\\\^"'],
    ['50%&echo pwned|x', '^"50^%^&echo^ pwned^|x^"'],
  ])('%j → %j', (arg, escaped) => {
    expect(escapeCmdArgument(arg)).toBe(escaped);
  });
});

it('escapeCmdArgument(…, true) escapes the metacharacters a second time', () => {
  expect(escapeCmdArgument('a&b', true)).toBe('^^^"a^^^&b^^^"');
});
