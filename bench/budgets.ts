// Reads bench/budgets.json and resolves every budget to a number of milliseconds.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const BUDGETS_FILE = fileURLToPath(new URL('./budgets.json', import.meta.url));

export interface Limit {
  /** A fixed budget in milliseconds. */
  readonly ms?: number;
  /** A budget of whole refresh periods, for anything measured per frame. */
  readonly refreshPeriods?: number;
  /** True when the budget is met at the limit rather than below it. */
  readonly inclusive?: boolean;
}

export interface MetricBudget {
  readonly phase: number;
  /** The metric is measured only when the app declares this feature. */
  readonly feature: string;
  readonly statistic: 'p95' | 'p50';
  readonly limit: Limit;
  /** How many samples are counted. */
  readonly samples: number;
  /** How many samples are taken first and dropped. */
  readonly warmup: number;
  /** Scrolling only: how long each view is scrolled. */
  readonly perViewMs?: number;
  /** True when the budget counts work only, leaving out the wait for the next refresh. */
  readonly excludeIdle?: boolean;
  readonly span: string;
}

export interface Budgets {
  readonly refreshPeriodMs: number;
  readonly ci: { readonly cpuThrottle: number; readonly runner: string };
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly deviceScaleFactor: number;
  };
  readonly seed: number;
  readonly metrics: Readonly<Record<string, MetricBudget>>;
}

/** The budget in milliseconds, and whether the limit itself passes. */
export function limitMs(limit: Limit, refreshPeriodMs: number): number {
  if (typeof limit.ms === 'number') return limit.ms;
  if (typeof limit.refreshPeriods === 'number') return limit.refreshPeriods * refreshPeriodMs;
  throw new Error(`A limit needs ms or refreshPeriods: ${JSON.stringify(limit)}`);
}

export function withinBudget(
  value: number,
  budget: MetricBudget,
  refreshPeriodMs: number,
): boolean {
  const limit = limitMs(budget.limit, refreshPeriodMs);
  return budget.limit.inclusive === true ? value <= limit : value < limit;
}

/** Every way a budgets file breaks its own rules, or an empty list when it keeps them. */
export function budgetProblems(budgets: Budgets): string[] {
  const problems: string[] = [];
  const positive = (what: string, value: unknown) => {
    if (typeof value !== 'number' || !(value > 0)) problems.push(`${what} must be positive`);
  };
  positive('refreshPeriodMs', budgets.refreshPeriodMs);
  positive('ci.cpuThrottle', budgets.ci?.cpuThrottle);
  positive('seed', budgets.seed);
  for (const [id, metric] of Object.entries(budgets.metrics ?? {})) {
    positive(`${id}.samples`, metric.samples);
    if (!Number.isInteger(metric.warmup) || metric.warmup < 0) {
      problems.push(`${id}.warmup must be zero or more`);
    }
    if (!Number.isInteger(metric.phase) || metric.phase < 1) problems.push(`${id}.phase`);
    if (metric.feature === undefined || metric.feature === '') problems.push(`${id}.feature`);
    if (metric.statistic !== 'p95' && metric.statistic !== 'p50') problems.push(`${id}.statistic`);
    try {
      positive(`${id}.limit`, limitMs(metric.limit, budgets.refreshPeriodMs));
    } catch (error) {
      problems.push(String(error instanceof Error ? error.message : error));
    }
  }
  return problems;
}

export function parseBudgets(text: string): Budgets {
  const budgets = JSON.parse(text) as Budgets;
  const problems = budgetProblems(budgets);
  if (problems.length > 0) throw new Error(`bench/budgets.json is wrong: ${problems.join('; ')}`);
  return budgets;
}

export async function readBudgets(path = BUDGETS_FILE): Promise<Budgets> {
  return parseBudgets(await readFile(path, 'utf8'));
}

/** The metrics this phase, or any earlier one, has to meet. */
export function metricsForPhase(budgets: Budgets, phase: number): string[] {
  return Object.entries(budgets.metrics)
    .filter(([, metric]) => metric.phase <= phase)
    .map(([id]) => id);
}
