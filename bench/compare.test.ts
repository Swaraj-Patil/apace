import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { compareAll, compareRuns, TOLERANCE } from './compare.ts';
import { median, spread } from './stats.ts';

const verdict = (base: number[], head: number[]) => compareRuns('m', base, head).verdict;

describe('the A/B rule', () => {
  test('calls a steady branch the same', () => {
    expect(verdict([100, 101, 102], [100, 101, 102])).toBe('same');
    expect(verdict([100, 101, 102], [99, 101, 103])).toBe('same');
  });

  test('calls a faster branch better', () => {
    expect(verdict([100, 100, 100], [80, 81, 82])).toBe('better');
  });

  test('needs both a big change and one outside the base’s own spread', () => {
    // Twenty percent worse, but the base's runs vary by more than that.
    expect(verdict([80, 100, 140], [120, 120, 120])).toBe('same');
    // Twenty percent worse on a base that barely varies.
    expect(verdict([100, 100, 101], [120, 120, 120])).toBe('worse');
    // Steady base, but a change too small to care about.
    expect(verdict([100, 100, 100], [105, 105, 105])).toBe('same');
  });

  test('says when a metric is new, and when there is nothing to compare against', () => {
    expect(verdict([], [40, 41, 42])).toBe('new');
    expect(verdict([40, 41, 42], [])).toBe('no-baseline');
  });

  test('reports how much the branch changed', () => {
    const change = compareRuns('m', [100, 100, 100], [120, 120, 120]);
    expect(change.change).toBeCloseTo(0.2, 6);
    expect(change.base).toBe(100);
    expect(change.head).toBe(120);
    expect(change.spread).toBe(0);
  });

  test('compares every metric either side measured', () => {
    const all = compareAll({ a: [10, 10, 10], b: [5, 5, 5] }, { a: [10, 10, 10], c: [1, 1, 1] });
    expect(all.map((entry) => [entry.metric, entry.verdict])).toEqual([
      ['a', 'same'],
      ['b', 'no-baseline'],
      ['c', 'new'],
    ]);
  });
});

const runs = fc.array(fc.double({ min: 1, max: 400, noNaN: true }), {
  minLength: 1,
  maxLength: 5,
});

describe('the A/B rule holds for any runs', () => {
  test('a branch is worse exactly when both tests say so', () => {
    fc.assert(
      fc.property(runs, runs, (base, head) => {
        const both =
          median(head) > median(base) * (1 + TOLERANCE) &&
          median(head) - median(base) > spread(base);
        expect(verdict(base, head) === 'worse').toBe(both);
      }),
      { numRuns: 500 },
    );
  });

  test('a branch that matches its base is never worse', () => {
    fc.assert(
      fc.property(runs, (base) => {
        expect(verdict(base, [...base])).not.toBe('worse');
      }),
      { numRuns: 300 },
    );
  });

  test('a faster branch is never worse', () => {
    fc.assert(
      fc.property(runs, runs, (base, head) => {
        const faster = head.map((value) => Math.min(value, Math.min(...base)));
        expect(verdict(base, faster)).not.toBe('worse');
      }),
      { numRuns: 300 },
    );
  });

  test('slowing a branch down never improves its verdict', () => {
    const rank = { better: 0, same: 1, new: 1, 'no-baseline': 1, worse: 2 } as const;
    fc.assert(
      fc.property(runs, runs, fc.double({ min: 0, max: 200, noNaN: true }), (base, head, extra) => {
        const slower = head.map((value) => value + extra);
        expect(rank[verdict(base, slower)]).toBeGreaterThanOrEqual(rank[verdict(base, head)]);
      }),
      { numRuns: 500 },
    );
  });

  test('a base that varies by more than the change absorbs it', () => {
    fc.assert(
      fc.property(runs, runs, (base, head) => {
        if (verdict(base, head) !== 'worse') return;
        // One run either side of the base, far enough out to cover the change. It leaves the
        // base's middle where it was, so only the spread rule can have changed its mind.
        const gap = median(head) - median(base);
        const wider = [...base, Math.min(...base) - gap - 1, Math.max(...base) + gap + 1];
        expect(median(wider)).toBe(median(base));
        expect(verdict(wider, head)).not.toBe('worse');
      }),
      { numRuns: 500 },
    );
  });
});
