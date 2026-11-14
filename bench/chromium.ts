// Launching the browser the bench measures in, and the hooks it drives.
//
// The profile is kept between runs, so the seeded workspace stays in OPFS and a run that
// changes nothing about the seed starts from the same bytes as the last one.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, chromium, type Page } from 'playwright';
import type { Budgets } from './budgets.ts';

export const PROFILE_ROOT = fileURLToPath(new URL('./.profile/', import.meta.url));

export interface Sample {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly idleMs: number;
  readonly detail?: Record<string, unknown>;
}

export interface BenchPage {
  readonly page: Page;
  readonly context: BrowserContext;
  /** The features the app declares. */
  features(): Promise<string[]>;
  /** Loads the app fresh and waits for its hooks. */
  reload(): Promise<void>;
  /** Samples taken since the last read, which this empties. */
  drain(): Promise<Sample[]>;
  /** Waits for `count` samples called `name`, or says what the app was still waiting for. */
  collect(name: string, count: number, timeoutMs?: number): Promise<Sample[]>;
  close(): Promise<void>;
}

interface BenchWindow extends Window {
  __bench?: {
    features: readonly string[];
    samples(): Sample[];
    shellPending(): string[];
    store: { seed(seed: number): Promise<unknown> };
  };
}

export interface LaunchOptions {
  readonly url: string;
  readonly budgets: Budgets;
  /** Where this browser keeps its profile, so runs of the same build share OPFS data. */
  readonly profile: string;
  /** Writes a Chrome trace here when set. */
  readonly tracePath?: string | undefined;
}

export async function launchBench(options: LaunchOptions): Promise<BenchPage> {
  const { width, height, deviceScaleFactor } = options.budgets.viewport;
  await mkdir(options.profile, { recursive: true });
  const context = await chromium.launchPersistentContext(options.profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width, height },
    deviceScaleFactor,
  });
  const page = context.pages()[0] ?? (await context.newPage());

  // The throttle only goes up, so a slower machine can stand in for a faster one.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.budgets.ci.cpuThrottle });

  if (options.tracePath !== undefined) {
    await mkdir(dirname(options.tracePath), { recursive: true });
    await context.browser()?.startTracing(page, { path: options.tracePath, screenshots: false });
  }

  const ready = () => page.waitForFunction(() => (window as BenchWindow).__bench !== undefined);
  const drain = async (): Promise<Sample[]> =>
    page.evaluate(() => (window as BenchWindow).__bench?.samples() ?? []);

  return {
    page,
    context,
    features: () =>
      page.evaluate(() => [...((window as BenchWindow).__bench?.features ?? [])] as string[]),
    async reload() {
      await page.goto(options.url);
      await ready();
    },
    drain,
    async collect(name, count, timeoutMs = 30_000) {
      const found: Sample[] = [];
      const deadline = Date.now() + timeoutMs;
      while (found.length < count) {
        found.push(...(await drain()).filter((sample) => sample.name === name));
        if (found.length >= count) break;
        if (Date.now() > deadline) {
          const pending = await page.evaluate(
            () => (window as BenchWindow).__bench?.shellPending() ?? [],
          );
          throw new Error(
            `Only ${found.length} of ${count} ${name} samples arrived in ${timeoutMs} ms` +
              (pending.length > 0 ? `; the shell was still waiting for ${pending.join(', ')}` : ''),
          );
        }
        await page.waitForTimeout(25);
      }
      return found.slice(0, count);
    },
    async close() {
      if (options.tracePath !== undefined) await context.browser()?.stopTracing();
      await context.close();
    },
  };
}

interface SeedMarker {
  readonly seed: number;
  readonly generatorVersion: number;
}

/**
 * Whether a profile still has to be seeded. Reading the marker needs no browser, so a caller
 * that would have to start one can ask first.
 */
export async function needsSeeding(profile: string, marker: SeedMarker): Promise<boolean> {
  try {
    const previous = JSON.parse(await readFile(join(profile, 'seeded.json'), 'utf8')) as SeedMarker;
    return previous.seed !== marker.seed || previous.generatorVersion !== marker.generatorVersion;
  } catch {
    // No marker, or an unreadable one: seed again.
    return true;
  }
}

/**
 * Seeds the workspace, but only when the seed or the generator has changed since last time.
 * It takes any open page with the bench hooks, so the end-to-end suite seeds its own profiles
 * through this one marker.
 */
export async function ensureSeeded(
  bench: { readonly page: Page },
  profile: string,
  marker: SeedMarker,
): Promise<boolean> {
  if (!(await needsSeeding(profile, marker))) return false;
  await bench.page.evaluate(
    (seed) => (window as BenchWindow).__bench?.store.seed(seed),
    marker.seed,
  );
  await writeFile(join(profile, 'seeded.json'), `${JSON.stringify(marker, null, 2)}\n`);
  return true;
}
