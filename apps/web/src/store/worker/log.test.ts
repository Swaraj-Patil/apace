import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import fc from 'fast-check';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { appendUpdates, compactDoc, loadDoc } from './log.ts';
import { migrate, SCHEMA_VERSION } from './schema.ts';
import { exportImage, openImage } from './sqlite.ts';

let sqlite3: Sqlite3Static;
const open: Database[] = [];

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function freshDb(): Database {
  const db = new sqlite3.oo1.DB(':memory:');
  open.push(db);
  migrate(db);
  return db;
}

type Op =
  | { readonly kind: 'insert'; readonly at: number; readonly text: string }
  | { readonly kind: 'delete'; readonly at: number; readonly length: number }
  | { readonly kind: 'set'; readonly key: string; readonly value: number };

type Step =
  | { readonly type: 'edit'; readonly doc: string; readonly ops: readonly Op[] }
  | { readonly type: 'compact'; readonly doc: string };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('insert'), at: fc.nat(), text: fc.string({ maxLength: 6 }) }),
  fc.record({ kind: fc.constant('delete'), at: fc.nat(), length: fc.integer({ min: 1, max: 4 }) }),
  fc.record({ kind: fc.constant('set'), key: fc.constantFrom('a', 'b', 'c'), value: fc.integer() }),
);

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({
      type: fc.constant('edit'),
      doc: fc.constantFrom('one', 'two'),
      ops: fc.array(op, { minLength: 1, maxLength: 4 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ type: fc.constant('compact'), doc: fc.constantFrom('one', 'two') }),
  },
);

function apply(doc: Y.Doc, ops: readonly Op[]): void {
  const text = doc.getText('text');
  const map = doc.getMap<number>('map');
  doc.transact(() => {
    for (const o of ops) {
      if (o.kind === 'insert') text.insert(o.at % (text.length + 1), o.text);
      else if (o.kind === 'set') map.set(o.key, o.value);
      else if (text.length > 0) {
        const at = o.at % text.length;
        text.delete(at, Math.min(o.length, text.length - at));
      }
    }
  });
}

describe('update log', () => {
  test('migrate creates the schema once', () => {
    const db = freshDb();
    expect(db.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    migrate(db);
    expect(
      db.selectValues(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'search_%' ORDER BY name",
      ),
    ).toEqual(['blocks', 'docs', 'links', 'pages', 'search', 'updates']);
  });

  test('a database from a newer version is refused, not guessed at', () => {
    const db = new sqlite3.oo1.DB(':memory:');
    open.push(db);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow('saved by a newer version');
  });

  test('a doc that was never written loads as null', () => {
    expect(loadDoc(freshDb(), 'missing')).toBeNull();
  });

  test('any mix of appends and compactions loads back to the same doc', () => {
    fc.assert(
      fc.property(
        fc.array(step, { maxLength: 40 }),
        fc.integer({ min: 1, max: 5 }),
        (steps, batch) => {
          const db = freshDb();
          const writers = new Map<string, Y.Doc>();
          const pending = new Map<string, Uint8Array[]>();
          const flush = (id: string) => appendUpdates(db, id, pending.get(id)?.splice(0) ?? []);

          for (const s of steps) {
            if (s.type === 'compact') {
              flush(s.doc);
              compactDoc(db, s.doc);
              continue;
            }
            let writer = writers.get(s.doc);
            if (writer === undefined) {
              const doc = new Y.Doc();
              const queue: Uint8Array[] = [];
              doc.on('update', (update: Uint8Array) => queue.push(update));
              writers.set(s.doc, doc);
              pending.set(s.doc, queue);
              writer = doc;
            }
            apply(writer, s.ops);
            if ((pending.get(s.doc)?.length ?? 0) >= batch) flush(s.doc);
          }

          for (const [id, writer] of writers) {
            flush(id);
            const state = loadDoc(db, id);
            const loaded = new Y.Doc();
            if (state !== null) Y.applyUpdate(loaded, state);
            expect(loaded.getText('text').toString()).toBe(writer.getText('text').toString());
            expect(loaded.getMap('map').toJSON()).toEqual(writer.getMap('map').toJSON());
            expect(Y.encodeStateVector(loaded)).toEqual(Y.encodeStateVector(writer));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test('a database image round-trips and stays writable', () => {
    const db = freshDb();
    appendUpdates(db, 'one', [Y.encodeStateAsUpdate(new Y.Doc())]);
    const copy = openImage(sqlite3, exportImage(sqlite3, db));
    open.push(copy);
    expect(copy.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    appendUpdates(copy, 'two', [new Uint8Array(4096).fill(7)]);
    expect(copy.selectValues('SELECT id FROM docs ORDER BY id')).toEqual(['one', 'two']);
  });
});
