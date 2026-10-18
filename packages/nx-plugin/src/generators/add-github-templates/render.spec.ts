import { renderAddGithubTemplatesReport, type AddGithubTemplatesReport, type GithubTemplateFileResult } from './render.ts';

function file(overrides: Partial<GithubTemplateFileResult> = {}): GithubTemplateFileResult {
  return { filePath: '.github/PULL_REQUEST_TEMPLATE.md', action: 'created', content: 'PR template content', ...overrides };
}

function report(overrides: Partial<AddGithubTemplatesReport> = {}): AddGithubTemplatesReport {
  return { dryRun: false, files: [file()], ...overrides };
}

describe('renderAddGithubTemplatesReport', () => {
  it('nothing selected: reports that with no files listed', () => {
    const text = renderAddGithubTemplatesReport(report({ files: [] }));
    expect(text).toMatch(/nothing selected/i);
  });

  it('created run reports the file path and the created action', () => {
    const text = renderAddGithubTemplatesReport(report());
    expect(text).toContain('.github/PULL_REQUEST_TEMPLATE.md');
    expect(text).toContain('created');
  });

  it('unchanged run says it already matches the generated version', () => {
    const text = renderAddGithubTemplatesReport(report({ files: [file({ action: 'unchanged' })] }));
    expect(text).toMatch(/unchanged/i);
    expect(text).toMatch(/already matches/i);
  });

  it('skipped run explains templates are never overwritten and does not claim a write', () => {
    const text = renderAddGithubTemplatesReport(report({ files: [file({ action: 'skipped' })] }));
    expect(text).toMatch(/left as-is/i);
    expect(text).toMatch(/never overwritten/i);
  });

  it('mixed created/skipped files each get their own reported action', () => {
    const text = renderAddGithubTemplatesReport(
      report({
        files: [
          file({ filePath: '.github/ISSUE_TEMPLATE/bug-report.yml', action: 'created' }),
          file({ filePath: '.github/PULL_REQUEST_TEMPLATE.md', action: 'skipped' }),
        ],
      }),
    );
    expect(text).toContain('.github/ISSUE_TEMPLATE/bug-report.yml: created');
    expect(text).toContain('.github/PULL_REQUEST_TEMPLATE.md: left as-is');
  });

  it('dryRun run previews the full content of every file and says nothing was written', () => {
    const text = renderAddGithubTemplatesReport(
      report({ dryRun: true, files: [file({ content: 'FULL RENDERED CONTENT HERE' })] }),
    );
    expect(text).toContain('FULL RENDERED CONTENT HERE');
    expect(text).toMatch(/no files were written/i);
  });
});
