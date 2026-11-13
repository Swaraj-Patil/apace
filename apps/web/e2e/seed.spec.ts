import { expect, test } from '@playwright/test';
import { counts, openBench, reloadBench, retitle, SAVED, search, seed } from './bench.ts';

for (const mode of ['opfs', 'compat'] as const) {
  test(`a seeded workspace keeps its counts and search hits through a reload (${mode})`, async ({
    page,
  }) => {
    await openBench(page, mode === 'compat' ? '?store=compat' : '');
    const status = page.getByRole('status');
    await expect(status).toHaveText(SAVED[mode]);

    const summary = await seed(page, 1);
    test.info().annotations.push({
      type: 'seed',
      description: `generated in ${Math.round(summary.generateMs)} ms, imported in ${Math.round(summary.importMs)} ms`,
    });
    const seeded = await counts(page);
    expect(seeded).toMatchObject(summary.expected);
    expect(seeded.pages).toBe(2000);
    for (const { query, expected } of summary.searchQueries) {
      expect((await search(page, query, 5))[0], query).toBe(expected);
    }

    await reloadBench(page);
    await expect(status).toHaveText(SAVED[mode]);
    expect(await counts(page)).toEqual(seeded);
    const [{ query, expected }] = summary.searchQueries as [SeedSummaryQuery];
    expect((await search(page, query, 5))[0]).toBe(expected);
  });
}

test('an edited page is found by its new title at once, and after a reload', async ({ page }) => {
  await openBench(page);
  await expect(page.getByRole('status')).toHaveText(SAVED.opfs);
  const summary = await seed(page, 1);
  const [{ query, expected }] = summary.searchQueries as [SeedSummaryQuery];
  await retitle(page, expected, 'Quasar timeline');
  // Reads wait for pending projections, so the change shows before typing would pause.
  expect(await search(page, 'quasar', 5)).toEqual([expected]);
  expect(await search(page, query, 5)).toEqual([]);

  await reloadBench(page);
  await expect(page.getByRole('status')).toHaveText(SAVED.opfs);
  expect(await search(page, 'quas', 5)).toEqual([expected]);
});

type SeedSummaryQuery = Awaited<ReturnType<typeof seed>>['searchQueries'][number];
