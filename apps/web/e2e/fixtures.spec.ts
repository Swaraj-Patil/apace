// The suite's own machinery. If the guard stops catching errors, or a seeded profile arrives
// carrying the last test's edits, every other spec gets quieter without getting truer.
import { DEFAULT_SEED, PAGE_COUNT } from '@apace/seed';
import { counts, fixtures, retitle, type SearchFixture, search } from './bench.ts';
import { expect, test, watchForProblems } from './fixtures.ts';
import { PRODUCTION_URL } from './urls.ts';

test('the guard fails a test on a console error or an unhandled rejection', async ({ browser }) => {
  // Its own context, because the guard on this test's browser would fail this test.
  const context = await browser.newContext();
  const noProblems = watchForProblems(context);
  const page = await context.newPage();
  await page.goto(PRODUCTION_URL);
  await page.evaluate(() => {
    console.error('a logged error');
    void Promise.reject(new Error('a dropped promise'));
    setTimeout(() => {
      throw new Error('an uncaught throw');
    });
  });

  // Console messages arrive from the browser in their own time, so wait for all three.
  await expect
    .poll(() => {
      try {
        noProblems();
        return [];
      } catch (failure) {
        return [...String(failure).matchAll(/a logged error|a dropped promise|an uncaught throw/g)]
          .map(([found]) => found)
          .sort();
      }
    })
    .toEqual(['a dropped promise', 'a logged error', 'an uncaught throw']);
  await context.close();
});

test.describe('the seeded profile', () => {
  // In order, in one worker, so the second test really does follow the first one's edit.
  test.describe.configure({ mode: 'serial' });

  test('arrives with the whole workspace in it, and takes an edit', async ({ seeded }) => {
    expect((await counts(seeded)).pages).toBe(PAGE_COUNT);
    const { searchQueries } = await fixtures(seeded, DEFAULT_SEED);
    const [{ query, expected }] = searchQueries as [SearchFixture];
    expect((await search(seeded, query, 5))[0]).toBe(expected);
    await retitle(seeded, expected, 'Pulsar notebook');
    expect(await search(seeded, 'pulsar', 5)).toEqual([expected]);
  });

  test('is a copy, so the next test gets the seeded titles back', async ({ seeded }) => {
    const { searchQueries } = await fixtures(seeded, DEFAULT_SEED);
    const [{ query, expected }] = searchQueries as [SearchFixture];
    expect((await search(seeded, query, 5))[0]).toBe(expected);
    expect(await search(seeded, 'pulsar', 5)).toEqual([]);
  });
});
