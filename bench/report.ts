// The shape of a bench result, and the table it prints.
import type { Budgets, MetricBudget } from './budgets.ts';
import { limitMs } from './budgets.ts';
import type { Comparison } from './compare.ts';

export interface MetricResult {
  readonly metric: string;
  readonly phase: number;
  readonly feature: string;
  readonly statistic: 'p95' | 'p50';
  readonly limitMs: number;
  readonly p50: number;
  readonly p95: number;
  /** The value the budget is judged on: the metric's own statistic. */
  readonly value: number;
  readonly samples: number;
  readonly warmupDropped: number;
  readonly withinBudget: boolean;
}

export interface RunResult {
  readonly startedAt: string;
  readonly sha: string;
  readonly branch: string;
  readonly dirty: boolean;
  readonly label: string;
  readonly cpu: string;
  readonly cores: number;
  readonly cpuThrottle: number;
  readonly seed: number;
  readonly generatorVersion: number;
  readonly seeded: boolean;
  readonly features: readonly string[];
  readonly metrics: readonly MetricResult[];
  /** Metrics of this phase or earlier that nothing measured, and why. */
  readonly missing: readonly { readonly metric: string; readonly reason: string }[];
}

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  return align === 'left' ? text.padEnd(width) : text.padStart(width);
}

export function formatLimit(budget: MetricBudget, refreshPeriodMs: number): string {
  const ms = limitMs(budget.limit, refreshPeriodMs);
  const relation = budget.limit.inclusive === true ? '≤' : '<';
  return `${relation} ${ms.toFixed(ms < 100 ? 1 : 0)} ms`;
}

/** The run as a table: metric, budget, p50, p95, samples, result. */
export function formatRun(run: RunResult, budgets: Budgets, comparisons?: Comparison[]): string {
  const byMetric = new Map(comparisons?.map((entry) => [entry.metric, entry]));
  const rows = run.metrics.map((result) => {
    const budget = budgets.metrics[result.metric];
    const change = byMetric.get(result.metric);
    return [
      result.metric,
      budget === undefined ? '' : formatLimit(budget, budgets.refreshPeriodMs),
      `${result.p50.toFixed(1)} ms`,
      `${result.p95.toFixed(1)} ms`,
      String(result.samples),
      result.withinBudget ? 'within budget' : 'OVER BUDGET',
      change === undefined ? '' : describeChange(change),
    ];
  });
  for (const gap of run.missing)
    rows.push([gap.metric, '', '', '', '', 'not measured', gap.reason]);

  const header = ['metric', 'budget', 'p50', 'p95', 'samples', 'result'];
  if (comparisons !== undefined) header.push('against the base');
  else if (run.missing.length > 0) header.push('why');
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) =>
        pad(cell, widths[column] ?? 0, column >= 2 && column <= 4 ? 'right' : 'left'),
      )
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join(
    '\n',
  );
}

export function describeChange(change: Comparison): string {
  switch (change.verdict) {
    case 'new':
      return 'new';
    case 'no-baseline':
      return 'no baseline';
    default: {
      const percent = ((change.change ?? 0) * 100).toFixed(1);
      const sign = (change.change ?? 0) >= 0 ? '+' : '';
      return `${sign}${percent}% (${change.verdict})`;
    }
  }
}
