import { sameFileText } from '@nx-archweave/shared';

export type ReviewFileConflictVerdict =
  | { kind: 'create' }
  | { kind: 'unchanged' }
  | { kind: 'merge-proposal'; existing: string; generated: string };

/** Same content (ignoring CRLF and a leading BOM, see sameFileText) is unchanged; anything
 * else is a merge proposal. Diff rendering and user approval belong to the generator layer;
 * this module just supplies the verdict and both contents. */
export function judgeReviewFileConflict(
  existing: string | null,
  generated: string,
): ReviewFileConflictVerdict {
  if (existing === null) return { kind: 'create' };
  if (sameFileText(existing, generated)) return { kind: 'unchanged' };
  return { kind: 'merge-proposal', existing, generated };
}
