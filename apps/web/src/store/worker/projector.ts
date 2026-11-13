// Keeps the projection tables (pages, blocks, links and the search index) in step with the Yjs
// update log, and answers the reads that render paths make. Every write to the log goes
// through it. It holds a replica of the workspace doc, and of each page that is receiving
// updates, and re-projects only what changed.
//
// A doc's projections reflect its updates up to docs.projected_seq. Anything a crash, an
// upgrade or a failed write left unprojected is found by comparing that with last_seq, and
// projected again from the log.
import {
  type BlockRow,
  type PageChange,
  type PageMeta,
  type PageProjection,
  projectPage,
  projectTree,
  readEntries,
  WORKSPACE_DOC_ID,
  watchPage,
} from '@apace/model';
import type { Database, PreparedStatement, SqlValue } from '@sqlite.org/sqlite-wasm';
import * as Y from 'yjs';
import type { Backlink, PageMetaRow, SearchHit, WorkspaceCounts } from '../api.ts';
import { encodeTree, IN_TRASH, TRASHED, type TreeRow } from '../tree-columns.ts';
import { matchQuery, searchable } from './fts.ts';
import { appendUpdates, loadDoc } from './log.ts';

/** How much a match in a title counts against a match in a page's body. */
export const TITLE_WEIGHT = 10;
export const BODY_WEIGHT = 1;

export interface ImportRecord {
  readonly docId: string;
  readonly update: Uint8Array;
}

export interface ProjectorEvents {
  /** Something the tree shows changed: its shape, the trash, or a title or icon. */
  readonly tree?: () => void;
  /** Pages whose title, icon, cover or width changed. */
  readonly pageMeta?: (pages: readonly PageMetaRow[]) => void;
}

export interface ProjectorOptions {
  readonly events?: ProjectorEvents;
  readonly now?: () => number;
}

export interface Projector {
  /** Writes updates to the log, then to the doc's replica. Their projection waits for flush. */
  append(docId: string, updates: readonly Uint8Array[]): void;
  /** Projects everything appended since the last flush. */
  flush(): void;
  /** Projects whatever reached the log without being projected, such as before a crash. */
  recover(): void;
  /** Throws every projection away and rebuilds it from the log alone. */
  rebuild(): void;
  /** Replaces the whole workspace with these docs, writing them in batched transactions. */
  importWorkspace(records: Iterable<ImportRecord>, batchSize?: number): void;
  /** Drops page replicas that have had no updates for `idleMs` and have nothing to project. */
  dropIdleReplicas(idleMs: number): void;
  // Reads flush first, so they reflect every update appended before them.
  tree(): ArrayBuffer;
  search(query: string, limit: number): SearchHit[];
  backlinks(pageId: string): Backlink[];
  counts(): WorkspaceCounts;
  close(): void;
}

/** A page's place in the tree, as the pages table stores it. */
interface Place {
  readonly parent: string | null;
  readonly ord: string;
  readonly idx: number;
  readonly depth: number;
  readonly preorder: number;
  readonly trashed: number;
  readonly trashedAt: number | null;
  readonly repair: string | null;
  readonly created: number;
}

/** A replica's changes since its last flush. An id is never both upserted and removed. */
interface Pending {
  title: string | undefined;
  meta: PageMeta | undefined;
  readonly upserted: Map<string, BlockRow>;
  readonly removed: Set<string>;
}

interface Replica {
  readonly doc: Y.Doc;
  readonly watcher: { current(): PageProjection; stop(): void };
  readonly pending: Pending;
  /** The stored rows don't match the state this replica started from: rewrite them all. */
  rewrite: boolean;
  /**
   * Updates arrived since the last flush. Some change nothing a projection shows, but the doc
   * still has to be marked projected.
   */
  appended: boolean;
  /** The search body as stored, so a flush can skip re-indexing text that didn't change. */
  body: string;
  lastUpdate: number;
}

const EMPTY_PAGE: PageProjection = {
  title: '',
  meta: { icon: null, cover: null, fullWidth: false },
  blocks: [],
};

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function bodyOf(projection: PageProjection): string {
  return searchable(projection.blocks.map((block) => block.text).join('\n'));
}

