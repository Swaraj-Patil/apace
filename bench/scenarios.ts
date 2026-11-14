// What each metric does to get its samples. A metric with no scenario here isn't measured yet,
// and the runner reports it as missing rather than passing it quietly.
import type { MetricBudget } from './budgets.ts';
import type { BenchPage, Sample } from './chromium.ts';

export interface ScenarioContext {
  readonly bench: BenchPage;
  readonly budget: MetricBudget;
  /** How many samples to take in all, warm-up included. */
  readonly take: number;
}

/** Returns one number per sample, warm-up included and in the order they were taken. */
export type Scenario = (context: ScenarioContext) => Promise<Sample[]>;

/**
 * Cold start: load the app, wait for the shell to be interactive, and do it again. Each load is
 * a fresh navigation, so the store opens from OPFS the way it does for someone opening the app.
 */
const coldStart: Scenario = async ({ bench, take }) => {
  const samples: Sample[] = [];
  for (let i = 0; i < take; i++) {
    await bench.reload();
    samples.push(...(await bench.collect('cold-start', 1)));
  }
  return samples;
};

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  'cold-start': coldStart,
};

/** How a metric counts a sample: some budgets leave out the wait for the next refresh. */
export function countedValue(sample: Sample, budget: MetricBudget): number {
  const span = sample.end - sample.start;
  return budget.excludeIdle === true ? span - sample.idleMs : span;
}
