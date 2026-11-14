// The arithmetic every bench number goes through.

/**
 * The nearest-rank percentile: the smallest sample that at least `percentile` percent of the
 * samples are at or below. No interpolation, so every reported number is a real measurement.
 */
export function percentile(samples: readonly number[], wanted: number): number {
  if (samples.length === 0) throw new Error('A percentile needs at least one sample');
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((wanted / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

export function median(samples: readonly number[]): number {
  return percentile(samples, 50);
}

/** How far a set of runs spreads: its largest value minus its smallest. */
export function spread(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  return Math.max(...samples) - Math.min(...samples);
}

/**
 * A frame interval as whole refresh periods. A frame that arrives on time is one period, and
 * one that misses a refresh is two. Every frame counts as at least one period, so a browser
 * drawing faster than the display can't make a run look better than it is.
 */
export function refreshPeriods(intervalMs: number, periodMs: number): number {
  if (!(periodMs > 0)) throw new Error('The refresh period must be positive');
  return Math.max(1, Math.round(intervalMs / periodMs));
}

/** Frame intervals snapped to whole refresh periods, in milliseconds. */
export function snapToRefresh(intervalsMs: readonly number[], periodMs: number): number[] {
  return intervalsMs.map((interval) => refreshPeriods(interval, periodMs) * periodMs);
}
