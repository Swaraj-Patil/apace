import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANTED } from '@apace/seed';
import { expect, type Page, test } from '@playwright/test';
import { SAVED } from './bench.ts';
import { BENCH_URL, PRODUCTION_URL } from './urls.ts';

const productionDist = fileURLToPath(new URL('../dist/', import.meta.url));

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('the production build paints the shell with no console errors', async ({ page }) => {
  const errors = collectErrors(page);
  const response = await page.goto(PRODUCTION_URL);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Apace');
  await expect(page.getByRole('heading', { level: 1, name: 'Apace' })).toBeVisible();
  expect(errors).toEqual([]);
});

// The production server applies vercel.json's rewrites and headers, as the deployed site does.
test('the hosted build opens the store at any route, with no console errors', async ({ page }) => {
  const errors = collectErrors(page);
  const response = await page.goto(`${PRODUCTION_URL}pages/some-page`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('status')).toHaveText(SAVED.opfs);
  expect(errors).toEqual([]);
});

test('the hosted build answers a missing asset with 404, and serves wasm as wasm', async ({
  request,
}) => {
  expect((await request.get(`${PRODUCTION_URL}assets/missing.js`)).status()).toBe(404);
  const assets = await readdir(join(productionDist, 'assets'));
  const wasm = assets.find((name) => name.endsWith('.wasm'));
  const response = await request.get(`${PRODUCTION_URL}assets/${wasm}`);
  expect(response.headers()['content-type']).toBe('application/wasm');
  expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('no response asks for cross-origin isolation', async ({ page }) => {
  const isolating: string[] = [];
  page.on('response', (response) => {
    const headers = response.headers();
    for (const name of ['cross-origin-opener-policy', 'cross-origin-embedder-policy']) {
      const value = headers[name];
      if (value !== undefined) isolating.push(`${response.url()} sent ${name}: ${value}`);
    }
  });
  await page.goto(PRODUCTION_URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(isolating).toEqual([]);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);
});

test('bench hooks and the seed generator exist only in bench builds', async ({ page }) => {
  const files = await readdir(productionDist, { recursive: true, withFileTypes: true });
  for (const file of files.filter((entry) => entry.isFile())) {
    const text = await readFile(join(file.parentPath, file.name), 'utf8');
    expect(text.includes('__bench'), `${file.name} mentions __bench`).toBe(false);
    // The seed's word lists come with its generator, so its planted words give it away.
    for (const word of PLANTED) {
      expect(text.includes(word), `${file.name} holds the seed's word ${word}`).toBe(false);
    }
  }

  await page.goto(PRODUCTION_URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => '__bench' in window)).toBe(false);

  await page.goto(BENCH_URL);
  // The bench measures a metric only when its feature is declared, so the list is the app's
  // own account of what it can do. It names the shell, and nothing that isn't built yet.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __bench?: { features: string[] } }).__bench?.features,
      ),
    )
    .toEqual(['shell']);
});
