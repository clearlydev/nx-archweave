#!/usr/bin/env node
import { execFile, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseCliArgs } from './cli/parse-args.ts';
import { checkInvocationDirectory, renderLocationRefusal } from './cli/location-check.ts';
import { collectMissingInputs, reviewProviderConflict } from './cli/prompts.ts';
import { buildPlan, nxGenerateCommand } from './cli/plan.ts';
import { detectInstalledHosts } from './cli/host-probe.ts';
import { choosePlugins, resolvePluginFlag } from './cli/plugins.ts';
import { spawnableCommand } from './cli/spawnable-command.ts';
import { createProcessExec, executePlan, renderExecuteReport } from './cli/execute.ts';
import { choosePackageManager, describeResolution, type CliPackageManager } from './cli/package-manager.ts';
import { renderUsage, renderVersion } from './render-usage.ts';

class NonInteractiveInputError extends Error {}

/** Thin entry point: parseArgs → (if needed) prompt → buildPlan →
 * executePlan. All the actual logic lives in the pure/injectable modules under
 * `cli/`, which is where this behavior is tested — the real child-process run is
 * covered by tools/e2e-create.mjs, so this file itself has no dedicated spec. */
async function main(argv: readonly string[]): Promise<number> {
  const outcome = parseCliArgs(argv);

  if (outcome.kind === 'help') {
    console.log(renderUsage());
    return 0;
  }
  if (outcome.kind === 'version') {
    console.log(renderVersion());
    return 0;
  }
  if (outcome.kind === 'error') {
    console.error(outcome.message);
    console.error('');
    console.error(renderUsage());
    return 1;
  }

  const { args } = outcome;
  if (args.name === undefined) {
    console.error('Missing required argument: <name>.');
    console.error('');
    console.error(renderUsage());
    return 1;
  }
  const name = args.name;

  if (!args.allowNested) {
    const location = checkInvocationDirectory(process.cwd(), { gitRoot, hasPackageJson: (dir) => existsSync(join(dir, 'package.json')) });
    if (!location.ok) {
      console.error(renderLocationRefusal(location));
      return 1;
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string): Promise<string> => {
    // A question pending when non-interactive stdin hits EOF never settles
    // (readline/promises closes on 'end'), which would make the process
    // drain the event loop and exit 0 as if it had succeeded — so refuse to
    // ask at all when stdin isn't a TTY.
    if (!process.stdin.isTTY) {
      return Promise.reject(
        new NonInteractiveInputError(
          `Missing required input (would have asked: ${question.trim()}) and stdin is not interactive — pass the missing flags explicitly.`,
        ),
      );
    }
    return rl.question(question);
  };
  // Both flags given: a plugin of a host not picked fails before any question is asked.
  if (args.plugins !== undefined && args.aiHosts !== undefined) {
    const early = resolvePluginFlag(args.plugins, args.aiHosts);
    if ('error' in early) {
      console.error(early.error);
      return 1;
    }
  }
  // --review-provider with review already known to be off fails before any question too.
  const earlyConflict = reviewProviderConflict(args.preset, args.review, args.reviewProvider);
  if (earlyConflict !== undefined) {
    console.error(earlyConflict);
    return 1;
  }
  const interactive = process.stdin.isTTY === true;
  // Probed only for the questions: the host list shows what is installed, and plugins are
  // offered only for a host whose CLI is here. A run with nothing to ask probes nothing.
  const installedHosts =
    interactive && (args.aiHosts === undefined || args.plugins === undefined) ? await detectInstalledHosts(readHostVersion) : undefined;
  let inputs;
  let pm;
  let plugins;
  try {
    inputs = await collectMissingInputs(
      {
        preset: args.preset,
        frontend: args.frontend,
        backend: args.backend,
        locale: args.locale,
        aiHosts: args.aiHosts,
        installedHosts,
        review: args.review,
        ...(args.reviewProvider === undefined ? {} : { reviewProvider: args.reviewProvider }),
        interactive,
      },
      ask,
    );
    // The preset or the review answer may have turned review off after the questions.
    const conflict = reviewProviderConflict(inputs.preset, inputs.review, args.reviewProvider);
    if (conflict !== undefined) {
      console.error(conflict);
      return 1;
    }
    // Non-interactive runs take the launching manager instead of asking (CI and agents use
    // this path).
    pm = await choosePackageManager(
      {
        flag: args.packageManager,
        userAgent: process.env['npm_config_user_agent'],
        interactive,
        probe: readVersion,
      },
      ask,
      (line) => console.log(line),
    );
    // Last question: optional plugins for the picked hosts.
    if (!('error' in pm)) {
      plugins = await choosePlugins(
        {
          flag: args.plugins,
          aiHosts: inputs.aiHosts,
          installedHosts,
          interactive,
          nxG: nxGenerateCommand(pm.packageManager),
        },
        ask,
        (line) => console.log(line),
      );
    }
  } catch (error) {
    if (error instanceof NonInteractiveInputError) {
      console.error(error.message);
      console.error('');
      console.error(renderUsage());
      return 1;
    }
    throw error;
  } finally {
    rl.close();
  }
  if ('error' in pm) {
    console.error(pm.error);
    return 1;
  }
  if (plugins === undefined || 'error' in plugins) {
    console.error(plugins?.error ?? 'Could not resolve --plugins.');
    return 1;
  }

  const plan = buildPlan({
    name,
    preset: inputs.preset,
    frontend: inputs.frontend,
    backend: inputs.backend,
    locale: inputs.locale,
    aiHosts: inputs.aiHosts,
    plugins: plugins.plugins,
    review: inputs.review,
    ...(inputs.reviewProvider === undefined ? {} : { reviewProvider: inputs.reviewProvider }),
    pluginSource: args.pluginSource,
    packageManager: pm.packageManager,
  });

  console.log('');
  console.log(`Package manager: ${describeResolution(pm)}`);
  console.log(`create-nx-archweave will run ${plan.steps.length} steps:`);
  for (const step of plan.steps) {
    console.log(`  - ${step.description}`);
  }

  const report = executePlan(plan, createProcessExec(), process.cwd());
  console.log(renderExecuteReport(report, plan, name));

  return report.ok ? 0 : 1;
}

/** `<manager> --version`, or undefined when it cannot be run — lists the installed
 * managers for the question and reads the version the compatibility rule needs. A Windows
 * `*.cmd` shim runs through cmd.exe (spawnableCommand), like every step; an unknown version
 * is never held against a manager. */
function readVersion(manager: CliPackageManager): string | undefined {
  // Corepack may otherwise stop to ask before downloading the yarn it pins, or refuse
  // yarn inside a project that pins another manager (strict mode) — then yarn would be
  // silently missing from the list.
  const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', COREPACK_ENABLE_STRICT: '0' };
  const spawnable = spawnableCommand(manager, ['--version']);
  // Bounded: a corepack shim may stop to ask before downloading — never hang the question on it.
  const result = spawnSync(spawnable.command, spawnable.args, {
    encoding: 'utf-8',
    timeout: 5000,
    env,
    windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/** `<host CLI> --version`'s output, or undefined when it cannot be run — read for the AI
 * host question and to decide which hosts' plugins are offered. A Windows `*.cmd` shim (an
 * npm-installed claude, codex or gemini) runs through cmd.exe, like readVersion above. */
function readHostVersion(command: string): Promise<string | undefined> {
  const spawnable = spawnableCommand(command, ['--version']);
  return new Promise((resolve) => {
    execFile(
      spawnable.command,
      spawnable.args,
      { encoding: 'utf-8', timeout: 10_000, windowsVerbatimArguments: spawnable.windowsVerbatimArguments },
      (error, stdout) => {
        resolve(error ? undefined : stdout);
      },
    );
  });
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('create-nx-archweave crashed unexpectedly:');
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });

/** `git rev-parse --show-toplevel` from `dir`; null outside a repository or without git. */
function gitRoot(dir: string): string | null {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf-8' });
  return result.status === 0 && result.stdout.trim() !== '' ? result.stdout.trim() : null;
}
