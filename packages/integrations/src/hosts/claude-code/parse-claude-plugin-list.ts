export interface ClaudePluginListEntry {
  id: string;
  version?: string;
  scope: 'user' | 'project' | 'local' | 'managed';
  enabled: boolean;
  // installPath, installedAt, lastUpdated are intentionally NOT part of this type —
  // they are machine-specific (an absolute path, timestamps). They are dropped at this
  // parsing boundary so nothing downstream can
  // accidentally persist or display them.
}

export type ParsedPluginList =
  | {
      ok: true;
      entries: ClaudePluginListEntry[];
      /** Ids listed at a scope this parser does not know. Claude Code adds scopes (2.1.300
       * lists account-synced plugins as `"scope": "synced"`, measured 2026-10-15), so such an
       * entry must not void the list for every other plugin — the caller decides whether
       * the one plugin it asks about is among them. */
      otherScopeIds: string[];
    }
  | { ok: false; reason: 'invalid-json' | 'non-array' | 'missing-fields' };

const KNOWN_SCOPES = new Set(['user', 'project', 'local', 'managed']);

type RawEntry = Omit<ClaudePluginListEntry, 'scope'> & { scope: string; projectPath?: unknown };

export interface ParseClaudePluginListOptions {
  /** Whether a project-scope entry's `projectPath` is the workspace being asked about. The
   * list also reports project-scope installs of the user's OTHER projects (measured, Claude
   * Code 2.1.300: `"projectPath": "<elsewhere>"`, `"enabled": false`) — those say nothing
   * about this workspace and are dropped. Omitted: every entry counts. */
  isThisWorkspace?: (projectPath: string) => boolean;
}

function isKnownScope(scope: string): scope is ClaudePluginListEntry['scope'] {
  return KNOWN_SCOPES.has(scope);
}

function isValidEntry(value: unknown): value is RawEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string') {
    return false;
  }
  if (typeof record['enabled'] !== 'boolean') {
    return false;
  }
  if (typeof record['scope'] !== 'string' || record['scope'].length === 0) {
    return false;
  }
  if (record['version'] !== undefined && typeof record['version'] !== 'string') {
    return false;
  }
  return true;
}

// Strict — never trusts raw unknown JSON. Every entry is validated before any
// field is trusted; a single invalid entry rejects the whole list rather than
// silently dropping it ("unexpected JSON schema" is always a
// distinct verification error, never a partial success). A well-formed entry at an
// unknown scope is not malformed: it is set aside in otherScopeIds, never dropped.
export function parseClaudePluginList(rawStdout: string, options: ParseClaudePluginListOptions = {}): ParsedPluginList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawStdout);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'non-array' };
  }

  const entries: ClaudePluginListEntry[] = [];
  const otherScopeIds: string[] = [];
  for (const item of parsed) {
    if (!isValidEntry(item)) {
      return { ok: false, reason: 'missing-fields' };
    }
    // The path itself is only compared here, never kept.
    if (typeof item.projectPath === 'string' && options.isThisWorkspace && !options.isThisWorkspace(item.projectPath)) {
      continue;
    }
    const scope = item.scope;
    if (!isKnownScope(scope)) {
      otherScopeIds.push(item.id);
      continue;
    }
    entries.push({
      id: item.id,
      version: item.version,
      scope,
      enabled: item.enabled,
    });
  }

  return { ok: true, entries, otherScopeIds };
}
