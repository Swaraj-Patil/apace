import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
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

test('bench hooks exist only in bench builds', async ({ page }) => {
  const files = await readdir(productionDist, { recursive: true, withFileTypes: true });
  for (const file of files.filter((entry) => entry.isFile())) {
    const text = await readFile(join(file.parentPath, file.name), 'utf8');
    expect(text.includes('__bench'), `${file.name} mentions __bench`).toBe(false);
  }

  await page.goto(PRODUCTION_URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => '__bench' in window)).toBe(false);

  await page.goto(BENCH_URL);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __bench?: { features: string[] } }).__bench?.features,
      ),
    )
    .toEqual([]);
});
