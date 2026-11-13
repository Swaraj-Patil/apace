// vercel.json builds and serves what the rest of the repo expects.
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { hostRules, VERCEL_CONFIG } from './serve.ts';

const read = async (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const vercel = JSON.parse(await readFile(VERCEL_CONFIG, 'utf8'));
const manifest = JSON.parse(await read('../package.json'));

describe('vercel.json', () => {
  test('installs and builds with the pnpm that package.json pins', () => {
    const commands = [vercel.installCommand, vercel.buildCommand].join('\n');
    const versions = [...commands.matchAll(/pnpm@[\d.]+/g)].map(([found]) => found);
    expect(versions).toEqual([manifest.packageManager, manifest.packageManager]);
    expect(vercel.installCommand).toContain('--frozen-lockfile');
  });

  test('builds on Node 24, like everywhere else', async () => {
    expect(manifest.engines.node).toBe('24.x');
    expect((await read('../.node-version')).trim()).toMatch(/^24\./);
  });

  test('publishes the web app build, with no framework preset', () => {
    expect(vercel.framework).toBeNull();
    expect(vercel.outputDirectory).toBe('apps/web/dist');
  });

  test('never asks for cross-origin isolation', () => {
    const keys = hostRules(vercel).headers.flatMap((rule) => rule.headers.map(([key]) => key));
    expect(keys).not.toContain('cross-origin-opener-policy');
    expect(keys).not.toContain('cross-origin-embedder-policy');
  });
});
