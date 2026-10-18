import { renderRecordIntegrationView } from './render.ts';
import type { RecordIntegrationView } from './render.ts';

function view(overrides: Partial<RecordIntegrationView> = {}): RecordIntegrationView {
  return {
    tool: 'ponytail',
    target: 'claude-code',
    sourceRepository: 'https://github.com/DietrichGebert/ponytail',
    license: 'MIT',
    verificationSource: 'claude-cli',
    verification: { verified: true, resolvedVersion: '4.8.4', problems: [] },
    existingEntry: undefined,
    proposedEntry: {
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      version: '4.8.4',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'nx-archweave',
      verification: 'passed',
      target: 'claude-code',
      evidenceKind: 'claude-cli',
    },
    hasConflict: false,
    wasWritten: false,
    ...overrides,
  };
}

describe('renderRecordIntegrationView', () => {
  it('shows the verification source label', () => {
    const output = renderRecordIntegrationView(view());
    expect(output).toContain('claude-cli');
  });

  it('shows the proposed entry when one exists', () => {
    const output = renderRecordIntegrationView(view());
    expect(output).toContain('would be recorded');
    expect(output).toContain('4.8.4');
  });

  it('states clearly when nothing would be recorded (verification failed)', () => {
    const output = renderRecordIntegrationView(
      view({
        verification: { verified: false, problems: ['not found'] },
        proposedEntry: undefined,
      }),
    );
    expect(output.toLowerCase()).toContain('not');
    expect(output).toContain('not found');
  });

  it('never renders installPath or any absolute path', () => {
    const output = renderRecordIntegrationView(view());
    expect(output).not.toMatch(/installPath/i);
    expect(output).not.toMatch(/\/Users\/|\/home\//);
  });

  it('never prints raw CLI JSON', () => {
    const output = renderRecordIntegrationView(view());
    expect(output).not.toMatch(/^\[/m);
  });

  it('shows a conflict when the existing entry differs from the proposed one', () => {
    const output = renderRecordIntegrationView(
      view({
        existingEntry: {
          source: 'DietrichGebert/ponytail',
          repository: 'https://github.com/DietrichGebert/ponytail',
          version: '4.7.0',
          method: 'claude-code-plugin-marketplace',
          managedBy: 'nx-archweave',
          verification: 'passed',
        },
        hasConflict: true,
      }),
    );
    expect(output.toLowerCase()).toContain('conflict');
    expect(output).toContain('4.7.0');
  });

  it('states whether the entry was actually written', () => {
    const written = renderRecordIntegrationView(view({ wasWritten: true }));
    expect(written.toLowerCase()).toContain('recorded');
    const notWritten = renderRecordIntegrationView(view({ wasWritten: false }));
    expect(notWritten.toLowerCase()).toMatch(/dry-run|preview|not written/);
  });

  it('produces byte-identical output for identical input (determinism)', () => {
    const input = view();
    expect(renderRecordIntegrationView(input)).toBe(renderRecordIntegrationView(input));
  });
});
