// The Vercel project's Root Directory, set in its dashboard, is apps/web. From there Vercel
// reads vercel.json, resolves the output directory, runs the install and build commands, and
// takes Node's version from the nearest package.json at or above it. These tests read the repo
// the same way, so a config that points Vercel somewhere the build doesn't write fails here
// first.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { describe, expect, test } from 'vitest';
import { hostRules, VERCEL_CONFIG } from './serve.ts';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const ROOT_DIRECTORY = join(REPO, 'apps/web');

const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const vercel = await json(VERCEL_CONFIG);
const manifest = await json(join(REPO, 'package.json'));

/** The package.json Vercel takes Node's version from: the nearest one at or above `dir`. */
function nearestPackageJson(dir: string): string {
  for (let at = dir; ; at = dirname(at)) {
    const candidate = join(at, 'package.json');
    if (existsSync(candidate)) return candidate;
    if (dirname(at) === at) throw new Error(`No package.json at or above ${dir}`);
  }
}

describe('the Vercel project', () => {
  test('reads its one vercel.json from the Root Directory', () => {
    expect(VERCEL_CONFIG).toBe(join(ROOT_DIRECTORY, 'vercel.json'));
    // Vercel would ignore one anywhere else, and it would only mislead.
    expect(existsSync(join(REPO, 'vercel.json'))).toBe(false);
  });

  test('publishes the directory the build writes to', async () => {
    const config = await resolveConfig(
      {
        root: ROOT_DIRECTORY,
        configFile: join(ROOT_DIRECTORY, 'vite.config.ts'),
        logLevel: 'silent',
      },
      'build',
    );
    const written = resolve(config.root, config.build.outDir);
    expect(resolve(ROOT_DIRECTORY, vercel.outputDirectory)).toBe(written);
    expect(vercel.buildCommand).toMatch(/ run build$/);
  });

  test('finds Node 24 where Vercel looks for it, and everywhere else', async () => {
    const nearest = await json(nearestPackageJson(ROOT_DIRECTORY));
    expect(nearest.engines?.node).toBe('24.x');
    expect(manifest.engines.node).toBe('24.x');
    expect((await readFile(join(REPO, '.node-version'), 'utf8')).trim()).toMatch(/^24\./);
  });

  test('refuses to install on any other Node', async () => {
    expect(await readFile(join(REPO, 'pnpm-workspace.yaml'), 'utf8')).toMatch(
      /^engineStrict: true$/m,
    );
  });

  test('installs and builds with the pnpm that package.json pins', () => {
    const commands = [vercel.installCommand, vercel.buildCommand].join('\n');
    const versions = [...commands.matchAll(/pnpm@[\d.]+/g)].map(([found]) => found);
    expect(versions).toEqual([manifest.packageManager, manifest.packageManager]);
    expect(vercel.installCommand).toContain('--frozen-lockfile');
  });

  test('builds with the Vite preset, which is what Vercel detects in the Root Directory', () => {
    expect(vercel.framework).toBe('vite');
  });

  test('never asks for cross-origin isolation', () => {
    const keys = hostRules(vercel).headers.flatMap((rule) => rule.headers.map(([key]) => key));
    expect(keys).not.toContain('cross-origin-opener-policy');
    expect(keys).not.toContain('cross-origin-embedder-policy');
  });
});
