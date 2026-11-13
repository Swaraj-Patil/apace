import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { hostRules, readHostRules, serveStatic } from './serve.ts';

const root = fileURLToPath(new URL('./fixtures/static/', import.meta.url));
let base = '';
let close: () => Promise<void> = async () => {};

beforeAll(async () => {
  const server = await serveStatic(root, 0, await readHostRules());
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((done) => server.close(() => done()));
});
afterAll(() => close());

describe('serveStatic, with the rules in vercel.json', () => {
  test('serves the shell without cross-origin isolation headers', async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(response.headers.get('cross-origin-opener-policy')).toBeNull();
    expect(response.headers.get('cross-origin-embedder-policy')).toBeNull();
    expect(await response.text()).toContain('<title>Fixture</title>');
  });

  test('answers every app route with the shell', async () => {
    for (const route of ['/pages/some-page', '/pages/some.page', '/pages/nested/', '/assets']) {
      const response = await fetch(`${base}${route}`);
      expect(response.status, route).toBe(200);
      expect(await response.text(), route).toContain('<title>Fixture</title>');
    }
  });

  test('caches hashed assets forever', async () => {
    const response = await fetch(`${base}/assets/app-1a2b3c.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  test('answers a missing asset with 404, not the shell', async () => {
    const response = await fetch(`${base}/assets/missing.js`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
  });

  test('refuses paths that escape the root', async () => {
    expect((await fetch(`${base}/%2e%2e%2fserve.test.ts`)).status).toBe(403);
  });

  test('allows only GET and HEAD', async () => {
    const response = await fetch(`${base}/`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('hostRules', () => {
  test('refuses settings it does not implement, rather than ignore them', () => {
    expect(() => hostRules({ cleanUrls: true })).toThrow('"cleanUrls"');
    expect(() => hostRules({ redirects: [] })).toThrow('"redirects"');
    expect(() =>
      hostRules({ rewrites: [{ source: '/(.*)', destination: '/index.html', has: [] }] }),
    ).toThrow('"has" in a rewrite');
    expect(() => hostRules({ rewrites: [{ source: '/:page', destination: '/$1.html' }] })).toThrow(
      'rewrite destination',
    );
    expect(() =>
      hostRules({ rewrites: [{ source: '/', destination: 'https://a.example/' }] }),
    ).toThrow('rewrite destination');
  });
});
