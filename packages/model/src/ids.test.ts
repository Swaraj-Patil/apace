import { expect, test } from 'vitest';
import { randomId } from './ids.ts';

test('ids are 16 characters from [0-9A-Za-z], and 10,000 of them never repeat', () => {
  const ids = new Set(Array.from({ length: 10_000 }, () => randomId()));
  expect(ids.size).toBe(10_000);
  for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]{16}$/);
});
