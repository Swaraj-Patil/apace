import { describe, expect, test } from 'vitest';
import { createHasher } from './hash.ts';
import { idFrom, stream } from './random.ts';

const draws = (seed: number, ...path: (string | number)[]) => {
  const random = stream(seed, ...path);
  return Array.from({ length: 8 }, () => random.uint32());
};

describe('stream', () => {
  test('the same seed and path give the same draws', () => {
    expect(draws(1, 'page', 7)).toEqual(draws(1, 'page', 7));
  });

  test('a different seed or path gives different draws', () => {
    const base = draws(1, 'page', 7);
    expect(draws(2, 'page', 7)).not.toEqual(base);
    expect(draws(1, 'page', 8)).not.toEqual(base);
    expect(draws(1, 'meta', 7)).not.toEqual(base);
  });

  test('floats stay in [0, 1) and integers stay in their inclusive range', () => {
    const random = stream(1, 'ranges');
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const float = random.next();
      expect(float).toBeGreaterThanOrEqual(0);
      expect(float).toBeLessThan(1);
      seen.add(random.int(-2, 2));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
  });

  test('weighted choices follow their weights', () => {
    const random = stream(1, 'weights');
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 30_000; i++) {
      counts[
        random.weighted([
          ['a', 1],
          ['b', 2],
          ['c', 0],
        ] as const)
      ]++;
    }
    expect(counts.c).toBe(0);
    expect(counts.b / counts.a).toBeGreaterThan(1.9);
    expect(counts.b / counts.a).toBeLessThan(2.1);
  });

  test('normal draws have the asked-for mean and deviation', () => {
    const random = stream(1, 'normal');
    const values = Array.from({ length: 20_000 }, () => random.normal(10, 2));
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    expect(mean).toBeCloseTo(10, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(2, 1);
  });

  test('picking from nothing throws', () => {
    const random = stream(1, 'empty');
    expect(() => random.pick([])).toThrow('empty');
    expect(() => random.weighted([])).toThrow('empty');
  });

  test('ids use only [0-9A-Za-z]', () => {
    const id = idFrom(stream(1, 'id'), 400);
    expect(id).toMatch(/^[0-9A-Za-z]{400}$/);
    expect(new Set(id).size).toBeGreaterThan(55);
  });
});

describe('hasher', () => {
  const digest = (...parts: string[]) => {
    const hasher = createHasher();
    for (const part of parts) hasher.updateText(part);
    return hasher.digest();
  };

  test('is a pure function of the bytes fed to it', () => {
    expect(digest('apace')).toBe(digest('apace'));
    expect(digest('ap', 'ace')).toBe(digest('apace'));
    expect(digest('apace')).toMatch(/^[0-9a-f]{16}$/);
  });

  test('changes when any byte changes', () => {
    expect(digest('apace')).not.toBe(digest('apacf'));
    expect(digest('apace')).not.toBe(digest('apace '));
    expect(digest('')).not.toBe(digest('\u0000'));
  });
});
