import { renderAddReviewReport, renderLineDiff, type AddReviewReport } from './render.ts';

function report(overrides: Partial<AddReviewReport> = {}): AddReviewReport {
  return {
    dryRun: false,
    workflowPath: '.github/workflows/claude-code-review.yml',
    workflowAction: 'created',
    configAction: 'created',
    requiredSecretName: 'CLAUDE_CODE_OAUTH_TOKEN',
    diff: null,
    workflowYaml: null,
    configSnippetJson: null,
    configError: null,
    dependabot: 'present',
    dependabotProposal: null,
    ...overrides,
  };
}

describe('renderLineDiff', () => {
  it('marks removed, added, and common lines', () => {
    const diff = renderLineDiff('a\nb\nc', 'a\nx\nc');
    expect(diff).toContain('--- existing');
    expect(diff).toContain('+++ generated');
    expect(diff).toContain('  a');
    expect(diff).toContain('- b');
    expect(diff).toContain('+ x');
    expect(diff).toContain('  c');
  });

  it('handles pure additions and pure removals', () => {
    expect(renderLineDiff('', 'new')).toContain('+ new');
    expect(renderLineDiff('old', '')).toContain('- old');
  });
});

describe('renderAddReviewReport', () => {
  it('created run lists both files and includes the two mandatory notices', () => {
    const text = renderAddReviewReport(report());
    expect(text).toContain('.github/workflows/claude-code-review.yml');
    expect(text).toContain('created');
    expect(text).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    // notice 1: secret registration (workflow green-skips until then)
    expect(text).toMatch(/secret/i);
    // notice 2: validates only after merging to the default branch
    expect(text).toMatch(/default branch/i);
  });

  it('proposed run shows the diff and the three rerun choices, and no write claims', () => {
    const text = renderAddReviewReport(
      report({ workflowAction: 'proposed', configAction: 'not-updated', diff: '--- existing\n+++ generated\n- old\n+ new' }),
    );
    expect(text).toContain('- old');
    expect(text).toContain('+ new');
    expect(text).toContain('--onConflict=overwrite');
    expect(text).toContain('--onConflict=skip');
    expect(text).toContain('--onConflict=alternate-filename');
    expect(text).not.toContain('created');
  });

  it('alternate run names the alt path and explains the manual swap', () => {
    const text = renderAddReviewReport(
      report({
        workflowAction: 'alternate',
        workflowPath: '.github/workflows/claude-code-review.archweave.yml',
        configAction: 'not-updated',
      }),
    );
    expect(text).toContain('claude-code-review.archweave.yml');
    expect(text).toMatch(/replace|swap/i);
  });

  it('aborted run reports the config error and fix guidance, without the notices', () => {
    const text = renderAddReviewReport(
      report({ workflowAction: 'aborted', configAction: 'aborted', configError: 'toolkit.config.json is not valid JSON' }),
    );
    expect(text).toContain('toolkit.config.json is not valid JSON');
    expect(text).toMatch(/fix .*rerun|rerun/i);
    expect(text).not.toMatch(/default branch/i);
  });

  it('dryRun run includes the full YAML and the snippet JSON and says nothing was written', () => {
    const text = renderAddReviewReport(
      report({ dryRun: true, workflowYaml: 'name: Claude Code Review', configSnippetJson: '{\n  "enabled": true\n}' }),
    );
    expect(text).toContain('name: Claude Code Review');
    expect(text).toContain('"enabled": true');
    expect(text).toMatch(/no files were (changed|written)/i);
  });
});
