import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_HOST_CHOICES, PLUGIN_CHOICES } from './cli/types.ts';

// Keep in sync with packages/nx-plugin/generators.json (same order).
const AVAILABLE_GENERATORS = [
  'doctor',
  'init',
  'add-integration',
  'add-review',
  'add-backend',
  'add-agent-rules',
  'add-github-templates',
  'add-fsd-lite',
  'page',
  'widget',
  'feature',
  'entity',
  'shared',
  'install-integration',
  'record-integration',
  'allow-builds',
];

/** This package's own version, read from its package.json — the nearest one up from this file
 * that is ours, which holds from source, from the tsc output and from the bundles alike. */
function ownVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf-8')) as { name?: string; version?: string };
      if (pkg.name === 'create-nx-archweave' && pkg.version) return pkg.version;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('create-nx-archweave: its own package.json was not found');
    dir = parent;
  }
}

export const CLI_VERSION = ownVersion();

const PLUGIN_LIST = PLUGIN_CHOICES.map(
  (plugin) => `${plugin.id} (${AI_HOST_CHOICES.find((host) => host.id === plugin.host)?.label ?? plugin.host})`,
).join(', ');

export function renderUsage(): string {
  return [
    'Usage: create-nx-archweave <name> [options]',
    '',
    'Options:',
    '  --preset <quick-start|solo|team>   Preset that configures the generated workspace',
    '  --frontend <react-vite|next|none> Target frontend (none: a backend-only workspace — needs --backend)',
    '  --backend <express|nest|none>      Backend app, wired with shared-types and enforced boundaries (asked if omitted)',
    '  --locale <ko|en>                   Generated content language (asked if omitted; quick-start: en)',
    '  --ai-hosts <list>                  AI coding tools, comma-separated: claude-code, codex, cursor, gemini-cli',
    '                                     (asked if omitted, showing which are installed; without a terminal: claude-code)',
    '  --plugins <list|none>              Optional plugins for the picked AI hosts, comma-separated: ' + PLUGIN_LIST,
    '                                     (asked if omitted, for hosts installed here; without a terminal: none)',
    '  --review, --no-review              Force AI PR review on/off (quick-start asks y/N; solo/team: on)',
    '  --review-provider <name>           claude, gemini, gpt or cursor (asked when review is on; default: the first AI tool\'s)',
    '  --plugin-source <spec>             Override the nx-archweave plugin package/version to install',
    '  --allow-nested                     Create the workspace even inside a git repository or package.json project',
    '  --package-manager <name>           npm, pnpm, yarn or bun (asked if omitted; without a terminal: the one that ran this command, else npm)',
    '  -h, --help                         Show this help',
    '  -v, --version                      Show the CLI version',
    '',
    'Any required option left unset above is asked interactively.',
    '',
    'Available generators (once installed):',
    `  ${AVAILABLE_GENERATORS.join(', ')}`,
  ].join('\n');
}

export function renderVersion(): string {
  return CLI_VERSION;
}