function samePlace(a: Place, b: Place): boolean {
  return (
    a.parent === b.parent &&
    a.ord === b.ord &&
    a.idx === b.idx &&
    a.depth === b.depth &&
    a.preorder === b.preorder &&
    a.trashed === b.trashed &&
    a.trashedAt === b.trashedAt &&
    a.repair === b.repair &&
    a.created === b.created
  );
}

function hasWork(replica: Replica): boolean {
  const { pending } = replica;
  return (
    replica.appended ||
    replica.rewrite ||
    pending.title !== undefined ||
    pending.meta !== undefined ||
    pending.upserted.size > 0 ||
    pending.removed.size > 0
  );
}

function clearPending(pending: Pending): void {
  pending.title = undefined;
  pending.meta = undefined;
  pending.upserted.clear();
  pending.removed.clear();
}

function mergeChange(pending: Pending, change: PageChange): void {
  if (change.title !== undefined) pending.title = change.title;
  if (change.meta !== undefined) pending.meta = change.meta;
  for (const row of change.upserted) {
    pending.removed.delete(row.id);
    pending.upserted.set(row.id, row);
  }
  for (const id of change.removed) {
    pending.upserted.delete(id);
    pending.removed.add(id);
  }
}

const text = (value: SqlValue | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

export function createProjector(db: Database, options: ProjectorOptions = {}): Projector {
  const now = options.now ?? (() => performance.now());
  const events = options.events ?? {};
  const statements = new Map<string, PreparedStatement>();
  const replicas = new Map<string, Replica>();
  let workspace: Y.Doc | null = null;
  // What the pages table holds for each page's place, read from it on first use.
  let places: Map<string, Place> | null = null;
  let treePending = false;
  // After a failed write the in-memory state can't be trusted, so the next flush recovers.
  let mustRecover = false;
  // Gathered while writing, and sent once the write commits.
  let treeChanged = false;
  const metaChanged = new Map<string, PageMetaRow>();

  /** The statement for `sql`, prepared once and kept for the projector's life. */
  const prepared = (sql: string): PreparedStatement => {
    let statement = statements.get(sql);
    if (statement === undefined) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };

  const run = (sql: string, bind: SqlValue[]): void => {
    prepared(sql).bind(bind).stepReset();
  };

  /** Runs a statement that returns one value, such as an insert with RETURNING. */
  const runReturning = (sql: string, bind: SqlValue[]): SqlValue => {
    const statement = prepared(sql).bind(bind);
    try {
      statement.step();
      return statement.get(0);
    } finally {
      statement.reset();
    }
  };

  const markProjected = (docId: string) =>
    run('UPDATE docs SET projected_seq = last_seq WHERE id = ?', [docId]);

  const isDirty = (docId: string): boolean =>
    Number(db.selectValue('SELECT last_seq - projected_seq FROM docs WHERE id = ?', [docId]) ?? 0) >
    0;

  const numOf = (pageId: string): number | undefined => {
    const num = db.selectValue('SELECT num FROM pages WHERE id = ?', [pageId]);
    return num === undefined ? undefined : Number(num);
  };

  const storedPlaces = (): Map<string, Place> => {
    places ??= new Map(
      db
        .selectArrays(
          'SELECT id, parent, ord, idx, depth, preorder, trashed, trashed_at, repair, created FROM pages',
        )
        .map((row) => [
          String(row[0]),
          {
            parent: text(row[1]),
            ord: String(row[2]),
            idx: Number(row[3]),
            depth: Number(row[4]),
            preorder: Number(row[5]),
            trashed: Number(row[6]),
            trashedAt: row[7] === null ? null : Number(row[7]),
            repair: text(row[8]),
            created: Number(row[9]),
          },
        ]),
    );
    return places;
  };

  const workspaceDoc = (): Y.Doc => {
    if (workspace === null) {
      workspace = new Y.Doc();
      const state = loadDoc(db, WORKSPACE_DOC_ID);
      if (state !== null) Y.applyUpdate(workspace, state);
    }
    return workspace;
  };

  const projectionFromLog = (pageId: string): PageProjection => {
    const state = loadDoc(db, pageId);
    if (state === null) return EMPTY_PAGE;
    const doc = new Y.Doc({ guid: pageId });
    Y.applyUpdate(doc, state);
    const projection = projectPage(doc);
    doc.destroy();
    return projection;
  };

  const blockValues = (pageId: string, block: BlockRow): SqlValue[] => [
    pageId,
    block.id,
    block.index,
    block.type,
    block.indent,
    JSON.stringify(block.attrs),
    JSON.stringify(block.content),
    block.text,
  ];

  const insertLinks = (pageId: string, block: BlockRow) => {
    for (const target of block.mentions) {
      run('INSERT INTO links (source, block, target) VALUES (?, ?, ?)', [pageId, block.id, target]);
    }
  };

  /** Adds a block's row and links to a page that has none for it. */
  const insertBlock = (pageId: string, block: BlockRow) => {
    run(
      `INSERT INTO blocks (page_id, id, idx, type, indent, attrs, content, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      blockValues(pageId, block),
    );
    insertLinks(pageId, block);
  };

  /** Writes a block's row and links over whatever it had. */
  const writeBlock = (pageId: string, block: BlockRow) => {
    run(
      `INSERT INTO blocks (page_id, id, idx, type, indent, attrs, content, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (page_id, id) DO UPDATE SET idx = excluded.idx, type = excluded.type,
         indent = excluded.indent, attrs = excluded.attrs, content = excluded.content,
         text = excluded.text`,
      blockValues(pageId, block),
    );
    run('DELETE FROM links WHERE source = ? AND block = ?', [pageId, block.id]);
    insertLinks(pageId, block);
  };

  const removeBlock = (pageId: string, blockId: string) => {
    run('DELETE FROM blocks WHERE page_id = ? AND id = ?', [pageId, blockId]);
    run('DELETE FROM links WHERE source = ? AND block = ?', [pageId, blockId]);
  };

  /** Writes the title and meta, noting a change for the events. */
  const writeMeta = (pageId: string, title: string, meta: PageMeta) => {
    const before = db.selectArray('SELECT title, icon, cover, full_width FROM pages WHERE id = ?', [
      pageId,
    ]);
    const row: PageMetaRow = { id: pageId, title, ...meta };
    if (
      before !== undefined &&
      before[0] === title &&
      before[1] === meta.icon &&
      before[2] === meta.cover &&
      Number(before[3]) === Number(meta.fullWidth)
    ) {
      return;
    }
    run('UPDATE pages SET title = ?, icon = ?, cover = ?, full_width = ? WHERE id = ?', [
      title,
      meta.icon,
      meta.cover,
      meta.fullWidth ? 1 : 0,
      pageId,
    ]);
    metaChanged.set(pageId, row);
    if (before === undefined || before[0] !== title || before[1] !== meta.icon) treeChanged = true;
  };

  const writeSearch = (num: number, title: string, body: string) =>
    run('UPDATE search SET title = ?, body = ? WHERE rowid = ?', [searchable(title), body, num]);

  /** Replaces every row the page has with the projection. */
  const writePage = (pageId: string, num: number, projection: PageProjection) => {
    run('DELETE FROM blocks WHERE page_id = ?', [pageId]);
    run('DELETE FROM links WHERE source = ?', [pageId]);
    for (const block of projection.blocks) insertBlock(pageId, block);
    writeMeta(pageId, projection.title, projection.meta);
    writeSearch(num, projection.title, bodyOf(projection));
  };

  /** Gives a page that just joined the tree its rows, from its replica or else from the log. */
  const addPage = (pageId: string, place: Place) => {
    // The page's content may have arrived before its place in the tree did.
    const replica = replicas.get(pageId);
    const projection = replica?.watcher.current() ?? projectionFromLog(pageId);
    const { title, meta } = projection;
    const num = Number(
      runReturning(
        `INSERT INTO pages (id, parent, ord, idx, depth, preorder, trashed, trashed_at, repair,
           created, title, icon, cover, full_width)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING num`,
        [
          pageId,
          place.parent,
          place.ord,
          place.idx,
          place.depth,
          place.preorder,
          place.trashed,
          place.trashedAt,
          place.repair,
          place.created,
          title,
          meta.icon,
          meta.cover,
          meta.fullWidth ? 1 : 0,
        ],
      ),
    );
    const body = bodyOf(projection);
    run('INSERT INTO search (rowid, title, body) VALUES (?, ?, ?)', [num, searchable(title), body]);
    for (const block of projection.blocks) insertBlock(pageId, block);
    if (replica !== undefined) {
      clearPending(replica.pending);
      replica.rewrite = false;
      replica.appended = false;
      replica.body = body;
    }
    markProjected(pageId);
    metaChanged.set(pageId, { id: pageId, title, ...meta });
    treeChanged = true;
  };

  const removePage = (pageId: string) => {
    const num = numOf(pageId);
    if (num !== undefined) run('DELETE FROM search WHERE rowid = ?', [num]);
    run('DELETE FROM pages WHERE id = ?', [pageId]);
    run('DELETE FROM blocks WHERE page_id = ?', [pageId]);
    run('DELETE FROM links WHERE source = ?', [pageId]);
    metaChanged.delete(pageId);
    treeChanged = true;
  };

  const projectWorkspace = () => {
    const entries = readEntries(workspaceDoc());
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const tree = projectTree(entries);
    const before = storedPlaces();
    const after = new Map<string, Place>();
    tree.preorder.forEach((id, preorder) => {
      const node = tree.nodes.get(id);
      const entry = byId.get(id);
      if (node === undefined || entry === undefined) return;
      after.set(id, {
        parent: node.parent,
        ord: node.order,
        idx: node.index,
        depth: node.depth,
        preorder,
        trashed: node.trashed ? 1 : 0,
        trashedAt: entry.trashed === null ? null : finite(entry.trashed.at),
        repair: node.repair,
        created: finite(entry.created),
      });
    });
    for (const id of before.keys()) if (!after.has(id)) removePage(id);
    places = after;
    for (const [id, place] of after) {
      const previous = before.get(id);
      if (previous === undefined) {
        addPage(id, place);
      } else if (!samePlace(previous, place)) {
        run(
          `UPDATE pages SET parent = ?, ord = ?, idx = ?, depth = ?, preorder = ?, trashed = ?,
             trashed_at = ?, repair = ?, created = ? WHERE id = ?`,
          [
            place.parent,
            place.ord,
            place.idx,
            place.depth,
            place.preorder,
            place.trashed,
            place.trashedAt,
            place.repair,
            place.created,
            id,
          ],
        );
        treeChanged = true;
      }
    }
    markProjected(WORKSPACE_DOC_ID);
  };

  const projectReplica = (pageId: string, replica: Replica) => {
    const num = storedPlaces().has(pageId) ? numOf(pageId) : undefined;
    // A page outside the tree has no rows. If it joins the tree, addPage projects it then.
    if (num !== undefined) {
      const projection = replica.watcher.current();
      const { pending } = replica;
      const body = bodyOf(projection);
      if (replica.rewrite) {
        writePage(pageId, num, projection);
      } else {
        for (const blockId of pending.removed) removeBlock(pageId, blockId);
        for (const block of pending.upserted.values()) writeBlock(pageId, block);
        if (pending.title !== undefined || pending.meta !== undefined) {
          writeMeta(pageId, projection.title, projection.meta);
        }
        if (pending.title !== undefined || body !== replica.body) {
          writeSearch(num, projection.title, body);
        }
      }
      replica.body = body;
    }
    clearPending(replica.pending);
    replica.rewrite = false;
    replica.appended = false;
    markProjected(pageId);
  };

  const openReplica = (pageId: string): Replica => {
    const doc = new Y.Doc({ guid: pageId });
    const state = loadDoc(db, pageId);
    if (state !== null) Y.applyUpdate(doc, state);
    const pending: Pending = {
      title: undefined,
      meta: undefined,
      upserted: new Map(),
      removed: new Set(),
    };
    const watcher = watchPage(doc, (change) => mergeChange(pending, change));
    const replica: Replica = {
      doc,
      watcher,
      pending,
      rewrite: isDirty(pageId),
      appended: false,
      body: bodyOf(watcher.current()),
      lastUpdate: now(),
    };
    replicas.set(pageId, replica);
    return replica;
  };

  const forgetReplicas = () => {
    for (const replica of replicas.values()) {
      replica.watcher.stop();
      replica.doc.destroy();
    }
    replicas.clear();
  };

  /** Forgets everything held in memory. The tables and the log are untouched. */
  const forget = () => {
    forgetReplicas();
    workspace?.destroy();
    workspace = null;
    places = null;
    treePending = false;
    treeChanged = false;
    metaChanged.clear();
  };

  const emit = () => {
    if (metaChanged.size > 0) {
      const rows = [...metaChanged.values()];
      metaChanged.clear();
      events.pageMeta?.(rows);
    }
    if (treeChanged) {
      treeChanged = false;
      events.tree?.();
    }
  };

  /**
   * Runs a write, then sends its events. If it fails, it rolls back, and since the in-memory
   * state may no longer match the tables, the next flush recovers from the log instead.
   */
  const write = (work: () => void, { quiet = false } = {}) => {
    try {
      db.savepoint(work);
    } catch (error) {
      forget();
      mustRecover = true;
      throw error;
    }
    if (!quiet) emit();
  };

  const recover = () => {
    mustRecover = false;
    forget();
    const dirty = db.selectValues('SELECT id FROM docs WHERE projected_seq < last_seq').map(String);
    if (dirty.length === 0) return;
    write(() => {
      if (dirty.includes(WORKSPACE_DOC_ID)) projectWorkspace();
      for (const id of dirty) {
        // Pages that just joined the tree were projected as they joined.
        if (id === WORKSPACE_DOC_ID || !isDirty(id)) continue;
        const num = storedPlaces().has(id) ? numOf(id) : undefined;
        if (num !== undefined) writePage(id, num, projectionFromLog(id));
        markProjected(id);
      }
    });
  };

  const flush = () => {
    if (mustRecover) {
      recover();
      return;
    }
    const busy = [...replicas].filter(([, replica]) => hasWork(replica));
    if (!treePending && busy.length === 0) return;
    write(() => {
      if (treePending) projectWorkspace();
      for (const [id, replica] of busy) if (hasWork(replica)) projectReplica(id, replica);
      treePending = false;
    });
  };

  const select = (sql: string, bind: SqlValue[]): SqlValue[][] => {
    flush();
    return db.selectArrays(sql, bind);
  };

  return {
    append(docId, updates) {
      if (updates.length === 0) return;
      // The replica starts from the state before these updates, so it sees them as changes.
      const replica =
        docId === WORKSPACE_DOC_ID ? undefined : (replicas.get(docId) ?? openReplica(docId));
      const doc = replica?.doc ?? workspaceDoc();
      appendUpdates(db, docId, updates);
      const [only] = updates;
      Y.applyUpdate(
        doc,
        updates.length === 1 && only !== undefined ? only : Y.mergeUpdates([...updates]),
      );
      if (replica === undefined) {
        treePending = true;
      } else {
        replica.appended = true;
        replica.lastUpdate = now();
      }
    },

    flush,
    recover,

    rebuild() {
      forget();
      write(() => {
        db.exec('DELETE FROM pages; DELETE FROM blocks; DELETE FROM links; DELETE FROM search;');
        places = new Map();
        projectWorkspace();
        db.exec('UPDATE docs SET projected_seq = last_seq');
        treeChanged = true;
      });
    },

    importWorkspace(records, batchSize = 100) {
      forget();
      write(
        () => {
          db.exec(`DELETE FROM updates; DELETE FROM docs; DELETE FROM pages; DELETE FROM blocks;
                   DELETE FROM links; DELETE FROM search;`);
          places = new Map();
        },
        { quiet: true },
      );
      const importOne = ({ docId, update }: ImportRecord) => {
        if (docId === WORKSPACE_DOC_ID) {
          // Loaded before the append, so the update is applied once.
          const doc = workspaceDoc();
          appendUpdates(db, docId, [update]);
          Y.applyUpdate(doc, update);
          projectWorkspace();
          return;
        }
        appendUpdates(db, docId, [update]);
        if (storedPlaces().has(docId)) {
          const doc = new Y.Doc({ guid: docId });
          Y.applyUpdate(doc, update);
          writePage(docId, numOf(docId) ?? 0, projectPage(doc));
          doc.destroy();
        }
        markProjected(docId);
      };
      // Events wait for the end, so watchers see the finished workspace once.
      const writeBatch = (batch: readonly ImportRecord[]) =>
        write(
          () => {
            for (const record of batch) importOne(record);
          },
          { quiet: true },
        );
      let batch: ImportRecord[] = [];
      for (const record of records) {
        batch.push(record);
        if (batch.length >= batchSize) {
          writeBatch(batch);
          batch = [];
        }
      }
      writeBatch(batch);
      treeChanged = true;
      emit();
    },

    dropIdleReplicas(idleMs) {
      const cutoff = now() - idleMs;
      for (const [id, replica] of replicas) {
        if (hasWork(replica) || replica.lastUpdate > cutoff) continue;
        replica.watcher.stop();
        replica.doc.destroy();
        replicas.delete(id);
      }
    },

    tree() {
      const rows = select(
        'SELECT id, parent, depth, trashed, trashed_at, title, icon FROM pages ORDER BY preorder',
        [],
      ).map(
        (row): TreeRow => ({
          id: String(row[0]),
          parent: text(row[1]),
          depth: Number(row[2]),
          flags: (Number(row[3]) === 1 ? IN_TRASH : 0) | (row[4] === null ? 0 : TRASHED),
          title: String(row[5]),
          icon: text(row[6]),
        }),
      );
      return encodeTree(rows);
    },

    search(query, limit) {
      const match = matchQuery(query);
      if (match === null || limit <= 0) return [];
      return select(
        `SELECT p.id, p.title, p.icon FROM search JOIN pages p ON p.num = search.rowid
         WHERE search MATCH ? AND p.trashed = 0
         ORDER BY bm25(search, ${TITLE_WEIGHT}, ${BODY_WEIGHT}), p.id
         LIMIT ?`,
        [match, limit],
      ).map((row) => ({ id: String(row[0]), title: String(row[1]), icon: text(row[2]) }));
    },

    backlinks(pageId) {
      const rows = select(
        `SELECT l.source, p.title, p.icon, l.block FROM links l
         JOIN pages p ON p.id = l.source
         JOIN blocks b ON b.page_id = l.source AND b.id = l.block
         WHERE l.target = ? AND l.source <> l.target AND p.trashed = 0
         ORDER BY p.title COLLATE NOCASE, p.id, b.idx`,
        [pageId],
      );
      const backlinks: { id: string; title: string; icon: string | null; blocks: string[] }[] = [];
      for (const [source, title, icon, block] of rows) {
        const last = backlinks.at(-1);
        if (last?.id === String(source)) last.blocks.push(String(block));
        else
          backlinks.push({
            id: String(source),
            title: String(title),
            icon: text(icon),
            blocks: [String(block)],
          });
      }
      return backlinks;
    },

    counts() {
      const [pages, trashed, blocks, links] = select(
        `SELECT (SELECT count(*) FROM pages), (SELECT count(*) FROM pages WHERE trashed = 1),
           (SELECT count(*) FROM blocks), (SELECT count(*) FROM links)`,
        [],
      )[0] ?? [0, 0, 0, 0];
      return {
        pages: Number(pages),
        trashed: Number(trashed),
        blocks: Number(blocks),
        links: Number(links),
      };
    },

    close() {
      forget();
      for (const statement of statements.values()) statement.finalize();
      statements.clear();
    },
  };
}
