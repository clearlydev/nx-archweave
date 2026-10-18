import { existsSync, lstatSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const CONFIG_FILENAME = 'toolkit.config.json';

/**
 * - updated / unchanged: the id is now declared (unchanged = it already was).
 * - no-config: there is no toolkit.config.json — this writer never creates one,
 *   because its existence is what marks a workspace as toolkit-managed (doctor's
 *   pre-init checks key off it).
 * - unrecognized: the file is not a shape this writer understands (or is a
 *   symlink) and was left byte-untouched.
 */
export type DeclareEnabledIntegrationAction = 'updated' | 'unchanged' | 'unrecognized' | 'no-config';

function detectIndent(raw: string): string | undefined {
  if (!raw.includes('\n')) return undefined; // minified stays minified
  for (const line of raw.split(/\r?\n/)) {
    const match = /^(\t+| +)/.exec(line);
    if (match) return match[1];
  }
  return '  ';
}

// The declaration-side counterpart of readEnabledIntegrationIds:
// install-integration is the user saying "I want this
// tool", so it is the one writer allowed to put the id into
// ToolkitConfig.integrations.enabled. Merge-preserving (unrelated keys and
// sibling keys under `integrations` survive), indentation/minification, line-
// ending and trailing-newline preserving, idempotent, atomic (temp file +
// rename, like writeManifestAtomic), and a file that is not the expected shape
// is NEVER rewritten.
export function declareEnabledIntegration(
  root: string,
  id: string,
  options: { write: boolean },
): { action: DeclareEnabledIntegrationAction } {
  const configPath = join(root, CONFIG_FILENAME);
  if (!existsSync(configPath)) return { action: 'no-config' };
  if (lstatSync(configPath).isSymbolicLink()) return { action: 'unrecognized' };
  const raw = readFileSync(configPath, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { action: 'unrecognized' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { action: 'unrecognized' };
  const existing = parsed as Record<string, unknown>;

  const integrationsField = existing['integrations'];
  if (
    integrationsField !== undefined &&
    (typeof integrationsField !== 'object' || integrationsField === null || Array.isArray(integrationsField))
  ) {
    return { action: 'unrecognized' };
  }
  const integrations = (integrationsField as Record<string, unknown> | undefined) ?? {};
  const enabledField = integrations['enabled'];
  if (enabledField !== undefined && (!Array.isArray(enabledField) || !enabledField.every((e) => typeof e === 'string'))) {
    return { action: 'unrecognized' };
  }
  const enabled = (enabledField as string[] | undefined) ?? [];
  if (enabled.includes(id)) return { action: 'unchanged' };

  if (options.write) {
    const next = { ...existing, integrations: { ...integrations, enabled: [...enabled, id] } };
    let body = JSON.stringify(next, null, detectIndent(raw));
    if (raw.endsWith('\n')) body += '\n';
    if (raw.includes('\r\n')) body = body.replace(/\n/g, '\r\n');
    const tempPath = join(root, `.${CONFIG_FILENAME}.tmp-${randomBytes(6).toString('hex')}`);
    try {
      // temp + rename replaces the inode, so carry the original's permission bits over
      writeFileSync(tempPath, body, { mode: statSync(configPath).mode & 0o777 });
      renameSync(tempPath, configPath);
    } catch (error) {
      if (existsSync(tempPath)) unlinkSync(tempPath);
      throw error;
    }
  }
  return { action: 'updated' };
}
