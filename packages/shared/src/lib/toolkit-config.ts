import type { ConflictResolution } from './init-plan.ts';

/**
 * Review-agnostic slice of `ToolkitConfig`. This lives in `shared`
 * because `shared` is a dependency leaf and must not reference
 * `review-policy`. The complete `ToolkitConfig` — this base plus the `review` field —
 * is assembled one layer up, in `template-engine`, which is allowed to depend on both
 * `shared` and `review-policy` (see `@nx-archweave/template-engine`'s `toolkit-config.ts`).
 */
export type ToolkitPreset = 'quick-start' | 'solo' | 'team';
export type ToolkitPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
/** A frontend framework nx-archweave knows (its profile lives in template-engine), or `generic`
 * for any other: the common FSD rules without framework-specific layer names. */
export type ToolkitFrontend = 'react-vite' | 'next' | 'expo' | 'generic';
/** The workspace's frontend axis: a framework, or `none` for a backend-only workspace (no FSD). */
export type ToolkitFrontendChoice = ToolkitFrontend | 'none';
export type ToolkitBackend = 'express' | 'nest' | 'none';
/** Review/doc language — a language policy generalized into a config value. */
export type ToolkitLocale = 'ko' | 'en';

export type FsdLayerName = 'app' | 'pages' | 'features' | 'entities' | 'shared';
/** @deprecated Use FsdLayerName — which layers a framework gets is its profile's business. */
export type ReactViteFsdLayer = FsdLayerName;
/** @deprecated Use FsdLayerName. */
export type NextFsdLayer = FsdLayerName;

/**
 * How hard the `archweave/fsd-boundaries` ESLint rule reports a violation.
 * The rule itself is one — canonical FSD; only its severity is preset-specific:
 * `error` for Team, `warn` for Solo / Quick Start ("rules, without over-enforcing").
 */
export type FsdEnforcement = 'error' | 'warn';

/** Reads a recorded `fsd` object's enforcement; undefined when it is missing or unusable. */
export function readFsdEnforcement(fsd: unknown): FsdEnforcement | undefined {
  if (typeof fsd !== 'object' || fsd === null) return undefined;
  const enforcement = (fsd as Record<string, unknown>)['enforcement'];
  return enforcement === 'error' || enforcement === 'warn' ? enforcement : undefined;
}

export interface ToolkitFsdConfig {
  enabled: boolean;
  enforcement: FsdEnforcement;
  /** The layer set per frontend, from the framework profiles (template-engine). */
  layerMapping: Record<ToolkitFrontend, FsdLayerName[]>;
}

/** The AI coding tools (hosts) a workspace is set up for.
 * The agent-rules files follow from them — the table lives in template-engine. */
export type ToolkitAiHost = 'claude-code' | 'codex' | 'cursor' | 'gemini-cli';

export interface ToolkitAgentRulesConfig {
  /** Whether the composed documents carry the Team Rules section.
   * Only the team preset turns this on by default. */
  teamRules: boolean;
}

export interface ToolkitGithubTemplatesConfig {
  issue: boolean;
  pr: boolean;
  codeowners: boolean;
}

/** Reuses `ConflictResolution` (init-plan.ts) — generator conflict resolutions and the
 * config-level default are the same three-value policy; keeping one union avoids drift. */
export interface ToolkitConflictPolicyConfig {
  default: ConflictResolution;
}

export interface ToolkitIntegrationsConfig {
  /** Integration ids the user explicitly opted into via `add-integration`.
   * No preset fills this automatically. */
  enabled: string[];
}

/** The default for `conflictPolicy.default`. */
export const DEFAULT_CONFLICT_POLICY: ConflictResolution = 'merge-proposal';

/** The review-agnostic fields of `ToolkitConfig`, owned by `shared`. */
export interface ToolkitConfigBase {
  preset: ToolkitPreset;
  packageManager: ToolkitPackageManager;
  frontend: ToolkitFrontendChoice;
  backend: ToolkitBackend;
  locale: ToolkitLocale;
  /** Multi-select, in the order picked; the first one sets the review provider default. */
  aiHosts: ToolkitAiHost[];
  fsd: ToolkitFsdConfig;
  agentRules: ToolkitAgentRulesConfig;
  githubTemplates: ToolkitGithubTemplatesConfig;
  conflictPolicy: ToolkitConflictPolicyConfig;
  integrations: ToolkitIntegrationsConfig;
}
