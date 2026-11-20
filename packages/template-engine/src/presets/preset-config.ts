import type {
  FsdEnforcement,
  ToolkitAiHost,
  ToolkitBackend,
  ToolkitFrontendChoice,
  ToolkitGithubTemplatesConfig,
  ToolkitLocale,
  ToolkitPackageManager,
  ToolkitPreset,
} from '@nx-archweave/shared';
import { DEFAULT_CONFLICT_POLICY } from '@nx-archweave/shared';
import { DEFAULT_MAX_ROUNDS, type ReviewMode } from '@nx-archweave/review-policy';
import type { ToolkitConfig } from '../toolkit-config.ts';
import { buildReviewConfigSnippet } from '../review/config-snippet.ts';
import { DEFAULT_AI_HOSTS, reviewProviderFor } from '../ai-hosts/ai-hosts.ts';
import type { ReviewProviderId } from '../review/provider.ts';
import { allFrameworkProfiles } from '../frameworks/profiles.ts';

export interface PresetConfigInput {
  preset: ToolkitPreset;
  frontend: ToolkitFrontendChoice;
  // backend is an axis, not preset policy — passed through unmapped.
  backend: ToolkitBackend;
  locale: ToolkitLocale;
  packageManager: ToolkitPackageManager;
  /** Review is opt-in for quick-start (and its alias solo) and on for team. An explicit
   * value always wins over the preset's default. */
  reviewEnabled?: boolean;
  /** The AI hosts picked; omitted → the default host. They
   * decide the agent-rules files and the review provider default — the preset no longer
   * picks files. */
  aiHosts?: ToolkitAiHost[];
  /** An explicit review provider; omitted → the first AI host's (reviewProviderFor). */
  reviewProvider?: ReviewProviderId;
}

/**
 * Layer composition is frontend-specific, not preset-specific — every preset uses the SAME
 * mapping for a given frontend, and that mapping is the framework profile's (Next.js omits
 * 'app' because its own app/ directory is already the entry point). Team's stricter module
 * boundaries come from a stricter `depConstraints` SNIPPET from `add-fsd-lite`, not a
 * different layer list — it rides on `ToolkitFsdConfig.enforcement`, the one preset-specific
 * field in here.
 */
function buildFsdConfig(enforcement: FsdEnforcement, frontend: ToolkitFrontendChoice): ToolkitConfig['fsd'] {
  return {
    // All three presets enable FSD — it is on whenever there is a
    // frontend; a backend-only workspace has none to structure.
    enabled: frontend !== 'none',
    enforcement,
    layerMapping: Object.fromEntries(allFrameworkProfiles().map((profile) => [profile.id, [...profile.layers]])) as ToolkitConfig['fsd']['layerMapping'],
  };
}

interface PresetDefaults {
  /** Whether review is on when the caller does not pass `reviewEnabled` explicitly. */
  reviewEnabledDefault: boolean;
  reviewMode: ReviewMode;
  /** `add-fsd-lite`: `error` is Team's stricter module boundaries; the rule is
   * the same canonical one everywhere. */
  fsdEnforcement: FsdEnforcement;
  /** `add-agent-rules`: true is Team's extra team-rules section. */
  agentRulesTeamRules: boolean;
  githubTemplates: ToolkitGithubTemplatesConfig;
}

/** quick-start: FSD rule at warn, agent rules, the PR template, AI review off unless asked for
 * (it needs a provider key and a repository secret), `fast` once on. */
const QUICK_START_DEFAULTS: PresetDefaults = {
  reviewEnabledDefault: false,
  reviewMode: 'fast',
  fsdEnforcement: 'warn',
  agentRulesTeamRules: false,
  githubTemplates: { issue: false, pr: true, codeowners: false },
};

/**
 * The preset table. `solo` is an alias of `quick-start`: the two differed only in turning
 * review on by default, and they are one preset now. `solo` stays a valid value so
 * workspaces that recorded it keep resolving, with quick-start's defaults.
 */
const PRESET_DEFAULTS: Record<ToolkitPreset, PresetDefaults> = {
  'quick-start': QUICK_START_DEFAULTS,
  solo: QUICK_START_DEFAULTS,
  team: {
    // Requiring review only for P2 findings when CODEOWNERS is wired up is out of v0.1
    // scope and has no field here. The other two Team-only behaviors are the two
    // preset-specific fields below.
    // add-review: `standard` mode by default, `thorough` available — standard is the
    // default mode; `thorough` stays a user override this function does not apply automatically.
    reviewEnabledDefault: true,
    reviewMode: 'standard',
    // add-fsd-lite: enabled + stricter module boundaries — the canonical FSD rule
    // reports as an error here, as a warning in quick-start.
    fsdEnforcement: 'error',
    // add-agent-rules: enabled + an extra team-rules section — the extra section is
    // content `template-engine/agent-rules` composes, not a different `files` list.
    agentRulesTeamRules: true,
    // add-github-templates: full (Issue+PR, CODEOWNERS opt-in).
    githubTemplates: { issue: true, pr: true, codeowners: false },
  },
};

/**
 * `verdictPolicy` conclusion: there is nothing to define here. Every preset keeps the
 * default verdict behavior; for Team, requiring review for P2 findings when CODEOWNERS is
 * wired up is only a possible future strengthening, not something defined now. The
 * BLOCK/CHANGES_RECOMMENDED/APPROVE_WITH_NOTES/APPROVE mapping is a fixed algorithm, not
 * a config value, and no field for it exists anywhere in `ReviewPolicyConfig` or
 * `ToolkitConfig`. So all three presets produce the exact same verdict behavior, and this
 * function intentionally does not introduce a `verdictPolicy` type or field.
 */
export function buildPresetConfig(input: PresetConfigInput): ToolkitConfig {
  const defaults = PRESET_DEFAULTS[input.preset];
  const reviewEnabled = input.reviewEnabled ?? defaults.reviewEnabledDefault;
  const aiHosts = input.aiHosts !== undefined && input.aiHosts.length > 0 ? [...input.aiHosts] : [...DEFAULT_AI_HOSTS];

  return {
    preset: input.preset,
    packageManager: input.packageManager,
    frontend: input.frontend,
    backend: input.backend,
    locale: input.locale,
    aiHosts,
    fsd: buildFsdConfig(defaults.fsdEnforcement, input.frontend),
    review: reviewEnabled
      ? buildReviewConfigSnippet({
          enabled: true,
          provider: input.reviewProvider ?? reviewProviderFor(aiHosts),
          mode: defaults.reviewMode,
          locale: input.locale,
          maxRounds: DEFAULT_MAX_ROUNDS, // preset mapping never overrides maxRounds.
          packageManager: input.packageManager, // snippet ignores it; the type rides ReviewWorkflowInput
        })
      : { enabled: false },
    agentRules: { teamRules: defaults.agentRulesTeamRules },
    githubTemplates: defaults.githubTemplates,
    // conflictPolicy.default is 'merge-proposal' — presets have no conflictPolicy
    // setting, so every preset keeps this one default.
    conflictPolicy: { default: DEFAULT_CONFLICT_POLICY },
    // No preset ever auto-fills integrations — always user-driven via
    // `add-integration`.
    integrations: { enabled: [] },
  };
}
