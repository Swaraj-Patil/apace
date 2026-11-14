// Bench builds only. The store worker imports this behind import.meta.env.MODE === 'bench', so
// production bundles never contain the seed generator.

import type { SeedFixtures } from '@apace/seed';
import { planWorkspace, seedFixtures, seedRecords } from '@apace/seed';
import type { SeedSummary } from '../api.ts';
import type { ImportRecord } from './projector.ts';

/** The pages the bench measures. Planning the workspace is cheap; generating it isn't. */
export function fixturesFor(seed: number): SeedFixtures {
  return seedFixtures(planWorkspace(seed));
}

/** Generates the seeded workspace in this worker, and hands it to `importRecords`. */
export async function seedWorkspace(
  seed: number,
  importRecords: (records: readonly ImportRecord[]) => Promise<void>,
): Promise<SeedSummary> {
  const started = performance.now();
  const plan = planWorkspace(seed);
  const records = [...seedRecords(plan)];
  const generated = performance.now();
  await importRecords(records);
  const imported = performance.now();
  return {
    seed,
    expected: {
      pages: plan.pages.length,
      trashed: plan.pages.filter((page) => page.trashedAt !== null).length,
      blocks: plan.pages.reduce((sum, page) => sum + page.blockCount, 0),
    },
    searchQueries: seedFixtures(plan).searchQueries,
    generateMs: generated - started,
    importMs: imported - generated,
  };
}
