import { ROUND_MARKER } from '../workflow-skeleton.ts';
import { cursorProvider } from './cursor-provider.ts';

describe('cursorProvider', () => {
  it('declares the fixed contract values', () => {
    expect(cursorProvider.id).toBe('cursor');
    expect(cursorProvider.workflowFileName).toBe('.github/workflows/cursor-code-review.yml');
    expect(cursorProvider.requiredSecretName).toBe('CURSOR_API_KEY');
  });

  it('standard mode: skeleton, gates, CLI install, run step, prompt input, single review prompt', () => {
    const yaml = cursorProvider.buildWorkflowYaml({ mode: 'standard', locale: 'en', maxRounds: 3, packageManager: 'pnpm' });
    expect(yaml).toContain('types: [opened, synchronize, ready_for_review, reopened]');
    expect(yaml).toContain('contents: read');
    expect(yaml).toContain('id: secret-gate');
    expect(yaml).toContain('id: round-gate');
    expect(yaml).toContain('-ge 3');
    expect(yaml).toContain("curl --proto '=https' --tlsv1.2 -fsS https://cursor.com/install | bash");
    // Both directories the installer has used, so `agent` resolves wherever it lands.
    expect(yaml).toContain('echo "$HOME/.local/bin" >> "$GITHUB_PATH"');
    expect(yaml).toContain('echo "$HOME/.cursor/bin" >> "$GITHUB_PATH"');
    expect(yaml).toContain('agent --trust -p "$(cat <<');
    expect(yaml).toContain('CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}');
    expect(yaml).toContain('GH_TOKEN: ${{ github.token }}');
    expect(yaml).toContain(
      "if: steps.secret-gate.outputs.enabled == 'true' && steps.round-gate.outputs.allowed == 'true'",
    );
    expect(yaml).toContain('You are a code reviewer focused on correctness and security.');
    expect(yaml).not.toContain('focused exclusively on over-engineering');
    expect(yaml).toContain(ROUND_MARKER);
    expect(yaml).toMatchSnapshot();
  });

  it('passes --trust, without which cursor-agent stops at "Workspace Trust Required"', () => {
    const yaml = cursorProvider.buildWorkflowYaml({ mode: 'standard', locale: 'en', maxRounds: 3, packageManager: 'pnpm' });
    expect(yaml).toContain('agent --trust -p "$(cat <<');
    expect(yaml).not.toMatch(/agent -p /);
  });

  it('thorough mode appends the over-engineering pass per REVIEW_MODES', () => {
    const yaml = cursorProvider.buildWorkflowYaml({ mode: 'thorough', locale: 'en', maxRounds: 3, packageManager: 'pnpm' });
    expect(yaml).toContain('You are a code reviewer focused on correctness and security.');
    expect(yaml).toContain('focused exclusively on over-engineering');
  });

  it('ko locale carries the ko policy prompts and workflow instructions', () => {
    const yaml = cursorProvider.buildWorkflowYaml({ mode: 'thorough', locale: 'ko', maxRounds: 5, packageManager: 'pnpm' });
    expect(yaml).toContain('당신은 정확성(correctness)과 보안(security)에 집중하는 코드 리뷰어입니다.');
    expect(yaml).toContain('조치가 필요한 문제를 찾지 못했습니다');
    expect(yaml).toContain('-ge 5');
    expect(yaml).toMatchSnapshot();
  });

  it('never edits code or merges: the workflow instructions forbid it', () => {
    const en = cursorProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 1, packageManager: 'pnpm' });
    expect(en).toContain('Do not modify any code');
    expect(en).toContain('never approve or merge');
  });

  it('uses gh directly like claude/gemini: not sandboxed like the gpt provider', () => {
    const en = cursorProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 1, packageManager: 'pnpm' });
    expect(en).toContain('gh pr diff');
    expect(en).toContain('gh pr view');
  });

  it.each([
    ['fast', 'en'],
    ['thorough', 'ko'],
  ] as const)('heredoc invariants hold for %s/%s: no prompt line collides with the delimiter or carries leading whitespace', (mode, locale) => {
    const yaml = cursorProvider.buildWorkflowYaml({ mode, locale, maxRounds: 3, packageManager: 'pnpm' });
    // Recover the heredoc body exactly as bash will see it after YAML block-scalar stripping:
    // everything between the <<'DELIM' opener line and the terminator line, de-indented by
    // the opener's own indentation.
    const lines = yaml.split('\n');
    const openerIndex = lines.findIndex((line) => line.includes("<<'ARCHWEAVE_CURSOR_REVIEW_PROMPT'"));
    const indent = /^\s*/.exec(lines[openerIndex])?.[0] ?? '';
    const terminatorIndex = lines.findIndex(
      (line, i) => i > openerIndex && line === `${indent}ARCHWEAVE_CURSOR_REVIEW_PROMPT`,
    );
    expect(openerIndex).toBeGreaterThan(-1);
    expect(terminatorIndex).toBeGreaterThan(openerIndex);
    const body = lines.slice(openerIndex + 1, terminatorIndex).map((line) => line.slice(indent.length));
    expect(body.length).toBeGreaterThan(0);
    for (const line of body) {
      expect(line).not.toBe('ARCHWEAVE_CURSOR_REVIEW_PROMPT');
      expect(line).not.toMatch(/^\s+\S/); // no extra leading whitespace beyond the shared base indent
    }
  });
});

it('prompt instructs the machine-readable findings block (verdict pipeline contract)', () => {
  const yaml = cursorProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'pnpm' });
  expect(yaml).toContain('<!-- archweave-findings-v1 -->');
  expect(yaml).toContain('archweave/findings@1');
});

it('verdict gate step runs after the review step', () => {
  const yaml = cursorProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'pnpm' });
  expect(yaml).toContain('Compute review verdict');
  expect(yaml.indexOf('Compute review verdict')).toBeGreaterThan(yaml.indexOf('archweave-findings-v1'));
});

it('npm workspaces get npm ci before the verdict step', () => {
  const yaml = cursorProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'npm' });
  expect(yaml).toContain('npm ci');
  expect(yaml.indexOf('npm ci')).toBeLessThan(yaml.indexOf('Compute review verdict'));
});

it('fast and standard now produce different workflows', () => {
  const base = { locale: 'en', maxRounds: 3, packageManager: 'pnpm' } as const;
  const fast = cursorProvider.buildWorkflowYaml({ ...base, mode: 'fast' });
  const standard = cursorProvider.buildWorkflowYaml({ ...base, mode: 'standard' });
  expect(fast).not.toBe(standard);
  expect(fast).toContain('most critical');
  expect(fast).not.toMatch(/\bNit\b/);
  expect(standard).toContain('Correctness');
});

it('fast workflow is byte-pinned', () => {
  expect(cursorProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'pnpm' })).toMatchSnapshot();
});
