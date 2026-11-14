import {
  checkpoint,
  expectSaved,
  openBench,
  readText,
  reloadBench,
  statusHistory,
  statusLine,
  writeText,
} from './bench.ts';
import { expect, test } from './fixtures.ts';

// On a profile of its own, so the writes have to reach disk rather than a browser the test
// happens to keep alive.
test('writes survive reloads, and a reload gets the workspace back at once', async ({ fresh }) => {
  await openBench(fresh);
  await expectSaved(fresh);
  await writeText(fresh, 'doc-1', 'first');

  for (const more of [', second', ', third']) {
    await reloadBench(fresh);
    await expectSaved(fresh);
    await writeText(fresh, 'doc-1', more);
  }

  await reloadBench(fresh);
  await expectSaved(fresh);
  expect(await readText(fresh, 'doc-1')).toBe('first, second, third');
  expect(await statusHistory(fresh)).not.toContain('open-elsewhere');
});

for (const mode of ['opfs', 'compat'] as const) {
  test(`a second tab waits 1.5 s, then takes over without losing a write (${mode})`, {
    tag: mode === 'opfs' ? ['@smoke'] : [],
  }, async ({ context }) => {
    const query = mode === 'compat' ? '?store=compat' : '';
    const first = await context.newPage();
    await openBench(first, query);
    await expectSaved(first, mode);
    await writeText(first, 'doc-1', 'from the first tab');

    const second = await context.newPage();
    const started = Date.now();
    await openBench(second, query);
    await expect(statusLine(second)).toContainText('Open in another tab');
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);

    await second.getByRole('button', { name: 'Use it here' }).click();
    await expectSaved(second, mode);
    await expect(statusLine(first)).toContainText('Moved to another tab');
    expect(await readText(second, 'doc-1')).toBe('from the first tab');
    await expect(writeText(first, 'doc-1', ' (refused)')).rejects.toThrow(
      'The workspace moved to another tab.',
    );

    await writeText(second, 'doc-1', ', then the second');
    await first.getByRole('button', { name: 'Use it here' }).click();
    await expectSaved(first, mode);
    await expect(statusLine(second)).toContainText('Moved to another tab');
    expect(await readText(first, 'doc-1')).toBe('from the first tab, then the second');
  });
}

test('compatibility mode keeps writes through a snapshot and the log after it', {
  tag: ['@smoke'],
}, async ({ page }) => {
  await openBench(page, '?store=compat');
  await expectSaved(page, 'compat');
  await writeText(page, 'doc-1', 'in the snapshot');
  await checkpoint(page);
  await writeText(page, 'doc-1', ', then in the log');

  await reloadBench(page);
  await expectSaved(page, 'compat');
  expect(await readText(page, 'doc-1')).toBe('in the snapshot, then in the log');
});

test('with no storage at all, the store says it cannot save', async ({ page }) => {
  await openBench(page, '?store=unsaved');
  const status = statusLine(page);
  await expect(status).toHaveText('Not saved: this browser blocks storage');
  await writeText(page, 'doc-1', 'only in memory');
  expect(await readText(page, 'doc-1')).toBe('only in memory');

  await reloadBench(page);
  await expect(status).toHaveText('Not saved: this browser blocks storage');
  expect(await readText(page, 'doc-1')).toBeNull();
});
