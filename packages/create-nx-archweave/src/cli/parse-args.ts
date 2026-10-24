import { parseArgs as parseNodeArgs } from 'node:util';
import {
  AI_HOST_VALUES,
  BACKEND_VALUES,
  FRONTEND_VALUES,
  LOCALE_VALUES,
  PLUGIN_VALUES,
  PRESET_VALUES,
  REVIEW_PROVIDER_VALUES,
  type CliAiHost,
  type CliBackend,
  type CliFrontend,
  type CliLocale,
  type CliPreset,
  type CliReviewProvider,
} from './types.ts';
import { isCliPackageManager, type CliPackageManager } from './package-manager.ts';
import { invalidWorkspaceNameMessage, workspaceNameProblem } from './workspace-name.ts';

export interface ParsedArgs {
  name: string | undefined;
  preset: CliPreset | undefined;
  frontend: CliFrontend | undefined;
  backend: CliBackend | undefined;
  locale: CliLocale | undefined;
  /** `--ai-hosts=a,b` (deduped, in the order given); undefined means "not passed". */
  aiHosts: CliAiHost[] | undefined;
  /** `--plugins=a,b` (deduped, in the order given; `none` → []); undefined means "not
   * passed". Whether each one's host was picked is checked once the hosts are known. */
  plugins: string[] | undefined;
  /** `--review-provider`; undefined means "not passed" (asked when review is on, else init's
   * own default — the first AI host's provider). */
  reviewProvider: CliReviewProvider | undefined;
  /** Explicit --review/--no-review override; undefined means "not passed" (prompts.ts
   * or the init generator's own preset default decides). */
  review: boolean | undefined;
  pluginSource: string | undefined;
  /** `--package-manager`, when passed: npm, pnpm, yarn or bun. Undefined means "not
   * passed" — package-manager.ts then asks or reads the launching manager. Any other
   * value is refused before this field is ever set. */
  packageManager: CliPackageManager | undefined;
  /** `--allow-nested`: create the workspace even inside a git repository or a package.json
   * project (location-check.ts refuses that otherwise). */
  allowNested: boolean;
}

export type ParseArgsOutcome =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; args: ParsedArgs };

/** The string-valued flags declared below, in their separated two-token form
 * (`--preset solo`). extractReviewFlag must never treat the token AFTER one of
 * these as a review flag — it is that flag's value, so both tokens pass through
 * to parseArgs untouched. parseArgs then consumes it as the value, or, for a
 * dash-leading value like `--plugin-source --review`, rejects it with its own
 * clear "argument is ambiguous / use --plugin-source=-XYZ" error — either way
 * it is never silently reinterpreted as the review flag. */
const STRING_VALUE_FLAGS = new Set(['--preset', '--frontend', '--backend', '--locale', '--ai-hosts', '--plugins', '--review-provider', '--plugin-source', '--package-manager']);

/** node:util's parseArgs has no built-in `--no-foo` negation (verified locally: it
 * throws "Unknown option '--no-review'" when `review` is declared as a plain boolean
 * option), so --review/--no-review/--review=true|false are hand-rolled here and
 * stripped out before the rest of argv reaches parseArgs. */
function extractReviewFlag(argv: readonly string[]): {
  review: boolean | undefined;
  error: string | undefined;
  rest: string[];
} {
  const rest: string[] = [];
  let review: boolean | undefined;
  let error: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (STRING_VALUE_FLAGS.has(token)) {
      rest.push(token);
      if (i + 1 < argv.length) {
        rest.push(argv[i + 1]);
        i++;
      }
    } else if (token === '--review') {
      review = true;
    } else if (token === '--no-review') {
      review = false;
    } else if (token.startsWith('--review=')) {
      const value = token.slice('--review='.length);
      if (value === 'true') review = true;
      else if (value === 'false') review = false;
      else error ??= `Invalid --review value "${value}". Expected "true" or "false".`;
    } else {
      rest.push(token);
    }
  }

  return { review, error, rest };
}

function invalidChoiceMessage(flag: string, value: string, choices: readonly string[]): string {
  return `Invalid ${flag} value "${value}". Expected one of: ${choices.join(', ')}`;
}

/** Pure flag parsing: no I/O, no prompting — bin.ts decides what to do with each
 * outcome (print help/version, print an error and exit non-zero, or hand `args` to
 * prompts.ts for anything still missing). */
