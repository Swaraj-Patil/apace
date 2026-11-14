import { DEFAULT_SEED } from '@apace/seed';
import {
  counts,
  expectSaved,
  fixtures,
  openBench,
  reloadBench,
  retitle,
  type SearchFixture,
  search,
  seed,
} from './bench.ts';
import { expect, test } from './fixtures.ts';

for (const mode of ['opfs', 'compat'] as const) {
  test(`a seeded workspace keeps its counts and search hits through a reload (${mode})`, {
    tag: mode === 'opfs' ? ['@smoke'] : [],
  }, async ({ page }) => {
    await openBench(page, mode === 'compat' ? '?store=compat' : '');
    await expectSaved(page, mode);

    const summary = await seed(page, DEFAULT_SEED);
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
    await expectSaved(page, mode);
    expect(await counts(page)).toEqual(seeded);
    const [{ query, expected }] = summary.searchQueries as [SearchFixture];
    expect((await search(page, query, 5))[0]).toBe(expected);
  });
}

// On the seeded profile, so this is about editing a workspace rather than making one.
test('an edited page is found by its new title at once, and after a reload', async ({ seeded }) => {
  const { searchQueries } = await fixtures(seeded, DEFAULT_SEED);
  const [{ query, expected }] = searchQueries as [SearchFixture];
  await retitle(seeded, expected, 'Quasar timeline');
  // Reads wait for pending projections, so the change shows before typing would pause.
  expect(await search(seeded, 'quasar', 5)).toEqual([expected]);
  expect(await search(seeded, query, 5)).toEqual([]);

  await reloadBench(seeded);
  await expectSaved(seeded);
  expect(await search(seeded, 'quas', 5)).toEqual([expected]);
});
