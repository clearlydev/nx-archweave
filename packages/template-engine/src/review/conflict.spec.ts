import { judgeReviewFileConflict } from './conflict.ts';

describe('judgeReviewFileConflict', () => {
  it('create when no existing file', () => {
    expect(judgeReviewFileConflict(null, 'generated')).toEqual({ kind: 'create' });
  });

  it('unchanged when contents match exactly (idempotency basis)', () => {
    expect(judgeReviewFileConflict('same', 'same')).toEqual({ kind: 'unchanged' });
  });

  it('unchanged when only CRLF line endings or a leading BOM differ (a Windows checkout)', () => {
    expect(judgeReviewFileConflict('name: x\r\non: push\r\n', 'name: x\non: push\n')).toEqual({ kind: 'unchanged' });
    expect(judgeReviewFileConflict('\uFEFFname: x\n', 'name: x\n')).toEqual({ kind: 'unchanged' });
  });

  it('a CRLF file with a real change is still a merge proposal, carried verbatim', () => {
    expect(judgeReviewFileConflict('name: y\r\n', 'name: x\n')).toEqual({
      kind: 'merge-proposal',
      existing: 'name: y\r\n',
      generated: 'name: x\n',
    });
  });

  it('merge-proposal carries both contents verbatim', () => {
    expect(judgeReviewFileConflict('old', 'new')).toEqual({
      kind: 'merge-proposal',
      existing: 'old',
      generated: 'new',
    });
  });
});