export function parseCliArgs(argv: readonly string[]): ParseArgsOutcome {
  const { review, error: reviewError, rest } = extractReviewFlag(argv);
  if (reviewError) return { kind: 'error', message: reviewError };

  const options = {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    preset: { type: 'string' },
    frontend: { type: 'string' },
    backend: { type: 'string' },
    locale: { type: 'string' },
    'ai-hosts': { type: 'string' },
    plugins: { type: 'string' },
    'review-provider': { type: 'string' },
    'plugin-source': { type: 'string' },
    'package-manager': { type: 'string' },
    'allow-nested': { type: 'boolean' },
  } as const;

  let parsed: ReturnType<typeof parseNodeArgs<{ args: string[]; options: typeof options; allowPositionals: true }>>;
  try {
    parsed = parseNodeArgs({ args: rest, allowPositionals: true, options });
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }

  if (parsed.values.help) return { kind: 'help' };
  if (parsed.values.version) return { kind: 'version' };

  if (parsed.positionals.length > 1) {
    return {
      kind: 'error',
      message: `Unexpected extra argument(s): ${parsed.positionals.slice(1).join(', ')}`,
    };
  }
  const name = parsed.positionals[0];
  const nameProblem = name === undefined ? undefined : workspaceNameProblem(name);
  if (name !== undefined && nameProblem !== undefined) {
    return { kind: 'error', message: invalidWorkspaceNameMessage(name, nameProblem) };
  }

  const preset = parsed.values.preset;
  if (preset !== undefined && !PRESET_VALUES.includes(preset as CliPreset)) {
    return { kind: 'error', message: invalidChoiceMessage('--preset', preset, PRESET_VALUES) };
  }

  const frontend = parsed.values.frontend;
  if (frontend !== undefined && !FRONTEND_VALUES.includes(frontend as CliFrontend)) {
    return { kind: 'error', message: invalidChoiceMessage('--frontend', frontend, FRONTEND_VALUES) };
  }

  const backend = parsed.values.backend;
  if (backend !== undefined && !BACKEND_VALUES.includes(backend as CliBackend)) {
    return { kind: 'error', message: invalidChoiceMessage('--backend', backend, BACKEND_VALUES) };
  }

  // A workspace needs something to build: no frontend means a backend-only workspace.
  if (frontend === 'none' && backend === 'none') {
    return { kind: 'error', message: '--frontend=none creates a backend-only workspace: pass --backend=express or --backend=nest.' };
  }

  const locale = parsed.values.locale;
  if (locale !== undefined && !LOCALE_VALUES.includes(locale as CliLocale)) {
    return { kind: 'error', message: invalidChoiceMessage('--locale', locale, LOCALE_VALUES) };
  }

  const aiHostsRaw = parsed.values['ai-hosts'];
  let aiHosts: CliAiHost[] | undefined;
  if (aiHostsRaw !== undefined) {
    const tokens = aiHostsRaw.split(',').map((token) => token.trim().toLowerCase()).filter((token) => token.length > 0);
    const unknown = tokens.find((token) => !(AI_HOST_VALUES as readonly string[]).includes(token));
    if (tokens.length === 0 || unknown !== undefined) {
      return { kind: 'error', message: invalidChoiceMessage('--ai-hosts', unknown ?? aiHostsRaw, AI_HOST_VALUES) + ' (comma-separated)' };
    }
    aiHosts = [...new Set(tokens as CliAiHost[])];
  }

  const pluginsRaw = parsed.values.plugins;
  let plugins: string[] | undefined;
  if (pluginsRaw !== undefined) {
    const tokens = pluginsRaw.split(',').map((token) => token.trim().toLowerCase()).filter((token) => token.length > 0);
    if (tokens.length === 1 && tokens[0] === 'none') {
      plugins = [];
    } else {
      const unknown = tokens.find((token) => !PLUGIN_VALUES.includes(token));
      if (tokens.length === 0 || unknown !== undefined) {
        return {
          kind: 'error',
          message: invalidChoiceMessage('--plugins', unknown ?? pluginsRaw, [...PLUGIN_VALUES, 'none']) + ' (comma-separated)',
        };
      }
      plugins = [...new Set(tokens)];
    }
  }

  const reviewProvider = parsed.values['review-provider'];
  if (reviewProvider !== undefined && !(REVIEW_PROVIDER_VALUES as readonly string[]).includes(reviewProvider)) {
    return { kind: 'error', message: invalidChoiceMessage('--review-provider', reviewProvider, REVIEW_PROVIDER_VALUES) };
  }

  const packageManager = parsed.values['package-manager'];
  if (packageManager !== undefined && !isCliPackageManager(packageManager)) {
    return {
      kind: 'error',
      message: `--package-manager "${packageManager}" is not supported — create-nx-archweave supports npm, pnpm, yarn and bun.`,
    };
  }

  return {
    kind: 'ok',
    args: {
      name,
      preset: preset as CliPreset | undefined,
      frontend: frontend as CliFrontend | undefined,
      backend: backend as CliBackend | undefined,
      locale: locale as CliLocale | undefined,
      aiHosts,
      plugins,
      reviewProvider: reviewProvider as CliReviewProvider | undefined,
      review,
      pluginSource: parsed.values['plugin-source'],
      packageManager,
      allowNested: parsed.values['allow-nested'] === true,
    },
  };
}
