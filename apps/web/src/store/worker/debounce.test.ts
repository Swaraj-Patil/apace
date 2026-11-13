import { describe, expect, test } from 'vitest';
import { debounce, type Timers } from './debounce.ts';

/** Timers driven by hand: `advance` moves the clock and fires whatever came due. */
function manualTimers(): Timers & { advance(ms: number): void } {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    set(run, ms) {
      const handle = next++;
      due.set(handle, { at: now + ms, run });
      return handle;
    },
    clear: (handle) => {
      due.delete(handle as number);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const first = [...due].sort(([, a], [, b]) => a.at - b.at)[0];
        if (first === undefined || first[1].at > until) break;
        due.delete(first[0]);
        now = first[1].at;
        first[1].run();
      }
      now = until;
    },
  };
}

describe('debounce', () => {
  test('runs once, after things go quiet', () => {
    const timers = manualTimers();
    const runs: number[] = [];
    const debounced = debounce(() => runs.push(timers.now()), 250, 2000, timers);
    debounced.schedule();
    timers.advance(100);
    debounced.schedule();
    timers.advance(249);
    expect(runs).toEqual([]);
    timers.advance(1);
    expect(runs).toEqual([350]);
  });

  test('runs by the maximum wait while requests keep coming', () => {
    const timers = manualTimers();
    const runs: number[] = [];
    const debounced = debounce(() => runs.push(timers.now()), 250, 2000, timers);
    for (let i = 0; i < 40; i++) {
      debounced.schedule();
      timers.advance(100);
    }
    expect(runs).toEqual([2000, 4000]);
  });

  test('does nothing once cancelled', () => {
    const timers = manualTimers();
    const runs: number[] = [];
    const debounced = debounce(() => runs.push(timers.now()), 250, 2000, timers);
    debounced.schedule();
    debounced.cancel();
    timers.advance(5000);
    expect(runs).toEqual([]);
  });
});
