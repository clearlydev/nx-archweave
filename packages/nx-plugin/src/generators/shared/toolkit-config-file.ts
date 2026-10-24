import type { Tree } from '@nx/devkit';
import type { ToolkitAiHost, ToolkitFrontend } from '@nx-archweave/shared';
import { DEFAULT_AI_HOSTS, detectWorkspacePackageManager, isAiHost } from '@nx-archweave/template-engine';
import { applyJsonEdits } from './json-edit.ts';

export const TOOLKIT_CONFIG_PATH = 'toolkit.config.json';

export { detectIndent } from './json-edit.ts';

export interface ToolkitConfigFile {
  /** null = the file is absent. */
  raw: string | null;
  /** null = absent, unparseable, or not a JSON object. A writer that merges into
   * the file must refuse whenever raw is non-null and parsed is null. */
  parsed: Record<string, unknown> | null;
}

/** Best-effort read of toolkit.config.json. Never throws: the generators that read
 * defaults from it (locale, boundaries, teamRules) must not abort on a broken file
 * they do not own, and the ones that merge into it refuse to rewrite an
 * unrecognized shape — both decide from this one result. */
export function readToolkitConfigFile(tree: Tree): ToolkitConfigFile {
  const raw = tree.read(TOOLKIT_CONFIG_PATH, 'utf-8');
  if (raw === null) return { raw: null, parsed: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    return {
      raw,
      parsed: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null,
    };
  } catch {
    return { raw, parsed: null };
  }
}

/** The parsed object only — for readers that just want defaults. */
export function readToolkitConfig(tree: Tree): Record<string, unknown> | null {
  return readToolkitConfigFile(tree).parsed;
}

/** option > toolkit.config.json `locale` > 'en' — the fallback every content
 * generator shares; anything that is not ko/en is ignored, never an abort. */
export function resolveLocaleOption(option: 'ko' | 'en' | undefined, config: Record<string, unknown> | null): 'ko' | 'en' {
  if (option) return option;
  const locale = config?.['locale'];
  return locale === 'ko' || locale === 'en' ? locale : 'en';
}

/** A recorded choice init wrote, when it is one of `allowed`; anything else is ignored. */
export function recordedChoice<T extends string>(config: Record<string, unknown> | null, key: string, allowed: readonly T[]): T | undefined {
  const value = config?.[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export const RECORDED_FRONTENDS = ['react-vite', 'next', 'expo', 'generic', 'none'] as const;
export const RECORDED_BACKENDS = ['express', 'nest', 'none'] as const;
export const RECORDED_PRESETS = ['quick-start', 'solo', 'team'] as const;
export const RECORDED_PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;

/** option > toolkit.config.json `frontend` (init records it); a run without either cannot
 * pick the layer set, so it stops with the flag to pass. A backend-only workspace
 * (`frontend: none`) has no frontend to structure, which stops the FSD generators too. */
export function resolveFrontendOption(
  option: ToolkitFrontend | undefined,
  config: Record<string, unknown> | null,
  generator: string,
): ToolkitFrontend {
  const frontend = option ?? recordedChoice(config, 'frontend', RECORDED_FRONTENDS);
  if (frontend === undefined) {
    throw new Error(`${generator}: pass --frontend=react-vite|next|expo|generic (toolkit.config.json records none — init writes it).`);
  }
  if (frontend === 'none') {
    throw new Error(
      `${generator}: this is a backend-only workspace (toolkit.config.json frontend: none) — FSD structures a frontend app. Pass --frontend=react-vite|next|expo|generic if you added one.`,
    );
  }
  return frontend;
}

/** init's frontend axis: like resolveFrontendOption, but `none` (backend-only) is a choice. */
export function resolveInitFrontend(
  option: (typeof RECORDED_FRONTENDS)[number] | undefined,
  config: Record<string, unknown> | null,
): (typeof RECORDED_FRONTENDS)[number] {
  const frontend = option ?? recordedChoice(config, 'frontend', RECORDED_FRONTENDS);
  if (frontend === undefined) {
    throw new Error('init: pass --frontend=react-vite|next|expo|generic|none (toolkit.config.json records none — init writes it).');
  }
  return frontend;
}

/** The workspace's package manager: its lockfiles first (they are what installs run with,
 * even after a switch), then the one init recorded; null when neither says. */
export function workspacePackageManager(
  exists: (path: string) => boolean,
  read: (path: string) => string | null | undefined,
  config: Record<string, unknown> | null,
): (typeof RECORDED_PACKAGE_MANAGERS)[number] | null {
  return detectWorkspacePackageManager(exists, read) ?? recordedChoice(config, 'packageManager', RECORDED_PACKAGE_MANAGERS) ?? null;
}

export function treePackageManager(tree: Tree, config: Record<string, unknown> | null): (typeof RECORDED_PACKAGE_MANAGERS)[number] | null {
  return workspacePackageManager((p) => tree.exists(p), (p) => tree.read(p, 'utf-8'), config);
}

/** Option (non-empty, deduped) > toolkit.config.json `aiHosts`
 * (its known ids) > Claude Code. Shared by add-agent-rules and init, so a standalone run of
 * either keeps the hosts a workspace was set up for. */
export function resolveAiHostsOption(
  option: readonly ToolkitAiHost[] | undefined,
  config: Record<string, unknown> | null,
): ToolkitAiHost[] {
  if (option !== undefined && option.length > 0) return [...new Set(option)];
  const recorded = config?.['aiHosts'];
  const fromConfig = Array.isArray(recorded) ? [...new Set(recorded.filter(isAiHost))] : [];
  return fromConfig.length > 0 ? fromConfig : [...DEFAULT_AI_HOSTS];
}

export type AiHostsRecordOutcome = 'created' | 'updated' | 'unchanged' | 'unrecognized';

/** Writes `aiHosts` into toolkit.config.json: merge-preserving (every other key survives),
 * indent-preserving, idempotent; a file that is not a JSON object is never rewritten. */
export function recordAiHosts(tree: Tree, hosts: readonly ToolkitAiHost[], write: boolean): AiHostsRecordOutcome {
  const { raw, parsed } = readToolkitConfigFile(tree);
  if (raw !== null && parsed === null) return 'unrecognized';
  const existing = parsed ?? {};
  const recorded = existing['aiHosts'];
  if (Array.isArray(recorded) && recorded.length === hosts.length && recorded.every((id, index) => id === hosts[index])) {
    return 'unchanged';
  }
  if (write) tree.write(TOOLKIT_CONFIG_PATH, applyJsonEdits(raw, [[['aiHosts'], [...hosts]]]));
  return raw === null ? 'created' : 'updated';
}

/** The projects `init --project` recorded in toolkit.config.json's `frontends`. */
export function recordedFrontends(config: Record<string, unknown> | null): string[] {
  const frontends = config?.['frontends'];
  if (!Array.isArray(frontends)) return [];
  return frontends.flatMap((entry) =>
    typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>)['project'] === 'string' ? [(entry as { project: string }).project] : [],
  );
}
