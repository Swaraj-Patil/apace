// Calibrates the probes against synthetic work with known costs. If these drift, every number
// the bench reports is suspect, so they check the probes rather than the app.
import type { Page } from '@playwright/test';
import { median, percentile, snapToRefresh } from '../../../bench/stats.ts';
import { expect, test } from './fixtures.ts';
import { BENCH_URL } from './urls.ts';

interface Sample {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly idleMs: number;
}

interface ProbeWindow extends Window {
  __probe?: {
    keyCosts(ms: number): void;
    clickCosts(ms: number): void;
    queueWork(kind: 'timeout' | 'message', busyMs: number): void;
    stallScroll(
      ms: number,
      stallMs: number,
      everyFrames: number,
    ): Promise<{ intervals: number[]; stalls: number }>;
    samples(): Sample[];
  };
}

const PROBE_URL = `${BENCH_URL}probe.html`;
/** 60 Hz, the refresh rate the bench assumes. */
const REFRESH_MS = 16.667;
/** Enough readings that one slow frame can't decide the answer. */
const READINGS = 7;

async function openProbe(page: Page): Promise<void> {
  await page.goto(PROBE_URL);
  await page.waitForFunction(() => (window as ProbeWindow).__probe !== undefined);
  await page.locator('#box').waitFor();
}

/** The samples taken since the last read. */
async function drain(page: Page, name: string): Promise<Sample[]> {
  const taken = await page.evaluate(() => (window as ProbeWindow).__probe?.samples() ?? []);
  return taken.filter((sample) => sample.name === name);
}

/** Waits for one sample of `name`, and returns it. */
async function nextSample(page: Page, name: string): Promise<Sample> {
  const found: Sample[] = [];
  await expect
    .poll(async () => {
      found.push(...(await drain(page, name)));
      return found.length;
    })
    .toBeGreaterThan(0);
  return found[0] as Sample;
}

/** How long a sample says the main thread was busy. */
const busyOf = (sample: Sample) => sample.end - sample.start - sample.idleMs;

/** The work one key reads as, with a handler that busies the main thread for `busyMs`. */
async function readKey(page: Page, busyMs: number, queue?: 'timeout' | 'message'): Promise<number> {
  const readings: number[] = [];
  for (let i = 0; i < READINGS; i++) {
    await page.evaluate(
      ([ms, kind]) => {
        const probe = (window as ProbeWindow).__probe;
        probe?.keyCosts(ms as number);
        // Queued from the key handler's own task, so it runs before the frame is painted.
        if (kind !== null) {
          document.addEventListener(
            'keydown',
            () => probe?.queueWork(kind as 'timeout' | 'message', 10),
            { once: true },
          );
        }
      },
      [busyMs, queue ?? null] as const,
    );
    await page.locator('#field').focus();
    await drain(page, 'keystroke');
    await page.keyboard.press('a');
    readings.push(busyOf(await nextSample(page, 'keystroke')));
  }
  return median(readings);
}

test('a busy key handler reads back as the work it did', async ({ page }) => {
  await openProbe(page);
  const read = new Map<number, number>();
  for (const busyMs of [4, 10, 20]) read.set(busyMs, await readKey(page, busyMs));

  for (const [busyMs, measured] of read) {
    const over = measured - busyMs;
    const note = `${busyMs} ms of work read ${measured.toFixed(2)} ms`;
    // The work is never hidden, and all that sits on top of it is the frame's own work.
    expect(over, note).toBeGreaterThanOrEqual(0);
    expect(over, note).toBeLessThanOrEqual(2);
  }
  // That frame cost is the same whatever the handler does, so added work reads exactly.
  const steps: [number, number][] = [
    [10, 4],
    [20, 10],
  ];
  for (const [more, less] of steps) {
    const grew = (read.get(more) ?? 0) - (read.get(less) ?? 0);
    expect(
      Math.abs(grew - (more - less)),
      `${less} to ${more} ms grew ${grew.toFixed(2)} ms`,
    ).toBeLessThanOrEqual(1);
  }
});

test('work queued before the frame counts, rather than hiding as idle', async ({ page }) => {
  await openProbe(page);
  // Ten milliseconds spent in the handler itself is the yardstick: a timer or a message task
  // that does the same work before the frame has to read the same.
  const inline = await readKey(page, 10);
  for (const kind of ['timeout', 'message'] as const) {
    const queued = await readKey(page, 0, kind);
    const note = `${kind} read ${queued.toFixed(2)} ms against ${inline.toFixed(2)} ms inline`;
    expect(Math.abs(queued - inline), note).toBeLessThanOrEqual(1);
  }
});

test('a click whose paint is held back reads the time it was held', async ({ page }) => {
  await openProbe(page);
  const spans: number[] = [];
  const busy: number[] = [];
  for (let i = 0; i < READINGS; i++) {
    await page.evaluate(() => (window as ProbeWindow).__probe?.clickCosts(30));
    await drain(page, 'page-open');
    await page.locator('#button').click();
    const sample = await nextSample(page, 'page-open');
    spans.push(sample.end - sample.start);
    busy.push(busyOf(sample));
  }
  // The work is what the probe claims to a couple of milliseconds...
  expect(Math.abs(median(busy) - 30)).toBeLessThanOrEqual(2);
  // ...and the span the budget counts also holds the wait for the next refresh, which is
  // what someone clicking actually waits through.
  expect(median(spans)).toBeGreaterThanOrEqual(median(busy));
  expect(median(spans)).toBeLessThan(30 + REFRESH_MS + 2);
});

test('a stall every twenty frames shows up in the snapped frame intervals', async ({ page }) => {
  await openProbe(page);
  const run = await page.evaluate(
    () =>
      (window as ProbeWindow).__probe?.stallScroll(2000, 50, 20) ?? { intervals: [], stalls: 0 },
  );
  expect(run.intervals.length).toBeGreaterThan(60);
  expect(run.stalls).toBeGreaterThanOrEqual(4);
  const snapped = snapToRefresh(run.intervals, REFRESH_MS);

  // A frame that arrives on time is one period, and most of them do.
  expect(percentile(snapped, 50)).toBeCloseTo(REFRESH_MS, 1);
  // Every stall costs one frame, which the snapping shows as the periods it missed. The last
  // stall can land after the final frame, so one may have no interval to show up in.
  const missed = snapped.filter((interval) => interval >= 2 * REFRESH_MS);
  expect(missed.length).toBeGreaterThanOrEqual(run.stalls - 1);
  expect(missed.length).toBeLessThanOrEqual(run.stalls + 1);
  expect(median(missed)).toBeGreaterThanOrEqual(3 * REFRESH_MS);

  // One frame in twenty is five percent of them, which a nearest-rank p95 sits just below. The
  // stall reaches the p95 as soon as it costs more than that, so a tighter run has to show it.
  const tighter = await page.evaluate(
    () =>
      (window as ProbeWindow).__probe?.stallScroll(2000, 50, 10) ?? { intervals: [], stalls: 0 },
  );
  expect(percentile(snapToRefresh(tighter.intervals, REFRESH_MS), 95)).toBeGreaterThanOrEqual(
    3 * REFRESH_MS,
  );
});
