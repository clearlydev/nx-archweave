import { ROUND_MARKER } from '../workflow-skeleton.ts';
import { gptProvider } from './gpt-provider.ts';

describe('gptProvider', () => {
  it('declares the fixed contract values', () => {
    expect(gptProvider.id).toBe('gpt');
    expect(gptProvider.workflowFileName).toBe('.github/workflows/gpt-code-review.yml');
    expect(gptProvider.requiredSecretName).toBe('OPENAI_API_KEY');
  });

  it('standard mode: skeleton, gates, action, prompt input, single review prompt', () => {
    const yaml = gptProvider.buildWorkflowYaml({ mode: 'standard', locale: 'en', maxRounds: 3, packageManager: 'pnpm' });
    expect(yaml).toContain('types: [opened, synchronize, ready_for_review, reopened]');
    expect(yaml).toContain('contents: read');
    expect(yaml).toContain('id: secret-gate');
    expect(yaml).toContain('id: round-gate');
    expect(yaml).toContain('-ge 3');
    expect(yaml).toContain('uses: openai/codex-action@v1');
    expect(yaml).toContain('openai-api-key: ${{ secrets.OPENAI_API_KEY }}');
    expect(yaml).toContain('permission-profile: ":read-only"');
    expect(yaml).toContain('gh pr comment "$PR_NUMBER" --body-file -');
    expect(yaml).toContain(
      "if: steps.secret-gate.outputs.enabled == 'true' && steps.round-gate.outputs.allowed == 'true'",
    );
    expect(yaml).toContain('You are a code reviewer focused on correctness and security.');
    expect(yaml).not.toContain('focused exclusively on over-engineering');
    expect(yaml).toContain(ROUND_MARKER);
    expect(yaml).toMatchSnapshot();
  });

  it('thorough mode appends the over-engineering pass per REVIEW_MODES', () => {
    const yaml = gptProvider.buildWorkflowYaml({ mode: 'thorough', locale: 'en', maxRounds: 3, packageManager: 'pnpm' });
    expect(yaml).toContain('You are a code reviewer focused on correctness and security.');
    expect(yaml).toContain('focused exclusively on over-engineering');
  });

  it('ko locale carries the ko policy prompts and workflow instructions', () => {
    const yaml = gptProvider.buildWorkflowYaml({ mode: 'thorough', locale: 'ko', maxRounds: 5, packageManager: 'pnpm' });
    expect(yaml).toContain('당신은 정확성(correctness)과 보안(security)에 집중하는 코드 리뷰어입니다.');
    expect(yaml).toContain('조치가 필요한 문제를 찾지 못했습니다');
    expect(yaml).toContain('-ge 5');
    expect(yaml).toMatchSnapshot();
  });

  it('never edits code or merges: the workflow instructions forbid it', () => {
    const en = gptProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 1, packageManager: 'pnpm' });
    expect(en).toContain('Do not modify any code');
    expect(en).toContain('never approve or merge');
  });

  it('has no network access inside the sandboxed step: diffs locally instead of via gh', () => {
    const en = gptProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 1, packageManager: 'pnpm' });
    expect(en).toContain('git diff');
    expect(en).not.toContain('gh pr diff');
  });
});

it('prompt instructs the machine-readable findings block (verdict pipeline contract)', () => {
  const yaml = gptProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'pnpm' });
  expect(yaml).toContain('<!-- archweave-findings-v1 -->');
  expect(yaml).toContain('archweave/findings@1');
});

it('verdict gate step runs after the review step', () => {
  const yaml = gptProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'pnpm' });
  expect(yaml).toContain('Compute review verdict');
  expect(yaml.indexOf('Compute review verdict')).toBeGreaterThan(yaml.indexOf('archweave-findings-v1'));
});

it('npm workspaces get npm ci before the verdict step', () => {
  const yaml = gptProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'npm' });
  expect(yaml).toContain('npm ci');
  expect(yaml.indexOf('npm ci')).toBeLessThan(yaml.indexOf('Compute review verdict'));
});

it('fast and standard now produce different workflows', () => {
  const base = { locale: 'en', maxRounds: 3, packageManager: 'pnpm' } as const;
  const fast = gptProvider.buildWorkflowYaml({ ...base, mode: 'fast' });
  const standard = gptProvider.buildWorkflowYaml({ ...base, mode: 'standard' });
  expect(fast).not.toBe(standard);
  expect(fast).toContain('most critical');
  expect(fast).not.toMatch(/\bNit\b/);
  expect(standard).toContain('Correctness');
});

it('fast workflow is byte-pinned', () => {
  expect(gptProvider.buildWorkflowYaml({ mode: 'fast', locale: 'en', maxRounds: 3, packageManager: 'pnpm' })).toMatchSnapshot();
});
