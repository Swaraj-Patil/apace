// The workspace database's schema. Version 1 is the Yjs update log. Version 2 adds the
// projections, which are always rebuildable from the log (ADR 0006).
import type { Database } from '@sqlite.org/sqlite-wasm';

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE docs (
     id TEXT PRIMARY KEY,
     snapshot BLOB,
     snapshot_seq INTEGER NOT NULL DEFAULT 0,
     last_seq INTEGER NOT NULL DEFAULT 0
   ) STRICT;
   CREATE TABLE updates (
     doc_id TEXT NOT NULL,
     seq INTEGER NOT NULL,
     data BLOB NOT NULL,
     PRIMARY KEY (doc_id, seq)
   ) STRICT, WITHOUT ROWID;`,
  // A doc's projections reflect its updates up to projected_seq. Docs from version 1 start at
  // 0, so the first open after the upgrade projects every one of them.
  `ALTER TABLE docs ADD COLUMN projected_seq INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE pages (
     num INTEGER PRIMARY KEY,
     id TEXT NOT NULL UNIQUE,
     parent TEXT,
     ord TEXT NOT NULL,
     idx INTEGER NOT NULL,
     depth INTEGER NOT NULL,
     preorder INTEGER NOT NULL,
     trashed INTEGER NOT NULL,
     trashed_at REAL,
     repair TEXT,
     created REAL NOT NULL,
     title TEXT NOT NULL,
     icon TEXT,
     cover TEXT,
     full_width INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX pages_preorder ON pages (preorder);
   CREATE TABLE blocks (
     page_id TEXT NOT NULL,
     id TEXT NOT NULL,
     idx INTEGER NOT NULL,
     type TEXT NOT NULL,
     indent INTEGER NOT NULL,
     attrs TEXT NOT NULL,
     content TEXT NOT NULL,
     text TEXT NOT NULL,
     PRIMARY KEY (page_id, id)
   ) STRICT, WITHOUT ROWID;
   CREATE INDEX blocks_order ON blocks (page_id, idx);
   CREATE TABLE links (
     source TEXT NOT NULL,
     block TEXT NOT NULL,
     target TEXT NOT NULL,
     PRIMARY KEY (source, block, target)
   ) STRICT, WITHOUT ROWID;
   CREATE INDEX links_target ON links (target);
   CREATE VIRTUAL TABLE search USING fts5(
     title,
     body,
     tokenize = 'unicode61 remove_diacritics 2',
     prefix = '2 3'
   );`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Brings the schema up to date, and refuses a database written by a newer version. */
export function migrate(db: Database): void {
  const current = Number(db.selectValue('PRAGMA user_version'));
  if (current > SCHEMA_VERSION) {
    throw new Error(`This workspace was saved by a newer version of the app (schema ${current}).`);
  }
  if (current === SCHEMA_VERSION) return;
  db.transaction(() => {
    for (const sql of MIGRATIONS.slice(current)) db.exec(sql);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

/** Builds the schema exactly as an older version left it. The upgrade tests start from it. */
export function migrateTo(db: Database, version: number): void {
  db.transaction(() => {
    for (const sql of MIGRATIONS.slice(0, version)) db.exec(sql);
    db.exec(`PRAGMA user_version = ${version}`);
  });
}
