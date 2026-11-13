import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { matchQuery, searchable } from './fts.ts';
import { migrate } from './schema.ts';

let db: Database;

beforeAll(async () => {
  const sqlite3 = await sqlite3InitModule();
  db = new sqlite3.oo1.DB(':memory:');
  migrate(db);
  const pages: [number, string, string][] = [
    [1, 'Zephyr launch checklist', 'Ship the quarterly roadmap'],
    [2, 'Café notes', 'Résumé of the naïve plan'],
    [3, 'C++ and p95', 'AND OR NOT NEAR "quoted" stars* (parens)'],
    [4, '中文 page', 'emoji 😀 here'],
    [5, 'Roadmap', 'zephyr appears in a body too'],
  ];
  for (const [rowid, title, body] of pages) {
    db.exec('INSERT INTO search (rowid, title, body) VALUES (?, ?, ?)', {
      bind: [rowid, searchable(title), searchable(body)],
    });
  }
});

afterAll(() => db.close());

const hits = (typed: string): number[] => {
  const query = matchQuery(typed);
  if (query === null) return [];
  return db
    .selectValues(
      'SELECT rowid FROM search WHERE search MATCH ? ORDER BY bm25(search, 10.0, 1.0)',
      [query],
    )
    .map(Number);
};

describe('search queries', () => {
  test('match words by prefix, from two letters up, ignoring case', () => {
    expect(hits('ze')).toEqual([1, 5]);
    expect(hits('ZEPH')).toEqual([1, 5]);
    expect(hits('zephyr launch')).toEqual([1]);
  });

  test('rank a title match above a body match', () => {
    expect(hits('roadmap')).toEqual([5, 1]);
  });

  test('ignore accents on either side', () => {
    expect(hits('cafe')).toEqual([2]);
    expect(hits('résumé naive')).toEqual([2]);
    // A decomposed accent, as some keyboards type it.
    expect(hits('café'.normalize('NFD'))).toEqual([2]);
  });

  test('treat FTS5 syntax as plain words', () => {
    expect(hits('AND OR')).toEqual([3]);
    expect(hits('"quoted"')).toEqual([3]);
    expect(hits('stars*')).toEqual([3]);
    expect(hits('(parens')).toEqual([3]);
    expect(hits('p95!')).toEqual([3]);
    expect(hits('NEAR(')).toEqual([3]);
  });

  test('find words in other scripts', () => {
    expect(hits('中文')).toEqual([4]);
  });

  test('have no query when nothing typed is a word', () => {
    expect(matchQuery('')).toBeNull();
    expect(matchQuery('  -- !! 😀 ')).toBeNull();
  });

  test('never let typed text break the query', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 30 }), (typed) => {
        expect(() => hits(typed)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});
