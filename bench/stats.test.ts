import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { median, percentile, refreshPeriods, snapToRefresh, spread } from './stats.ts';

describe('nearest-rank percentiles', () => {
  test('return a sample that was really measured', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 1, max: 100 }),
        (samples, wanted) => {
          expect(samples).toContain(percentile(samples, wanted));
        },
      ),
      { numRuns: 300 },
    );
  });

  test('cover at least the share of samples they name', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 1, maxLength: 60 }),
        fc.constantFrom(50, 75, 95, 99),
        (samples, wanted) => {
          const value = percentile(samples, wanted);
          const atOrBelow = samples.filter((sample) => sample <= value).length;
          expect(atOrBelow / samples.length).toBeGreaterThanOrEqual(wanted / 100);
        },
      ),
      { numRuns: 300 },
    );
  });

  test('read off the examples by hand', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(ten, 95)).toBe(10);
    expect(percentile(ten, 50)).toBe(5);
    expect(percentile(ten, 1)).toBe(1);
    expect(percentile([7], 95)).toBe(7);
    // A tenth of the samples above the budget is exactly what a p95 is there to catch.
    expect(percentile([...Array(18).fill(10), 500, 500], 95)).toBe(500);
    // One sample in twenty does not reach it, which is the statistic working as agreed.
    expect(percentile([...Array(19).fill(10), 500], 95)).toBe(10);
  });

  test('refuse to invent a number from nothing', () => {
    expect(() => percentile([], 95)).toThrow('at least one sample');
  });

  test('median is the fiftieth', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2);
  });
});

describe('spread', () => {
  test('is the distance between the fastest and slowest run', () => {
    expect(spread([10, 12, 11])).toBe(2);
    expect(spread([7])).toBe(0);
    expect(spread([])).toBe(0);
  });
});

describe('snapping to the refresh period', () => {
  test('counts a frame that arrives on time as one period', () => {
    for (const interval of [8, 16.7, 20, 24]) expect(refreshPeriods(interval, 16.667)).toBe(1);
  });

  test('counts a frame that misses refreshes as the periods it took', () => {
    expect(refreshPeriods(33.3, 16.667)).toBe(2);
    expect(refreshPeriods(50, 16.667)).toBe(3);
    expect(refreshPeriods(100, 16.667)).toBe(6);
  });

  test('never counts a frame as less than one period', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: 1, max: 20, noNaN: true }),
        (interval, period) => {
          expect(refreshPeriods(interval, period)).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 300 },
    );
  });

  test('snaps a run of intervals to whole periods', () => {
    expect(snapToRefresh([16, 17, 34], 16.667)).toEqual([16.667, 16.667, 33.334]);
  });

  test('refuses a refresh period that makes no sense', () => {
    expect(() => refreshPeriods(16, 0)).toThrow('must be positive');
  });
});
