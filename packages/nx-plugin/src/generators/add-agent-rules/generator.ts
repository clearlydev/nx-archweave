import type { Tree } from '@nx/devkit';
import { applyAgentRulesBlock, composeAgentRules, readBoundaryTags, rulesFilesFor, validateAgentRules, type FsdPolicyNotes, type ModuleBoundaryTags } from '@nx-archweave/template-engine';
import type { AddAgentRulesGeneratorSchema } from './schema.d.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import { readToolkitConfig, recordAiHosts, resolveAiHostsOption, resolveLocaleOption } from '../shared/toolkit-config-file.ts';
import { renderAddAgentRulesReport, type AddAgentRulesReport, type AgentRuleFileResult } from './render.ts';
import { renderLineDiff } from '../add-review/render.ts';
import { resolveFsdPolicy } from '../../eslint/fsd-policy.ts';

/** Option > toolkit.config.json `agentRules.teamRules` > false.
 * The schema deliberately carries no default so an omitted flag still reaches the config
 * fallback (undefined and false must stay distinguishable). */
function resolveTeamRules(option: boolean | undefined, config: Record<string, unknown> | null): boolean {
  if (option !== undefined) return option;
  const agentRules = config?.['agentRules'];
  const teamRules =
    typeof agentRules === 'object' && agentRules !== null ? (agentRules as Record<string, unknown>)['teamRules'] : undefined;
  return typeof teamRules === 'boolean' ? teamRules : false;
}

/** The Frontend Structure section rides on the workspace having FSD —
 * `fsd.enabled` when recorded, else a recorded frontend other than `none`; nothing recorded
 * means no section (a plain add-agent-rules run on an unknown workspace stays as before). */
function resolveFsdStructure(config: Record<string, unknown> | null): boolean {
  const fsd = config?.['fsd'];
  const enabled = typeof fsd === 'object' && fsd !== null ? (fsd as Record<string, unknown>)['enabled'] : undefined;
  if (typeof enabled === 'boolean') return enabled;
  const frontend = config?.['frontend'];
  return typeof frontend === 'string' && frontend !== 'none';
}

/** The Module Boundaries section rides on the workspace having a backend (add-backend
 * records it), with the role tags toolkit.config.json names; no backend means no section. */
function resolveModuleBoundaries(config: Record<string, unknown> | null): ModuleBoundaryTags | undefined {
  const backend = config?.['backend'];
  return backend === 'express' || backend === 'nest' ? readBoundaryTags(config) : undefined;
}

const POLICY_KEYS = ['preset', 'sliceGroups', 'sharedPublicApi', 'testFiles'];

/** The FSD options toolkit.config.json records, for the Frontend Structure section; undefined
 * when it records none (the section then keeps its canonical text). */
function resolveFsdPolicyNotes(config: Record<string, unknown> | null): FsdPolicyNotes | undefined {
  const fsd = config?.['fsd'];
  if (typeof fsd !== 'object' || fsd === null || !POLICY_KEYS.some((key) => key in fsd)) return undefined;
  const policy = resolveFsdPolicy(fsd);
  return { sliceGroups: policy.sliceGroups !== false, sharedPublicApi: policy.sharedPublicApi, testFiles: policy.testFiles !== false };
}

export interface RunAddAgentRulesOptions {
  /** Record explicitly passed --hosts in toolkit.config.json (default true). init passes
   * false: it records aiHosts itself, together with its other preset choices. */
  recordHosts?: boolean;
  /** Include the Frontend Structure (FSD) section. init passes what it knows; a standalone
   * run reads toolkit.config.json (see resolveFsdStructure). */
  fsdStructure?: boolean;
  /** The Module Boundaries section's role tags, or null for none. init passes what this run
   * sets up (it writes the backend after the agent rules); a standalone run reads
   * toolkit.config.json (see resolveModuleBoundaries). */
  moduleBoundaries?: ModuleBoundaryTags | null;
}

export function runAddAgentRules(
  tree: Tree,
  options: AddAgentRulesGeneratorSchema,
  { recordHosts = true, fsdStructure, moduleBoundaries }: RunAddAgentRulesOptions = {},
): AddAgentRulesReport {
  // Nothing resolved from toolkit.config.json ever blocks a write — an unusable file is
  // treated as absent.
  const config = readToolkitConfig(tree);
  const hosts = resolveAiHostsOption(options.hosts, config);
  const files = rulesFilesFor(hosts);
  const locale = resolveLocaleOption(options.locale, config);
  const teamRules = resolveTeamRules(options.teamRules, config);
  const dryRun = options.dryRun ?? false;

  const boundaries = moduleBoundaries === undefined ? resolveModuleBoundaries(config) : (moduleBoundaries ?? undefined);
  const composed = composeAgentRules({
    files,
    locale,
    teamRules,
    fsdStructure: fsdStructure ?? resolveFsdStructure(config),
    fsdPolicy: resolveFsdPolicyNotes(config),
    ...(boundaries !== undefined ? { moduleBoundaries: boundaries } : {}),
  });

  const results: AgentRuleFileResult[] = composed.map(({ filePath, content }) => {
    if (!validateAgentRules(content, teamRules ? ['team-rules'] : [])) {
      // Defensive: unreachable with the default composition, but this is the "lint"
      // check every rules file must pass, so a future section-selection option can't silently
      // ship a document missing its required sections (Team Rules joins the required
      // set when it was asked for).
      throw new Error(
        `Generated ${filePath} is missing a required section (Safety Rules, Language Policy${teamRules ? ', Team Rules' : ''})`,
      );
    }

    const existing = tree.read(filePath, 'utf-8');
    const outcome = applyAgentRulesBlock(existing, content, { overwrite: options.overwriteBlock === true });

    switch (outcome.kind) {
      case 'unchanged':
        return { filePath, action: 'unchanged', reason: null, content: null };
      case 'unrecognized':
        return { filePath, action: 'unrecognized', reason: outcome.reason, content: null };
      case 'user-modified':
        return {
          filePath,
          action: 'user-modified',
          reason: null,
          content: null,
          diff: renderLineDiff(outcome.existingBody, outcome.generatedBody),
        };
      case 'create':
      case 'append':
      case 'replace': {
        if (!dryRun) tree.write(filePath, outcome.text);
        const action = outcome.kind === 'create' ? 'created' : outcome.kind === 'append' ? 'appended' : 'updated';
        return { filePath, action, reason: null, content: dryRun ? outcome.text : null };
      }
    }
  });

  // An explicit --hosts is the user changing the workspace's hosts: record it, so a bare rerun
  // (and doctor) see the new choice — but only once every file carries the block.
  const explicit = options.hosts !== undefined && options.hosts.length > 0;
  const allApplied = results.every((file) => file.action !== 'unrecognized');
  const hostsRecord = explicit && recordHosts ? (allApplied ? recordAiHosts(tree, hosts, !dryRun) : 'not-applied') : 'not-requested';

  return { dryRun, locale, hosts, teamRules, files: results, hostsRecord };
}

export async function addAgentRulesGenerator(tree: Tree, options: AddAgentRulesGeneratorSchema): Promise<void> {
  console.log(renderAddAgentRulesReport(runAddAgentRules(tree, { ...options, dryRun: resolveDryRun(options) })));
}

export default addAgentRulesGenerator;
