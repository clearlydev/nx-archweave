import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { doctorGenerator } from './generator.ts';

describe('doctorGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('runs without writing any files to the tree', async () => {
    const changesBefore = tree.listChanges();
    await doctorGenerator(tree, {});
    expect(tree.listChanges()).toEqual(changesBefore);
  });
});

describe('doctor --json', () => {
  it('prints ONLY the serialized report — no console rendering, no read-only tail', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((msg: string) => void lines.push(String(msg)));
    try {
      await doctorGenerator(createTreeWithEmptyWorkspace(), { json: true });
    } finally {
      spy.mockRestore();
    }
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.schema).toBe('archweave/doctor-report@1');
    expect(parsed.summary).toBeDefined();
    expect(lines[0]).not.toContain('read-only — no files were changed');
  });

  it('default (no flag) keeps the human report and the read-only tail', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((msg: string) => void lines.push(String(msg)));
    try {
      await doctorGenerator(createTreeWithEmptyWorkspace(), {});
    } finally {
      spy.mockRestore();
    }
    expect(lines.join('\n')).toContain('read-only — no files were changed');
  });
});
