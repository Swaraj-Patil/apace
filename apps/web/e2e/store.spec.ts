import { expect, test } from '@playwright/test';
import { checkpoint, openBench, readText, reloadBench, statusHistory, writeText } from './bench.ts';

const SAVED = {
  opfs: 'Saved on this device',
  compat: 'Saved in this browser (compatibility mode)',
} as const;

test('writes survive reloads, and a reload gets the workspace back at once', async ({ page }) => {
  await openBench(page);
  const status = page.getByRole('status');
  await expect(status).toHaveText(SAVED.opfs);
  await writeText(page, 'doc-1', 'first');

  for (const more of [', second', ', third']) {
    await reloadBench(page);
    await expect(status).toHaveText(SAVED.opfs);
    await writeText(page, 'doc-1', more);
  }

  await reloadBench(page);
  await expect(status).toHaveText(SAVED.opfs);
  expect(await readText(page, 'doc-1')).toBe('first, second, third');
  expect(await statusHistory(page)).not.toContain('open-elsewhere');
});

for (const mode of ['opfs', 'compat'] as const) {
  test(`a second tab waits 1.5 s, then takes over without losing a write (${mode})`, async ({
    context,
  }) => {
    const query = mode === 'compat' ? '?store=compat' : '';
    const first = await context.newPage();
    await openBench(first, query);
    await expect(first.getByRole('status')).toHaveText(SAVED[mode]);
    await writeText(first, 'doc-1', 'from the first tab');

    const second = await context.newPage();
    const started = Date.now();
    await openBench(second, query);
    await expect(second.getByRole('status')).toContainText('Open in another tab');
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);

    await second.getByRole('button', { name: 'Use it here' }).click();
    await expect(second.getByRole('status')).toHaveText(SAVED[mode]);
    await expect(first.getByRole('status')).toContainText('Moved to another tab');
    expect(await readText(second, 'doc-1')).toBe('from the first tab');
    await expect(writeText(first, 'doc-1', ' (refused)')).rejects.toThrow(
      'The workspace moved to another tab.',
    );

    await writeText(second, 'doc-1', ', then the second');
    await first.getByRole('button', { name: 'Use it here' }).click();
    await expect(first.getByRole('status')).toHaveText(SAVED[mode]);
    await expect(second.getByRole('status')).toContainText('Moved to another tab');
    expect(await readText(first, 'doc-1')).toBe('from the first tab, then the second');
  });
}

test('compatibility mode keeps writes through a snapshot and the log after it', async ({
  page,
}) => {
  await openBench(page, '?store=compat');
  const status = page.getByRole('status');
  await expect(status).toHaveText(SAVED.compat);
  await writeText(page, 'doc-1', 'in the snapshot');
  await checkpoint(page);
  await writeText(page, 'doc-1', ', then in the log');

  await reloadBench(page);
  await expect(status).toHaveText(SAVED.compat);
  expect(await readText(page, 'doc-1')).toBe('in the snapshot, then in the log');
});

test('with no storage at all, the store says it cannot save', async ({ page }) => {
  await openBench(page, '?store=unsaved');
  const status = page.getByRole('status');
  await expect(status).toHaveText('Not saved: this browser blocks storage');
  await writeText(page, 'doc-1', 'only in memory');
  expect(await readText(page, 'doc-1')).toBe('only in memory');

  await reloadBench(page);
  await expect(status).toHaveText('Not saved: this browser blocks storage');
  expect(await readText(page, 'doc-1')).toBeNull();
});
