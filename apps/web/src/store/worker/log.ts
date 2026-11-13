// The Yjs update log. Each doc keeps an optional merged snapshot plus the updates written after
// it, so loading a doc is one snapshot read and a short merge.
import type { Database } from '@sqlite.org/sqlite-wasm';
import * as Y from 'yjs';

/** Appends in one transaction of its own, or as part of the caller's. */
export function appendUpdates(db: Database, docId: string, updates: readonly Uint8Array[]): void {
  if (updates.length === 0) return;
  db.savepoint(() => {
    db.exec('INSERT INTO docs (id) VALUES (?) ON CONFLICT (id) DO NOTHING', { bind: [docId] });
    const last = Number(
      db.selectValue('UPDATE docs SET last_seq = last_seq + ? WHERE id = ? RETURNING last_seq', [
        updates.length,
        docId,
      ]),
    );
    const insert = db.prepare('INSERT INTO updates (doc_id, seq, data) VALUES (?, ?, ?)');
    try {
      let seq = last - updates.length;
      for (const update of updates) insert.bind([docId, ++seq, update]).stepReset();
    } finally {
      insert.finalize();
    }
  });
}

/** The doc's snapshot merged with every later update, or null if the doc was never written. */
export function loadDoc(db: Database, docId: string): Uint8Array | null {
  const row = db.selectArray('SELECT snapshot FROM docs WHERE id = ?', [docId]);
  if (row === undefined) return null;
  const parts: Uint8Array[] = [];
  if (row[0] instanceof Uint8Array) parts.push(row[0]);
  for (const [data] of db.selectArrays('SELECT data FROM updates WHERE doc_id = ? ORDER BY seq', [
    docId,
  ])) {
    if (data instanceof Uint8Array) parts.push(data);
  }
  const [only] = parts;
  return parts.length === 1 && only !== undefined ? only : Y.mergeUpdates(parts);
}

/**
 * Folds the doc's updates into its snapshot. Merging keeps deleted content, so a later page
 * history can still reach every past state.
 */
export function compactDoc(db: Database, docId: string): void {
  db.transaction(() => {
    const merged = loadDoc(db, docId);
    if (merged === null) return;
    db.exec('UPDATE docs SET snapshot = ?, snapshot_seq = last_seq WHERE id = ?', {
      bind: [merged, docId],
    });
    db.exec('DELETE FROM updates WHERE doc_id = ?', { bind: [docId] });
  });
}
