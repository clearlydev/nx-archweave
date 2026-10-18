export type ReviewFileConflictVerdict =
  | { kind: 'create' }
  | { kind: 'unchanged' }
  | { kind: 'merge-proposal'; existing: string; generated: string };

/** Exact-match only: diff rendering and user approval belong to the
 * generator layer; this module just supplies the verdict and both contents. */
export function judgeReviewFileConflict(
  existing: string | null,
  generated: string,
): ReviewFileConflictVerdict {
  if (existing === null) return { kind: 'create' };
  if (existing === generated) return { kind: 'unchanged' };
  return { kind: 'merge-proposal', existing, generated };
}
