// The step log of an e2e script: the steps that passed, in order, and how long each took
// (from the end of the step before it, so checks between commands are counted too). The
// timings print with the result, and in CI they also land in the job summary, so a slow leg
// shows which step it spends its time in.

import { appendFileSync } from 'node:fs';

export function createStepLog() {
  const names = [];
  const durations = [];
  // step name → [label, ms][]: the parts a step's own command reported (the CLI's plan steps)
  const details = new Map();
  let last = Date.now();
  const startedAt = last;
  return {
    names,
    record(step) {
      const now = Date.now();
      names.push(step);
      durations.push(now - last);
      last = now;
    },
    /** Parts of a recorded step, timed by the command it ran: printed indented under it. */
    detail(step, rows) {
      details.set(step, rows);
    },
    /** The last two recorded steps were one: keep the earlier name, add the times. */
    mergeLast() {
      names.pop();
      const duration = durations.pop() ?? 0;
      if (durations.length > 0) durations[durations.length - 1] += duration;
    },
    /** One line per step with its seconds, and the total. */
    timings() {
      const rows = names.flatMap((name, index) => [
        `  ${(durations[index] / 1000).toFixed(1).padStart(7)}s  ${name}`,
        ...(details.get(name) ?? []).map(([label, ms]) => `  ${(ms / 1000).toFixed(1).padStart(9)}s    ${label}`),
      ]);
      return [...rows, `  ${((Date.now() - startedAt) / 1000).toFixed(1).padStart(7)}s  total`].join('\n');
    },
    /** Appends the timings to the GitHub Actions job summary, when there is one. */
    summarize(title) {
      const summary = process.env.GITHUB_STEP_SUMMARY;
      if (!summary) return;
      const rows = names.flatMap((name, index) => [
        `| ${name} | ${(durations[index] / 1000).toFixed(1)} |`,
        ...(details.get(name) ?? []).map(([label, ms]) => `| &nbsp;&nbsp;↳ ${label} | ${(ms / 1000).toFixed(1)} |`),
      ]);
      const total = `| **total** | **${((Date.now() - startedAt) / 1000).toFixed(1)}** |`;
      try {
        appendFileSync(summary, [`### ${title}`, '', '| step | seconds |', '| --- | ---: |', ...rows, total, ''].join('\n') + '\n');
      } catch {
        // a summary that can't be written never fails the run
      }
    },
  };
}
