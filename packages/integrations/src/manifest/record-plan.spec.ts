import { buildRecordPlan } from './record-plan.ts';
import type { IntegrationManifestEntry } from './manifest.ts';

const METADATA = {
  source: 'DietrichGebert/ponytail',
  repository: 'https://github.com/DietrichGebert/ponytail',
  method: 'claude-code-plugin-marketplace',
};

describe('buildRecordPlan', () => {
  it('proposes no entry when verification fails', () => {
    const plan = buildRecordPlan({
      id: 'ponytail',
      target: 'claude-code',
      verificationSource: 'claude-cli',
      verification: { verified: false, problems: ['not found'] },
      existingEntry: undefined,
      metadata: METADATA,
    });
    expect(plan.proposedEntry).toBeUndefined();
    expect(plan.hasConflict).toBe(false);
  });

  it('proposes a passed entry when verification succeeds via the claude-cli source', () => {
    const plan = buildRecordPlan({
      id: 'ponytail',
      target: 'claude-code',
      verificationSource: 'claude-cli',
      verification: { verified: true, resolvedVersion: '4.8.4', problems: [] },
      existingEntry: undefined,
      metadata: METADATA,
    });
    expect(plan.proposedEntry).toEqual({
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      version: '4.8.4',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'nx-archweave',
      verification: 'passed',
      target: 'claude-code',
      evidenceKind: 'claude-cli',
    });
  });

  it('never proposes a recordable entry when verificationSource is package-json, even if verified is true — the critical rule', () => {
    const plan = buildRecordPlan({
      id: 'ponytail',
      target: 'claude-code',
      verificationSource: 'package-json',
      verification: { verified: true, resolvedVersion: '4.8.4', problems: [] },
      existingEntry: undefined,
      metadata: METADATA,
    });
    expect(plan.proposedEntry).toBeUndefined();
  });

  it('allows a proposed entry with no version when the CLI reports none', () => {
    const plan = buildRecordPlan({
      id: 'ponytail',
      target: 'claude-code',
      verificationSource: 'claude-cli',
      verification: { verified: true, resolvedVersion: undefined, problems: [] },
      existingEntry: undefined,
      metadata: METADATA,
    });
    expect(plan.proposedEntry?.version).toBeUndefined();
    expect(plan.proposedEntry?.verification).toBe('passed');
  });

  it('flags a conflict when an existing entry differs from the proposed one', () => {
    const existingEntry: IntegrationManifestEntry = {
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      version: '4.8.4',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'nx-archweave',
      verification: 'passed',
    };
    const plan = buildRecordPlan({
      id: 'ponytail',
      target: 'claude-code',
      verificationSource: 'claude-cli',
      verification: { verified: true, resolvedVersion: '4.9.0', problems: [] },
      existingEntry,
      metadata: METADATA,
    });
    expect(plan.hasConflict).toBe(true);
  });

  it('never flags a conflict when there is no existing entry', () => {
    const plan = buildRecordPlan({
      id: 'ponytail',
      target: 'claude-code',
      verificationSource: 'claude-cli',
      verification: { verified: true, resolvedVersion: '4.8.4', problems: [] },
      existingEntry: undefined,
      metadata: METADATA,
    });
    expect(plan.hasConflict).toBe(false);
  });

  it('never flags a conflict when the existing entry matches the proposed one exactly', () => {
    const existingEntry: IntegrationManifestEntry = {
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      version: '4.8.4',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'nx-archweave',
      verification: 'passed',
      target: 'claude-code',
      evidenceKind: 'claude-cli',
    };
    const plan = buildRecordPlan({
      id: 'ponytail',
      target: 'claude-code',
      verificationSource: 'claude-cli',
      verification: { verified: true, resolvedVersion: '4.8.4', problems: [] },
      existingEntry,
      metadata: METADATA,
    });
    expect(plan.hasConflict).toBe(false);
  });

  it('treats a malformed prior manifest (already normalized to "no entry" by loadManifest) as no conflict', () => {
    const plan = buildRecordPlan({
      id: 'ponytail',
      target: 'claude-code',
      verificationSource: 'claude-cli',
      verification: { verified: true, resolvedVersion: '4.8.4', problems: [] },
      existingEntry: undefined,
      metadata: METADATA,
    });
    expect(plan.hasConflict).toBe(false);
  });
});
