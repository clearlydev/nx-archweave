import type {
  FsdEnforcement,
  NextFsdLayer,
  ReactViteFsdLayer,
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

export interface PresetConfigInput {
  preset: ToolkitPreset;
  frontend: ToolkitFrontendChoice;
  // backend is an axis, not preset policy — passed through unmapped.
  backend: ToolkitBackend;
  locale: ToolkitLocale;
  packageManager: ToolkitPackageManager;
  /** Quick Start offers review as opt-in; Solo/Team default to enabled. Explicit value
   * always wins over the preset's default. */
  reviewEnabled?: boolean;
  /** The AI hosts picked; omitted → the default host. They
   * decide the agent-rules files and the review provider default — the preset no longer
   * picks files. */
  aiHosts?: ToolkitAiHost[];
  /** An explicit review provider; omitted → the first AI host's (reviewProviderFor). */
  reviewProvider?: ReviewProviderId;
}

/**
 * Layer composition is frontend-specific, not preset-specific —
 * `ToolkitFsdConfig.layerMapping` carries one react-vite list and one next list, and
 * every preset uses the SAME mapping for a given frontend. React Vite gets the full
 * 5-layer FSD stack (app/pages/features/entities/shared); Next.js omits 'app' because
 * the framework's own app/ (or src/app/) directory is already the entry point — this is
 * the only structural difference between the two. Team's stricter module boundaries
 * come from a stricter `depConstraints` SNIPPET from `add-fsd-lite`, not a
 * different layer list — it rides on `ToolkitFsdConfig.enforcement`,
 * which is the one preset-specific field in here.
 */
const REACT_VITE_LAYERS: ReactViteFsdLayer[] = ['app', 'pages', 'features', 'entities', 'shared'];
const NEXT_LAYERS: NextFsdLayer[] = ['pages', 'features', 'entities', 'shared'];

function buildFsdConfig(enforcement: FsdEnforcement, frontend: ToolkitFrontendChoice) {
  return {
    // All three presets enable FSD — it is on whenever there is a
    // frontend; a backend-only workspace has none to structure.
    enabled: frontend !== 'none',
    enforcement,
    layerMapping: {
      'react-vite': REACT_VITE_LAYERS,
      next: NEXT_LAYERS,
    },
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

/**
 * The preset table, field by field. Two defaults needed an explicit choice because the
 * presets are described at generator-option granularity while `ToolkitConfig` needs
 * concrete boolean/enum defaults:
 *
 * 1. Quick Start review enablement: Quick Start asks a single yes/no install question
 *    rather than turning review on by default — unlike Solo/Team, which only pick a mode
 *    and are enabled unless told otherwise. That question is an opt-in UX, so the preset
 *    DEFAULT (absent an explicit answer) is OFF; `fast` is the MODE once enabled, not the
 *    enablement itself. Solo/Team ask no such question, so they default ON.
 * 2. `add-github-templates` defaults: Quick Start gets the minimal set (PR template only)
 *    and Team the full set (Issue+PR), with CODEOWNERS opt-in only (default off). Solo's
 *    intent — provide rules without over-enforcing — reads closest to Quick Start's
 *    minimal floor, so Solo defaults to the same PR-only set as Quick Start, with
 *    issue/codeowners left for the user to opt into via `add-github-templates` directly
 *    (that generator's own options are unaffected by this choice).
 *
 * Everything else below is direct, with no interpretation needed.
 */
const PRESET_DEFAULTS: Record<ToolkitPreset, PresetDefaults> = {
  'quick-start': {
    // add-review: opt-in (a single install question), `fast` mode by default.
    reviewEnabledDefault: false,
    reviewMode: 'fast',
    // add-fsd-lite: enabled with every default layer, no questions — violations warn.
    fsdEnforcement: 'warn',
    // add-agent-rules: enabled (simple version). Which files follow from the AI hosts
    // picked, no longer from the preset.
    agentRulesTeamRules: false,
    // add-github-templates: minimal (PR template only).
    githubTemplates: { issue: false, pr: true, codeowners: false },
  },
  solo: {
    // add-review: `fast` mode by default — no opt-in question, so enabled by default.
    reviewEnabledDefault: true,
    reviewMode: 'fast',
    // add-fsd-lite: enabled — violations warn (no over-enforcement).
    fsdEnforcement: 'warn',
    // add-agent-rules: enabled — files follow the AI hosts picked.
    agentRulesTeamRules: false,
    // add-github-templates: optional — see note #2 above.
    githubTemplates: { issue: false, pr: true, codeowners: false },
  },
  team: {
    // Requiring review only for P2 findings when CODEOWNERS is wired up is out of v0.1
    // scope and has no field here. The other two Team-only behaviors are the two
    // preset-specific fields below.
    // add-review: `standard` mode by default, `thorough` available — standard is the
    // default mode; `thorough` stays a user override this function does not apply automatically.
    reviewEnabledDefault: true,
    reviewMode: 'standard',
    // add-fsd-lite: enabled + stricter module boundaries — the canonical FSD rule
    // reports as an error here, as a warning in the other presets.
    fsdEnforcement: 'error',
    // add-agent-rules: enabled + an extra team-rules section — the extra section is
    // content `template-engine/agent-rules` composes, not a different `files` list.
    agentRulesTeamRules: true,
    // add-github-templates: full (Issue+PR, CODEOWNERS optional) — see note #2 above.
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
