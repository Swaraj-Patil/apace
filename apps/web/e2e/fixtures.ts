// The fixtures every end-to-end spec uses, so a spec says what it needs rather than how to get
// it. Three things live here.
//
// - A guard. Anything the browser logs as an error fails the test that caused it, whatever that
//   test was checking, so a broken promise or a missing file can't pass unnoticed.
// - `fresh`: a browser on a profile with nothing in it, the way someone opening the app for the
//   first time. The profile is a real directory, so what the store writes has to reach disk.
// - `seeded`: a browser on a profile that already holds the workspace from the default seed.
//   Generating and importing 2,000 pages costs seconds, so each worker seeds one profile and
//   every test gets its own copy of it. The copy is what keeps a test that edits the workspace
//   from handing the next test a changed one.
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SEED, GENERATOR_VERSION } from '@apace/seed';
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Page,
  type ViewportSize,
} from '@playwright/test';
import { ensureSeeded, needsSeeding } from '../../../bench/chromium.ts';
import { benchReady, storeReady } from './bench.ts';
import { BENCH_URL } from './urls.ts';

/**
 * Seeded profiles, kept between runs. The marker inside each one records the seed and the
 * generator version, so a run seeds again only when one of them changes.
 */
const PROFILES = fileURLToPath(new URL('./.profile/', import.meta.url));

/** How a profile's browser is launched: the suite's own settings, so --headed still works. */
interface Launch {
  readonly channel: string | undefined;
  readonly headless: boolean;
  readonly viewport: ViewportSize | null;
}

/**
 * Watches every page a context opens, and returns the check that fails the test. Console errors
 * cover unhandled rejections too, which Chromium reports there as "Uncaught (in promise)".
 */
export function watchForProblems(context: BrowserContext): () => void {
  const problems: string[] = [];
  const watch = (page: Page) => {
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`uncaught ${error.name}: ${error.message}`));
  };
  for (const page of context.pages()) watch(page);
  context.on('page', watch);
  return () => {
    expect(problems, 'the browser logged these errors').toEqual([]);
  };
}

/**
 * Runs one test against a browser on `dir`. The browser comes from `@playwright/test`, so the
 * runner traces it and keeps the trace of a failure exactly as it does for a shared browser.
 */
async function useProfile(
  dir: string,
  launch: Launch,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await chromium.launchPersistentContext(dir, launch);
  const noProblems = watchForProblems(context);
  try {
    await use(context.pages()[0] ?? (await context.newPage()));
  } finally {
    await context.close();
  }
  noProblems();
}

/** Copies a closed profile, so the copy's browser starts from exactly those bytes. */
async function copyProfile(from: string, to: string): Promise<void> {
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
  // Chromium can leave its single-instance files behind, and a copy of one looks to the next
  // browser like another browser already using the profile.
  for (const singleton of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    await rm(join(to, singleton), { force: true });
  }
}

export interface Fixtures {
  /** A browser on a profile with nothing in it. Nothing is loaded yet. */
  fresh: Page;
  /** A browser on the bench build, with the default seed's workspace already in its store. */
  seeded: Page;
}

export interface WorkerFixtures {
  /** This worker's seeded profile, which each `seeded` test copies. */
  seededProfile: string;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  // Every test that uses the shared browser gets the guard, without asking for it.
  context: async ({ context }, use) => {
    const noProblems = watchForProblems(context);
    await use(context);
    noProblems();
  },

  fresh: async ({ channel, headless, viewport }, use, info) => {
    const dir = info.outputPath('fresh-profile');
    await useProfile(dir, { channel, headless, viewport }, use);
    await rm(dir, { recursive: true, force: true });
  },

  seededProfile: [
    async ({ channel, headless }, use, info) => {
      const marker = { seed: DEFAULT_SEED, generatorVersion: GENERATOR_VERSION };
      const dir = join(PROFILES, `seed-${DEFAULT_SEED}-worker-${info.workerIndex}`);
      await mkdir(dir, { recursive: true });
      // A profile seeded by an earlier run is used as it is, without starting a browser.
      if (await needsSeeding(dir, marker)) {
        const context = await chromium.launchPersistentContext(dir, { channel, headless });
        try {
          const page = context.pages()[0] ?? (await context.newPage());
          await page.goto(BENCH_URL);
          await benchReady(page);
          await storeReady(page);
          await ensureSeeded({ page }, dir, marker);
        } finally {
          await context.close();
        }
      }
      await use(dir);
    },
    { scope: 'worker' },
  ],

  seeded: async ({ seededProfile, channel, headless, viewport }, use, info) => {
    const dir = info.outputPath('seeded-profile');
    await copyProfile(seededProfile, dir);
    await useProfile(dir, { channel, headless, viewport }, async (page) => {
      await page.goto(BENCH_URL);
      await benchReady(page);
      await storeReady(page);
      await use(page);
    });
    await rm(dir, { recursive: true, force: true });
  },
});

export { expect } from '@playwright/test';
