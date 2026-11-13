// Drives the bench-build hooks that apps/web/src/bench/index.ts installs. Each page.evaluate
// callback runs in the browser on its own, so each one looks the hooks up itself.
import type { Page } from '@playwright/test';
import { BENCH_URL } from './urls.ts';

/** What the status shows once the store is ready in each mode. */
export const SAVED = {
  opfs: 'Saved on this device',
  compat: 'Saved in this browser (compatibility mode)',
} as const;

export interface Counts {
  readonly pages: number;
  readonly trashed: number;
  readonly blocks: number;
  readonly links: number;
}

export interface SeedSummary {
  readonly expected: Pick<Counts, 'pages' | 'trashed' | 'blocks'>;
  readonly searchQueries: readonly { readonly query: string; readonly expected: string }[];
  readonly generateMs: number;
  readonly importMs: number;
}

interface BenchStore {
  history(): readonly string[];
  writeText(docId: string, text: string): Promise<void>;
  readText(docId: string): Promise<string | null>;
  checkpoint(): Promise<void>;
  seed(seed: number): Promise<SeedSummary>;
  retitle(pageId: string, title: string): Promise<void>;
  counts(): Promise<Counts>;
  search(query: string, limit: number): Promise<readonly { readonly id: string }[]>;
}

type BenchWindow = Window & { __bench?: { store?: BenchStore } };

/** Opens the bench build, optionally with a query string, and waits for its hooks. */
export async function openBench(page: Page, query = ''): Promise<void> {
  await page.goto(BENCH_URL + query);
  await benchReady(page);
}

export async function reloadBench(page: Page): Promise<void> {
  await page.reload();
  await benchReady(page);
}

async function benchReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as BenchWindow).__bench?.store !== undefined);
}

export function writeText(page: Page, docId: string, text: string): Promise<void> {
  return page.evaluate(
    ([id, value]) => {
      const store = (window as BenchWindow).__bench?.store;
      if (store === undefined) throw new Error('This is not a bench build');
      return store.writeText(id, value);
    },
    [docId, text] as const,
  );
}

export function readText(page: Page, docId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const store = (window as BenchWindow).__bench?.store;
    if (store === undefined) throw new Error('This is not a bench build');
    return store.readText(id);
  }, docId);
}

export function checkpoint(page: Page): Promise<void> {
  return page.evaluate(() => {
    const store = (window as BenchWindow).__bench?.store;
    if (store === undefined) throw new Error('This is not a bench build');
    return store.checkpoint();
  });
}

export function statusHistory(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const store = (window as BenchWindow).__bench?.store;
    if (store === undefined) throw new Error('This is not a bench build');
    return store.history();
  });
}

export function seed(page: Page, seed: number): Promise<SeedSummary> {
  return page.evaluate((n) => {
    const store = (window as BenchWindow).__bench?.store;
    if (store === undefined) throw new Error('This is not a bench build');
    return store.seed(n);
  }, seed);
}

export function counts(page: Page): Promise<Counts> {
  return page.evaluate(() => {
    const store = (window as BenchWindow).__bench?.store;
    if (store === undefined) throw new Error('This is not a bench build');
    return store.counts();
  });
}

/** The ids of the top hits, best first. */
export function search(page: Page, query: string, limit: number): Promise<string[]> {
  return page.evaluate(
    async ([text, most]) => {
      const store = (window as BenchWindow).__bench?.store;
      if (store === undefined) throw new Error('This is not a bench build');
      return (await store.search(text, most)).map((hit) => hit.id);
    },
    [query, limit] as const,
  );
}

export function retitle(page: Page, pageId: string, title: string): Promise<void> {
  return page.evaluate(
    ([id, text]) => {
      const store = (window as BenchWindow).__bench?.store;
      if (store === undefined) throw new Error('This is not a bench build');
      return store.retitle(id, text);
    },
    [pageId, title] as const,
  );
}
