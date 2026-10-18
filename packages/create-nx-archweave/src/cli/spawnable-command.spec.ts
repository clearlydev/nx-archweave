import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The CLI imports nothing, so it carries a copy of @nx-archweave/shared's helper (tested
// there). This keeps the copy byte-identical.
it('spawnable-command.ts equals the shared copy', () => {
  const shared = readFileSync(join(__dirname, '../../../shared/src/lib/spawnable-command.ts'), 'utf8');
  expect(readFileSync(join(__dirname, 'spawnable-command.ts'), 'utf8')).toBe(shared);
});
