import { runPostInitValidation, type ExecResult, type ProcessExec } from './validation.ts';

function fakeExec(byCommand: Record<string, ExecResult>): ProcessExec {
  return (command) => byCommand[command] ?? { status: 1, stdout: '', stderr: `${command}: not stubbed` };
}

const INPUT_NO_WORKFLOWS = { root: '/repo', workflowPaths: [], graphOutputFile: '/tmp/graph.json' };
const INPUT_WITH_WORKFLOW = {
  root: '/repo',
  workflowPaths: ['.github/workflows/claude-code-review.yml'],
  graphOutputFile: '/tmp/graph.json',
};

describe('runPostInitValidation — actionlint three-way split', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    jest.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg)));
  });
  afterEach(() => jest.restoreAllMocks());

  it('skips actionlint entirely when no workflow files were written this run', () => {
    const exec = fakeExec({ nx: { status: 0, stdout: '', stderr: '' } });
    runPostInitValidation(INPUT_NO_WORKFLOWS, exec);
    expect(logs.join('\n')).toContain('actionlint: skipped (no GitHub Actions workflow files were written this run)');
  });

  it('reports actionlint absent with an install hint when --version fails', () => {
    const exec = fakeExec({
      actionlint: { status: 1, stdout: '', stderr: 'command not found' },
      nx: { status: 0, stdout: '', stderr: '' },
    });
    runPostInitValidation(INPUT_WITH_WORKFLOW, exec);
    const output = logs.join('\n');
    expect(output).toContain('actionlint: not found on PATH — skipped.');
    expect(output).toContain('https://github.com/rhysd/actionlint');
  });

  it('reports actionlint passed when present and exits 0', () => {
    let call = 0;
    const exec: ProcessExec = (command, args) => {
      if (command === 'actionlint' && args[0] === '--version') return { status: 0, stdout: 'v1.7.0', stderr: '' };
      if (command === 'actionlint') return { status: 0, stdout: '', stderr: '' };
      call++;
      return { status: 0, stdout: '', stderr: '' };
    };
    runPostInitValidation(INPUT_WITH_WORKFLOW, exec);
    expect(logs.join('\n')).toContain('actionlint: passed (.github/workflows/claude-code-review.yml)');
    expect(call).toBeGreaterThanOrEqual(0);
  });

  it('reports actionlint issues when present but exits non-zero', () => {
    const exec: ProcessExec = (command, args) => {
      if (command === 'actionlint' && args[0] === '--version') return { status: 0, stdout: 'v1.7.0', stderr: '' };
      if (command === 'actionlint') return { status: 1, stdout: 'workflow.yml:3: unexpected key', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    runPostInitValidation(INPUT_WITH_WORKFLOW, exec);
    const output = logs.join('\n');
    expect(output).toContain('actionlint: reported issues');
    expect(output).toContain('unexpected key');
  });

  it('never throws even when exec itself throws', () => {
    const exec: ProcessExec = () => {
      throw new Error('spawn failure');
    };
    expect(() => runPostInitValidation(INPUT_NO_WORKFLOWS, exec)).not.toThrow();
    // A throwing exec fails the nx preflight, so the graph check reports not-found, not a bogus failure.
    expect(logs.join('\n')).toContain('nx graph: nx not found on PATH');
  });
});

describe('runPostInitValidation — nx graph', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    jest.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg)));
  });
  afterEach(() => jest.restoreAllMocks());

  it('reports success when nx graph exits 0', () => {
    const exec = fakeExec({ nx: { status: 0, stdout: '', stderr: '' } });
    runPostInitValidation(INPUT_NO_WORKFLOWS, exec);
    expect(logs.join('\n')).toContain('nx graph: valid (written to /tmp/graph.json)');
  });

  it('reports failure output when nx is present but the graph command exits non-zero', () => {
    const exec: ProcessExec = (command, args) =>
      command === 'nx' && args[0] === 'graph'
        ? { status: 1, stdout: '', stderr: 'project graph error' }
        : { status: 0, stdout: '', stderr: '' };
    runPostInitValidation(INPUT_NO_WORKFLOWS, exec);
    const output = logs.join('\n');
    expect(output).toContain('nx graph: failed');
    expect(output).toContain('project graph error');
  });

  it('reports nx not found (with a package-manager hint) when the preflight fails, instead of a bogus graph failure', () => {
    const exec: ProcessExec = (command) =>
      command === 'nx'
        ? { status: null, stdout: '', stderr: '' } // ENOENT-style spawn failure: no status, no output
        : { status: 0, stdout: '', stderr: '' };
    runPostInitValidation(INPUT_NO_WORKFLOWS, exec);
    const output = logs.join('\n');
    expect(output).toContain('nx graph: nx not found on PATH');
    expect(output).toContain('pnpm nx graph');
    expect(output).not.toContain('nx graph: failed');
  });
});
