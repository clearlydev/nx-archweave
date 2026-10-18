import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_FILENAME = 'toolkit.config.json';

// Reads only the `integrations.enabled` slice of the future ToolkitConfig schema —
// this is not a full ToolkitConfig reader/validator. A
// missing file, malformed JSON, or a missing/non-array field are all treated as
// "nothing declared" ([]), never as an error, mirroring loadManifest's existing
// tolerant-read precedent (manifest/manifest.ts).
//
// Two deliberate choices, both covered by tests: (1) if any entry is not a
// string, the whole array is rejected ([]) rather than silently filtering out
// the bad entries — a config file this malformed should read as "nothing
// declared", not as a partially-trusted list. (2) duplicate ids are returned
// as-is, not deduplicated here — detectIntegrationsDrift already builds its id
// set via `new Set(...)`, so a duplicate has no observable effect downstream;
// deduplicating in two places would be redundant, not safer.
export function readEnabledIntegrationIds(root: string): string[] {
  const configPath = join(root, CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    const enabled = parsed?.integrations?.enabled;
    return Array.isArray(enabled) && enabled.every((id: unknown) => typeof id === 'string') ? enabled : [];
  } catch {
    return [];
  }
}
