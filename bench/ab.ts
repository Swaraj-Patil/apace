// `pnpm bench:ab`. Measures this branch against a base, on this machine, in one sitting.
//
// The base is built in a git worktree and served on its own port, so each build keeps its own
// OPFS data and neither has to be rebuilt between runs. The two are run interleaved, three
// times each, so a machine that gets slower partway through slows both of them.
//
// Run with: node bench/ab.ts [--base main] [--runs 3]
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { readBudgets } from './budgets.ts';
import { PROFILE_ROOT } from './chromium.ts';
import { type Comparison, compareAll } from './compare.ts';
import type { RunResult } from './report.ts';
import { appendSummary, describeChange, summaryOfComparisons } from './report.ts';
import { buildBench, DEFAULT_PORT, measure } from './run.ts';

const exec = promisify(execFile);
const REPO = fileURLToPath(new URL('../', import.meta.url));
export const RUNS = 3;

/** One number per metric, as that run measured it. */
export function valuesOf(run: RunResult): Record<string, number> {
  return Object.fromEntries(run.metrics.map((metric) => [metric.metric, metric.value]));
}

/** Every metric's runs, gathered from several runs of the same build. */
export function gather(runs: readonly RunResult[]): Record<string, number[]> {
  const gathered: Record<string, number[]> = {};
  for (const run of runs) {
    for (const [metric, value] of Object.entries(valuesOf(run))) {
      const sofar = gathered[metric] ?? [];
      sofar.push(value);
      gathered[metric] = sofar;
    }
  }
  return gathered;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: 'main' },
      runs: { type: 'string' },
      phase: { type: 'string' },
    },
  });
  const budgets = await readBudgets();
  const runs = Number(values.runs ?? RUNS);
  const base = values.base ?? 'main';
  const branchName = (
    await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO })
  ).stdout.trim();
  const phase = Number(values.phase ?? /^phase-(\d+)$/.exec(branchName)?.[1] ?? 1);

  let worktree: string | undefined;
  try {
    worktree = await mkdtemp(join(tmpdir(), 'apace-base-'));
    await rm(worktree, { recursive: true, force: true });
    await exec('git', ['worktree', 'add', '--detach', worktree, base], { cwd: REPO });

    console.log(`Building ${base} in a worktree…`);
    await exec('pnpm', ['install', '--frozen-lockfile'], { cwd: worktree });
    let baseDist: string | undefined;
    try {
      baseDist = await buildBench(worktree);
    } catch {
      baseDist = undefined;
    }

    const branchDist = await buildBench(REPO);
    const basePort = DEFAULT_PORT + 1;
    const branchPort = DEFAULT_PORT;

    const baseRuns: RunResult[] = [];
    const branchRuns: RunResult[] = [];
    for (let round = 0; round < runs; round++) {
      if (baseDist !== undefined) {
        baseRuns.push(
          await measure({
            dist: baseDist,
            port: basePort,
            budgets,
            phase,
            label: 'base',
            profile: join(PROFILE_ROOT, String(basePort)),
          }),
        );
      }
      branchRuns.push(
        await measure({
          dist: branchDist,
          port: branchPort,
          budgets,
          phase,
          label: 'branch',
          profile: join(PROFILE_ROOT, String(branchPort)),
        }),
      );
      console.log(`Round ${round + 1} of ${runs} done`);
    }

    const comparisons: Comparison[] = compareAll(gather(baseRuns), gather(branchRuns));
    const width = Math.max(6, ...comparisons.map((entry) => entry.metric.length));
    console.log(`\n${'metric'.padEnd(width)}  base      branch    change`);
    for (const change of comparisons) {
      const cell = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)} ms`);
      console.log(
        `${change.metric.padEnd(width)}  ${cell(change.base).padEnd(8)}  ${cell(change.head).padEnd(8)}  ${describeChange(change)}`,
      );
    }
    if (baseDist === undefined) {
      console.log(`\n${base} has no bench harness, so there is nothing to compare against.`);
    }
    await appendSummary(summaryOfComparisons(comparisons, base, baseDist !== undefined));

    const worse = comparisons.filter((change) => change.verdict === 'worse');
    if (worse.length > 0) {
      console.error(
        `\nWorse than ${base}: ${worse
          .map((change) => `${change.metric} ${describeChange(change)}`)
          .join(', ')}`,
      );
      process.exitCode = 1;
    }
  } finally {
    if (worktree !== undefined) {
      await exec('git', ['worktree', 'remove', '--force', worktree], { cwd: REPO }).catch(() => {});
    }
  }
}
