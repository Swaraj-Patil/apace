// The A/B rule. A branch is worse than its base only when a metric is both more than ten
// percent worse and worse by more than the base's own runs vary. One test on its own is noise;
// both together are a regression.
import { median, spread } from './stats.ts';

/** How much worse a metric may get before the size of the change matters at all. */
export const TOLERANCE = 0.1;

export type Verdict = 'new' | 'no-baseline' | 'better' | 'same' | 'worse';

export interface Comparison {
  readonly metric: string;
  readonly verdict: Verdict;
  /** The median of the base's runs, or null when it has none. */
  readonly base: number | null;
  readonly head: number | null;
  /** How far the base's runs spread, largest minus smallest. */
  readonly spread: number;
  /** How much worse the branch is, as a fraction of the base, or null without a base. */
  readonly change: number | null;
}

/**
 * Compares one metric's runs. `base` and `head` each hold one number per run, so three runs of
 * each give three numbers each.
 */
export function compareRuns(
  metric: string,
  base: readonly number[],
  head: readonly number[],
): Comparison {
  if (head.length === 0) {
    return { metric, verdict: 'no-baseline', base: null, head: null, spread: 0, change: null };
  }
  const headMedian = median(head);
  if (base.length === 0) {
    return { metric, verdict: 'new', base: null, head: headMedian, spread: 0, change: null };
  }
  const baseMedian = median(base);
  const baseSpread = spread(base);
  const change = baseMedian === 0 ? 0 : (headMedian - baseMedian) / baseMedian;
  const worseByMoreThanTolerance = headMedian > baseMedian * (1 + TOLERANCE);
  const worseByMoreThanSpread = headMedian - baseMedian > baseSpread;
  const verdict: Verdict =
    worseByMoreThanTolerance && worseByMoreThanSpread
      ? 'worse'
      : headMedian < baseMedian
        ? 'better'
        : 'same';
  return { metric, verdict, base: baseMedian, head: headMedian, spread: baseSpread, change };
}

/**
 * Compares every metric either side measured. A metric the base never measured is new, and one
 * the branch no longer measures has no baseline to compare against.
 */
export function compareAll(
  base: Readonly<Record<string, readonly number[]>>,
  head: Readonly<Record<string, readonly number[]>>,
): Comparison[] {
  const metrics = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  return metrics.map((metric) => compareRuns(metric, base[metric] ?? [], head[metric] ?? []));
}
