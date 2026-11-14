// The budget ratchet. Budgets may only get stricter: a loosened budget is a product decision,
// not something a branch slips in to get green. Everything a branch could relax to make a
// failing metric pass is checked here, against the base's copy of the file.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Budgets, limitMs, parseBudgets } from './budgets.ts';

const run = promisify(execFile);

/** Everything the branch loosened. An empty list means the ratchet holds. */
export function ratchetProblems(base: Budgets, head: Budgets): string[] {
  const problems: string[] = [];
  if (head.ci.cpuThrottle < base.ci.cpuThrottle) {
    problems.push(
      `the CI CPU throttle fell from ${base.ci.cpuThrottle}× to ${head.ci.cpuThrottle}×`,
    );
  }
  for (const [id, before] of Object.entries(base.metrics)) {
    const after = head.metrics[id];
    if (after === undefined) {
      problems.push(`${id} is gone`);
      continue;
    }
    const beforeMs = limitMs(before.limit, base.refreshPeriodMs);
    const afterMs = limitMs(after.limit, head.refreshPeriodMs);
    if (afterMs > beforeMs) problems.push(`${id} rose from ${beforeMs} ms to ${afterMs} ms`);
    if (before.limit.inclusive !== true && after.limit.inclusive === true) {
      problems.push(`${id} now passes at its limit rather than below it`);
    }
    if (after.samples < before.samples) {
      problems.push(`${id} takes ${after.samples} samples, down from ${before.samples}`);
    }
    if (after.warmup > before.warmup) {
      problems.push(`${id} drops ${after.warmup} warm-up samples, up from ${before.warmup}`);
    }
    if (after.phase > before.phase) {
      problems.push(`${id} moved from phase ${before.phase} to phase ${after.phase}`);
    }
    if (after.excludeIdle === true && before.excludeIdle !== true) {
      problems.push(`${id} stopped counting the wait for the next refresh`);
    }
    if ((after.perViewMs ?? 0) < (before.perViewMs ?? 0)) {
      problems.push(`${id} scrolls each view for less time than before`);
    }
  }
  return problems;
}

/** The budgets file as of `ref`, or null when that ref has none. */
export async function budgetsAt(ref: string, path = 'bench/budgets.json'): Promise<Budgets | null> {
  try {
    const { stdout } = await run('git', ['show', `${ref}:${path}`], { maxBuffer: 1024 * 1024 });
    return parseBudgets(stdout);
  } catch {
    return null;
  }
}
