import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';

// Isolated in its own file: mocking '../add-fsd-lite/generator.js' here would otherwise
// poison every other init test (jest.mock is file-scoped) — and jest.spyOn can't
// redefine this build's named exports (non-configurable getters), so a module mock is
// the only way to force runAddFsdLite to throw for this specific test.
const mockRunAddFsdLite = jest.fn();
jest.mock('../add-fsd-lite/generator.ts', () => ({
  runAddFsdLite: (...args: unknown[]) => mockRunAddFsdLite(...args),
}));

import { runInit, type InitDeps } from './generator.ts';

const CLEAN: InitDeps = { isWorkingTreeClean: () => true };

describe('runInit — fsd throw folds into an aborted-style section, pipeline continues', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    mockRunAddFsdLite.mockReset();
  });

  it('catches a raw throw from runAddFsdLite, folds it into the fsd section, and still runs the rest', () => {
    mockRunAddFsdLite.mockImplementation(() => {
      throw new Error('boom: unexpected add-fsd-lite failure');
    });

    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);

    const fsd = report.sections.find((s) => s.id === 'fsd');
    expect(fsd?.enabled).toBe(true);
    expect(fsd?.report).toBeNull();
    expect(fsd?.thrownError).toBe('boom: unexpected add-fsd-lite failure');

    const agentRules = report.sections.find((s) => s.id === 'agentRules');
    expect(agentRules?.report?.kind).toBe('agentRules');
    const githubTemplates = report.sections.find((s) => s.id === 'githubTemplates');
    expect(githubTemplates?.report?.kind).toBe('githubTemplates');
    const review = report.sections.find((s) => s.id === 'review');
    expect(review?.report?.kind).toBe('review');

    // The rest of the pipeline actually wrote files despite the fsd throw.
    expect(tree.exists('CLAUDE.md')).toBe(true);
  });

  it('folds a non-Error throw (e.g. a thrown string) into a stringified message', () => {
    mockRunAddFsdLite.mockImplementation(() => {
      throw 'plain string failure';
    });

    const report = runInit(tree, { preset: 'quick-start', frontend: 'react-vite' }, CLEAN);
    const fsd = report.sections.find((s) => s.id === 'fsd');
    expect(fsd?.thrownError).toBe('plain string failure');
  });
});
