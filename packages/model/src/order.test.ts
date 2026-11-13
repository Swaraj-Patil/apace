import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { assertValidKey, orderKeyBetween } from './order.ts';

describe('order keys', () => {
  test('the first key is a0', () => {
    expect(orderKeyBetween(null, null)).toBe('a0');
  });

  test('a key always fits strictly between its neighbours', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 300 }), (positions) => {
        const keys: string[] = [];
        for (const position of positions) {
          const at = position % (keys.length + 1);
          const before = keys[at - 1] ?? null;
          const after = keys[at] ?? null;
          const key = orderKeyBetween(before, after);
          assertValidKey(key);
          if (before !== null) expect(before < key).toBe(true);
          if (after !== null) expect(key < after).toBe(true);
          keys.splice(at, 0, key);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('10,000 appends and 10,000 prepends keep keys at four characters or fewer', () => {
    const appended: string[] = [];
    for (let i = 0; i < 10_000; i++) appended.push(orderKeyBetween(appended.at(-1) ?? null, null));
    const prepended: string[] = [];
    for (let i = 0; i < 10_000; i++) prepended.unshift(orderKeyBetween(null, prepended[0] ?? null));

    for (const keys of [appended, prepended]) {
      expect(keys.every((key, i) => i === 0 || (keys[i - 1] ?? '') < key)).toBe(true);
      expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(4);
    }
  });

  test('keys out of order or malformed are refused', () => {
    expect(() => orderKeyBetween('a1', 'a0')).toThrow('does not come before');
    expect(() => orderKeyBetween('a1', 'a1')).toThrow('does not come before');
    expect(() => orderKeyBetween('a10', null)).toThrow('Invalid order key');
    expect(() => orderKeyBetween('a', null)).toThrow('Invalid order key');
    expect(() => orderKeyBetween('a0!', null)).toThrow('Invalid order key');
    expect(() => orderKeyBetween('!0', null)).toThrow('Invalid order key head');
  });
});
