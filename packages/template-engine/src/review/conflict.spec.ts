import { judgeReviewFileConflict } from './conflict.ts';

describe('judgeReviewFileConflict', () => {
  it('create when no existing file', () => {
    expect(judgeReviewFileConflict(null, 'generated')).toEqual({ kind: 'create' });
  });

  it('unchanged when contents match exactly (idempotency basis)', () => {
    expect(judgeReviewFileConflict('same', 'same')).toEqual({ kind: 'unchanged' });
  });

  it('merge-proposal carries both contents verbatim', () => {
    expect(judgeReviewFileConflict('old', 'new')).toEqual({
      kind: 'merge-proposal',
      existing: 'old',
      generated: 'new',
    });
  });
});
