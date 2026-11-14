import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBED_PAGES, PLANTED } from '@apace/seed';
import { expectSaved } from './bench.ts';
import { embedPath, IMAGE_PATH } from './embed-origin.ts';
import { expect, test } from './fixtures.ts';
import { BENCH_URL, EMBED_URL, PRODUCTION_URL } from './urls.ts';

const productionDist = fileURLToPath(new URL('../dist/', import.meta.url));

test('the production build paints the shell', { tag: ['@smoke'] }, async ({ page }) => {
  const response = await page.goto(PRODUCTION_URL);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Apace');
  await expect(page.getByRole('heading', { level: 1, name: 'Apace' })).toBeVisible();
});

// The production server applies vercel.json's rewrites and headers, as the deployed site does.
test('the hosted build opens the store at any route', async ({ page }) => {
  const response = await page.goto(`${PRODUCTION_URL}pages/some-page`);
  expect(response?.status()).toBe(200);
  await expectSaved(page);
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

/**
 * The other half of the isolation check, from the browser's side: pictures and embeds come from
 * other origins, and cross-origin isolation would block every one of them. The fixture origin
 * sends no Cross-Origin-Resource-Policy, so this passes only while the app stays un-isolated.
 */
test('a picture and a frame load from another origin', { tag: ['@smoke'] }, async ({ page }) => {
  await page.goto(PRODUCTION_URL);
  const frameUrl = new URL(embedPath(1), EMBED_URL).href;
  const loaded = await page.evaluate(
    async ([picture, frame]) => {
      const settle = (element: HTMLImageElement | HTMLIFrameElement) =>
        new Promise<string>((resolve) => {
          element.addEventListener('load', () => resolve('load'), { once: true });
          element.addEventListener('error', () => resolve('error'), { once: true });
          document.body.append(element);
        });
      const image = Object.assign(document.createElement('img'), { src: picture });
      const embed = Object.assign(document.createElement('iframe'), { src: frame });
      const [pictureEvent, frameEvent] = await Promise.all([settle(image), settle(embed)]);
      return { pictureEvent, frameEvent, width: image.naturalWidth };
    },
    [new URL(IMAGE_PATH, EMBED_URL).href, frameUrl] as const,
  );

  expect(loaded).toEqual({ pictureEvent: 'load', frameEvent: 'load', width: 320 });
  // A blocked frame commits an error page instead, which has no heading of its own.
  await expect(
    page.frameLocator(`iframe[src="${frameUrl}"]`).getByRole('heading', { level: 1 }),
  ).toHaveText('Embed 1');
});

test('the fixture origin serves only the pages the seed points at', async ({ request }) => {
  for (const number of [1, EMBED_PAGES]) {
    expect((await request.get(new URL(embedPath(number), EMBED_URL).href)).status()).toBe(200);
  }
  const missing = await request.get(new URL(embedPath(EMBED_PAGES + 1), EMBED_URL).href);
  expect(missing.status()).toBe(404);
  const picture = await request.get(new URL(IMAGE_PATH, EMBED_URL).href);
  expect(picture.headers()['content-type']).toBe('image/svg+xml');
  // Nothing it sends may claim a resource policy, which is what the app's loads depend on.
  expect(picture.headers()['cross-origin-resource-policy']).toBeUndefined();
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
