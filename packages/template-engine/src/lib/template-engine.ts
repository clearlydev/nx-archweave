import { archweaveVersion } from '@nx-archweave/shared';

export function describeEngine(): string {
  return `template-engine@${archweaveVersion()}`;
}
