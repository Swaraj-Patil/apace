import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const script = fileURLToPath(new URL('./smoke.ts', import.meta.url));

test('Node runs bench TypeScript across workspace packages with no build step', () => {
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual({
    node: expect.stringMatching(/^24\./),
    app: 'Apace',
    generatorVersion: 1,
  });
});
