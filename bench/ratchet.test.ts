import { describe, expect, test } from 'vitest';
import { type Budgets, budgetProblems, parseBudgets, readBudgets } from './budgets.ts';
import { budgetsAt, ratchetProblems } from './ratchet.ts';

/** A small budgets file to bend out of shape. */
const baseline: Budgets = {
  refreshPeriodMs: 16.667,
  ci: { cpuThrottle: 2, runner: 'ubuntu-24.04' },
  viewport: { width: 1536, height: 864, deviceScaleFactor: 1.25 },
  seed: 1,
  metrics: {
    'page-open': {
      phase: 1,
      feature: 'pages',
      statistic: 'p95',
      limit: { ms: 100 },
      samples: 60,
      warmup: 2,
      span: 'Click to painted content',
    },
    scroll: {
      phase: 1,
      feature: 'scroll',
      statistic: 'p95',
      limit: { refreshPeriods: 1, inclusive: true },
      samples: 240,
      warmup: 0,
      perViewMs: 5000,
      span: 'Frame intervals',
    },
  },
};

/** The same shape, with every `readonly` taken off, so a test can bend it. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

/** The same file with one thing changed. */
function bent(change: (budgets: Mutable<Budgets>) => void): Budgets {
  const copy = JSON.parse(JSON.stringify(baseline)) as Mutable<Budgets>;
  change(copy);
  return copy as Budgets;
}

const pageOpen = (budgets: Mutable<Budgets>) =>
  budgets.metrics['page-open'] as unknown as Record<string, unknown>;

describe('the budget ratchet', () => {
  test('lets an unchanged file through', () => {
    expect(
      ratchetProblems(
        baseline,
        bent(() => {}),
      ),
    ).toEqual([]);
  });

  test('lets a stricter file through', () => {
    const stricter = bent((budgets) => {
      pageOpen(budgets).limit = { ms: 80 };
      pageOpen(budgets).samples = 120;
      pageOpen(budgets).warmup = 0;
      budgets.ci = { ...budgets.ci, cpuThrottle: 4 };
    });
    expect(ratchetProblems(baseline, stricter)).toEqual([]);
  });

  test('catches a budget that rose', () => {
    const looser = bent((budgets) => {
      pageOpen(budgets).limit = { ms: 101 };
    });
    expect(ratchetProblems(baseline, looser)).toEqual(['page-open rose from 100 ms to 101 ms']);
  });

  test('catches a budget that rose through the refresh period', () => {
    const looser = bent((budgets) => {
      budgets.refreshPeriodMs = 33.3;
    });
    expect(ratchetProblems(baseline, looser)).toEqual([
      expect.stringContaining('scroll rose from 16.667 ms'),
    ]);
  });

  test('catches a metric that disappeared', () => {
    const fewer = bent((budgets) => {
      delete budgets.metrics.scroll;
    });
    expect(ratchetProblems(baseline, fewer)).toEqual(['scroll is gone']);
  });

  test('catches fewer samples and more warm-up', () => {
    const weaker = bent((budgets) => {
      pageOpen(budgets).samples = 30;
      pageOpen(budgets).warmup = 20;
    });
    expect(ratchetProblems(baseline, weaker)).toEqual([
      'page-open takes 30 samples, down from 60',
      'page-open drops 20 warm-up samples, up from 2',
    ]);
  });

  test('catches a CPU throttle that went down', () => {
    const faster = bent((budgets) => {
      budgets.ci = { ...budgets.ci, cpuThrottle: 1 };
    });
    expect(ratchetProblems(baseline, faster)).toEqual(['the CI CPU throttle fell from 2× to 1×']);
  });

  test('catches a budget that stopped counting the idle wait', () => {
    const weaker = bent((budgets) => {
      pageOpen(budgets).excludeIdle = true;
    });
    expect(ratchetProblems(baseline, weaker)).toEqual([
      'page-open stopped counting the wait for the next refresh',
    ]);
  });

  test('catches a metric pushed into a later phase, and a shorter scroll', () => {
    const later = bent((budgets) => {
      pageOpen(budgets).phase = 2;
      (budgets.metrics.scroll as unknown as Record<string, unknown>).perViewMs = 1000;
    });
    expect(ratchetProblems(baseline, later)).toEqual([
      'page-open moved from phase 1 to phase 2',
      'scroll scrolls each view for less time than before',
    ]);
  });

  test('catches a budget that now passes at its limit rather than below it', () => {
    const weaker = bent((budgets) => {
      pageOpen(budgets).limit = { ms: 100, inclusive: true };
    });
    expect(ratchetProblems(baseline, weaker)).toEqual([
      'page-open now passes at its limit rather than below it',
    ]);
  });
});

describe('this repository’s budgets', () => {
  test('say everything a run needs to know', async () => {
    const budgets = await readBudgets();
    expect(budgetProblems(budgets)).toEqual([]);
    expect(Object.keys(budgets.metrics).length).toBeGreaterThan(0);
  });

  test('hold every budget the brief promises, for this phase and the next', async () => {
    const budgets = await readBudgets();
    const phases = new Set(Object.values(budgets.metrics).map((metric) => metric.phase));
    expect([...phases].sort()).toEqual([1, 2]);
    for (const metric of [
      'cold-start',
      'page-open.typical',
      'page-open.large',
      'page-editable.large',
      'keystroke.typical',
      'keystroke.large',
      'scroll',
      'quick-search',
    ]) {
      expect(Object.keys(budgets.metrics)).toContain(metric);
    }
  });

  test('are no looser than any committed copy of themselves', async () => {
    const head = await readBudgets();
    // Both refs are checked: the branch's last commit catches a change made in this step, and
    // main catches the branch as a whole. A ref without the file has nothing to ratchet
    // against, which is what the A/B run reports as "no baseline".
    for (const ref of ['HEAD', 'main']) {
      const base = await budgetsAt(ref);
      if (base !== null) expect(ratchetProblems(base, head), ref).toEqual([]);
    }
  });

  test('refuse a file that contradicts itself', () => {
    expect(() => parseBudgets('{"refreshPeriodMs": 0, "metrics": {}}')).toThrow('is wrong');
  });
});
