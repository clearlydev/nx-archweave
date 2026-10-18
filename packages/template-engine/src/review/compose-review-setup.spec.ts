import { composeReviewSetup, type ReviewSetupInput } from './compose-review-setup.ts';

const input: ReviewSetupInput = {
  enabled: true,
  provider: 'claude',
  packageManager: 'pnpm',
  mode: 'standard',
  locale: 'ko',
  maxRounds: 3,
};

describe('composeReviewSetup', () => {
  it('returns null when review is disabled — zero artifacts', () => {
    expect(composeReviewSetup({ ...input, enabled: false })).toBeNull();
  });

  it('returns a plan whose fields agree with the provider contract', () => {
    const plan = composeReviewSetup(input);
    expect(plan).not.toBeNull();
    expect(plan?.workflowFilePath).toBe('.github/workflows/claude-code-review.yml');
    expect(plan?.requiredSecretName).toBe('CLAUDE_CODE_OAUTH_TOKEN');
    expect(plan?.workflowYaml).toContain('anthropics/claude-code-action@v1');
  });

  it('config snippet is the flat shape — no nested policy duplication', () => {
    const snippet = composeReviewSetup(input)?.configSnippet;
    expect(snippet).toEqual({
      enabled: true,
      provider: 'claude',
      mode: 'standard',
      locale: 'ko',
      maxRounds: 3,
      blockingPriorities: ['P0', 'P1'],
    });
  });
});
