// `pnpm bench`. Builds the bench bundle, serves it, and measures every declared metric against
// bench/budgets.json.
//
// Run with: node bench/run.ts [--trace] [--port 4320] [--phase 1]
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { GENERATOR_VERSION } from '@apace/seed';
import { type Budgets, metricsForPhase, readBudgets, withinBudget } from './budgets.ts';
import { calibrate } from './calibration.ts';
import { ensureSeeded, launchBench, PROFILE_ROOT } from './chromium.ts';
import {
  appendSummary,
  describeMachine,
  formatRun,
  type MetricResult,
  type RunResult,
  summaryOfRun,
} from './report.ts';
import { countedValue, SCENARIOS } from './scenarios.ts';
import { readHostRules, serveStatic } from './serve.ts';
import { percentile } from './stats.ts';

const exec = promisify(execFile);
const REPO = fileURLToPath(new URL('../', import.meta.url));
export const RESULTS_DIR = fileURLToPath(new URL('./results/', import.meta.url));
export const TRACES_DIR = fileURLToPath(new URL('./traces/', import.meta.url));
export const DEFAULT_PORT = 4320;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: REPO });
  return stdout.trim();
}

export interface BenchOptions {
  /** The directory holding a built bench bundle. */
  readonly dist: string;
  readonly port: number;
  readonly budgets: Budgets;
  /** Which phase's metrics have to exist. Metrics of later phases are measured if they can be. */
  readonly phase: number;
  /** Names this run in the report, such as `base` or `branch`. */
  readonly label: string;
  readonly profile: string;
  readonly trace?: string | undefined;
}

/** Measures one build. The caller builds it and decides where its profile lives. */
export async function measure(options: BenchOptions): Promise<RunResult> {
  const { budgets } = options;
  // Timed before the browser starts, so nothing else on this machine is running.
  const calibrationMs = calibrate();
  const url = `http://127.0.0.1:${options.port}/`;
  const server = await serveStatic(options.dist, options.port, await readHostRules());
  const bench = await launchBench({
    url,
    budgets,
    profile: options.profile,
    tracePath: options.trace,
  });

  const metrics: MetricResult[] = [];
  const missing: { metric: string; reason: string }[] = [];
  try {
    await bench.reload();
    const features = await bench.features();
    const seeded = await ensureSeeded(bench, options.profile, {
      seed: budgets.seed,
      generatorVersion: GENERATOR_VERSION,
    });
    // Seeding replaces the workspace under a page that already opened it.
    if (seeded) await bench.reload();

    for (const [metric, budget] of Object.entries(budgets.metrics)) {
      const scenario = SCENARIOS[metric];
      if (!features.includes(budget.feature)) {
        if (budget.phase <= options.phase) {
          missing.push({ metric, reason: `the app declares no ${budget.feature} yet` });
        }
        continue;
      }
      if (scenario === undefined) {
        if (budget.phase <= options.phase) {
          missing.push({ metric, reason: 'no scenario measures it yet' });
        }
        continue;
      }
      const take = budget.samples + budget.warmup;
      const taken = await scenario({ bench, budget, take });
      const counted = taken.slice(budget.warmup).map((sample) => countedValue(sample, budget));
      if (counted.length < budget.samples) {
        throw new Error(
          `${metric} returned ${counted.length} samples, short of the ${budget.samples} it needs`,
        );
      }
      const p50 = percentile(counted, 50);
      const p95 = percentile(counted, 95);
      const value = budget.statistic === 'p95' ? p95 : p50;
      metrics.push({
        metric,
        phase: budget.phase,
        feature: budget.feature,
        statistic: budget.statistic,
        limitMs: Number(
          (budget.limit.ms ?? (budget.limit.refreshPeriods ?? 0) * budgets.refreshPeriodMs).toFixed(
            3,
          ),
        ),
        p50,
        p95,
        value,
        samples: counted.length,
        warmupDropped: budget.warmup,
        withinBudget: withinBudget(value, budget, budgets.refreshPeriodMs),
      });
    }

    const [sha, branch, status] = await Promise.all([
      git('rev-parse', 'HEAD'),
      git('rev-parse', '--abbrev-ref', 'HEAD'),
      git('status', '--porcelain'),
    ]);
    return {
      startedAt: new Date().toISOString(),
      sha,
      branch,
      dirty: status !== '',
      label: options.label,
      cpu: cpus()[0]?.model ?? 'unknown CPU',
      cores: cpus().length,
      cpuThrottle: budgets.ci.cpuThrottle,
      calibrationMs,
      seed: budgets.seed,
      generatorVersion: GENERATOR_VERSION,
      seeded,
      features,
      metrics,
      missing,
    };
  } finally {
    await bench.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

/** Builds the bench bundle from the repo at `cwd`. */
export async function buildBench(cwd: string): Promise<string> {
  await exec('pnpm', ['run', 'build:bench'], { cwd, env: { ...process.env, CI: '1' } });
  return join(cwd, 'apps/web/dist-bench');
}

export async function saveRun(run: RunResult, prefix = ''): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const path = join(RESULTS_DIR, `${prefix}${run.sha}${run.dirty ? '-dirty' : ''}.json`);
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`);
  return path;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      trace: { type: 'boolean', default: false },
      port: { type: 'string' },
      phase: { type: 'string' },
    },
  });
  const budgets = await readBudgets();
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
  const phase = Number(values.phase ?? /^phase-(\d+)$/.exec(branch)?.[1] ?? 1);
  const port = Number(values.port ?? DEFAULT_PORT);

  const run = await measure({
    dist: await buildBench(REPO),
    port,
    budgets,
    phase,
    label: 'branch',
    profile: join(PROFILE_ROOT, String(port)),
    trace: values.trace === true ? join(TRACES_DIR, `${Date.now()}.json`) : undefined,
  });
  const path = await saveRun(run);

  console.log(describeMachine(run));
  console.log(`features: ${run.features.join(', ') || 'none'}\n`);
  console.log(formatRun(run, budgets));
  console.log(`\nSaved to ${path}`);
  await appendSummary(summaryOfRun(run, budgets));

  const over = run.metrics.filter((metric) => !metric.withinBudget);
  const owed = metricsForPhase(budgets, phase).filter((metric) =>
    run.missing.some((gap) => gap.metric === metric),
  );
  if (over.length > 0) {
    console.error(`\nOver budget: ${over.map((metric) => metric.metric).join(', ')}`);
    process.exitCode = 1;
  }
  if (owed.length > 0) console.log(`\nPhase ${phase} still owes: ${owed.join(', ')}`);
}
