import {
  descendantsOf,
  type PageProjection,
  projectPage,
  projectTree,
  purgePage,
  readEntries,
  restorePage,
  type Tree,
  type TreeEnv,
  trashPage,
  WORKSPACE_DOC_ID,
} from '@apace/model';
import {
  planWorkspace,
  type SeedFixtures,
  type SeedRecord,
  seedFixtures,
  seedRecords,
} from '@apace/seed';
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { decodeTree, IN_TRASH, TRASHED } from '../tree-columns.ts';
import { appendUpdates } from './log.ts';
import { dumpProjections, type ProjectionDump, projectionProblems } from './projection-check.ts';
import { createProjector, type Projector } from './projector.ts';
import { migrate, migrateTo } from './schema.ts';
import { exportImage, openImage } from './sqlite.ts';

let sqlite3: Sqlite3Static;
let records: SeedRecord[];
let fixtures: SeedFixtures;
let tree: Tree;
let workspaceUpdate: Uint8Array;
/** The database right after importing the seed, so each test can start from a copy. */
let seededImage: Uint8Array;
/** Each page's projection, straight from packages/model. */
const projections = new Map<string, PageProjection>();
const open: { db: Database; projector: Projector }[] = [];

const env: TreeEnv = { now: () => Date.UTC(2026, 10, 1), newId: () => 'unused' };

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  const plan = planWorkspace(1);
  records = [...seedRecords(plan)];
  fixtures = seedFixtures(plan);
  workspaceUpdate = records[0]?.update ?? new Uint8Array();
  const workspace = new Y.Doc();
  Y.applyUpdate(workspace, workspaceUpdate);
  tree = projectTree(readEntries(workspace));
  for (const record of records.slice(1)) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, record.update);
    projections.set(record.docId, projectPage(doc));
  }
  const { db } = openStore();
  createProjector(db).importWorkspace(records);
  seededImage = exportImage(sqlite3, db);
});

afterAll(() => {
  for (const { db, projector } of open.splice(0)) {
    projector.close();
    db.close();
  }
});

function openStore(): { db: Database; projector: Projector } {
  const db = new sqlite3.oo1.DB(':memory:');
  migrate(db);
  const store = { db, projector: createProjector(db) };
  open.push(store);
  return store;
}

/** A copy of the seeded database, with a projector of its own. */
function seeded(): { db: Database; projector: Projector } {
  const db = openImage(sqlite3, seededImage);
  const store = { db, projector: createProjector(db) };
  open.push(store);
  return store;
}

/** A copy of the seeded page tree. Each edit returns the update it made. */
function treeWriter(): (edit: (doc: Y.Doc) => void) => Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, workspaceUpdate);
  return (edit) => {
    const before = Y.encodeStateVector(doc);
    edit(doc);
    return Y.encodeStateAsUpdate(doc, before);
  };
}

describe('importing the seeded workspace', () => {
  let db: Database;
  let projector: Projector;
  beforeAll(() => {
    ({ db, projector } = seeded());
  });

  test('fills the pages table with exactly the projection packages/model gives', () => {
    const workspace = new Y.Doc();
    Y.applyUpdate(workspace, workspaceUpdate);
    const entries = new Map(readEntries(workspace).map((entry) => [entry.id, entry]));
    const expected = tree.preorder.map((id, preorder) => {
      const node = tree.nodes.get(id);
      const entry = entries.get(id);
      const page = projections.get(id);
      return [
        id,
        node?.parent ?? null,
        node?.order,
        node?.index,
        node?.depth,
        preorder,
        node?.trashed ? 1 : 0,
        entry?.trashed?.at ?? null,
        node?.repair ?? null,
        entry?.created,
        page?.title,
        page?.meta.icon ?? null,
        page?.meta.cover ?? null,
        page?.meta.fullWidth ? 1 : 0,
      ];
    });
    expect(
      db.selectArrays(
        `SELECT id, parent, ord, idx, depth, preorder, trashed, trashed_at, repair, created,
           title, icon, cover, full_width FROM pages ORDER BY preorder`,
      ),
    ).toEqual(expected);
  });

  test('fills the blocks and links tables from each page’s projection', () => {
    const blocks: unknown[][] = [];
    const links: unknown[][] = [];
    for (const [pageId, page] of [...projections].sort(([a], [b]) => (a < b ? -1 : 1))) {
      for (const block of page.blocks) {
        const { id, index, type, indent, attrs, content, text } = block;
        blocks.push([
          pageId,
          id,
          index,
          type,
          indent,
          JSON.stringify(attrs),
          JSON.stringify(content),
          text,
        ]);
        for (const target of block.mentions) links.push([pageId, id, target]);
      }
    }
    expect(
      db.selectArrays(
        'SELECT page_id, id, idx, type, indent, attrs, content, text FROM blocks ORDER BY page_id, idx',
      ),
    ).toEqual(blocks);
    expect(
      db.selectArrays('SELECT source, block, target FROM links ORDER BY source, block, target'),
    ).toEqual(links.sort((a, b) => (a.join() < b.join() ? -1 : 1)));
  });

  test('leaves the tables consistent with each other and with the log', () => {
    expect(projectionProblems(db)).toEqual([]);
  });

  test('finds each fixture query’s expected page as the top hit', () => {
    expect(fixtures.searchQueries.length).toBeGreaterThan(0);
    for (const { query, expected } of fixtures.searchQueries) {
      expect(projector.search(query, 5)[0]?.id, query).toBe(expected);
    }
  });

  test('lists the backlinks of the hub, outside the trash, in title order', () => {
    const sources = new Set<string>();
    for (const [pageId, page] of projections) {
      if (pageId === fixtures.hubPage || tree.nodes.get(pageId)?.trashed) continue;
      if (page.blocks.some((block) => block.mentions.includes(fixtures.hubPage)))
        sources.add(pageId);
    }
    const backlinks = projector.backlinks(fixtures.hubPage);
    expect(backlinks.length).toBeGreaterThanOrEqual(300);
    expect(new Set(backlinks.map((link) => link.id))).toEqual(sources);
    const titles = backlinks.map((link) => link.title.toLowerCase());
    expect(titles).toEqual([...titles].sort());
  });

  test('hands over the tree in display order, parents before children', () => {
    const columns = decodeTree(projector.tree());
    expect(columns.ids).toEqual(tree.preorder);
    for (let row = 0; row < columns.count; row++) {
      const id = columns.ids[row] ?? '';
      const node = tree.nodes.get(id);
      const parent = columns.parents[row] ?? -1;
      expect(parent < row).toBe(true);
      expect(parent === -1 ? null : columns.ids[parent]).toBe(node?.parent ?? null);
      expect(columns.depths[row]).toBe(node?.depth);
      expect(((columns.flags[row] ?? 0) & IN_TRASH) !== 0).toBe(node?.trashed);
      expect(columns.titles[row]).toBe(projections.get(id)?.title);
    }
    const trashed = columns.ids.filter((_, row) => ((columns.flags[row] ?? 0) & TRASHED) !== 0);
    expect(new Set(trashed)).toEqual(new Set(fixtures.trash));
  });

  test('counts what it holds', () => {
    let blocks = 0;
    let links = 0;
    for (const page of projections.values()) {
      blocks += page.blocks.length;
      for (const block of page.blocks) links += block.mentions.length;
    }
    expect(projector.counts()).toEqual({
      pages: 2000,
      trashed: fixtures.trash.length,
      blocks,
      links,
    });
  });
});

describe('the rebuild rule', () => {
  // A full rebuild of 2,000 pages is the slowest thing here, so it runs once, in the hook.
  let imported: ProjectionDump;
  let rebuilt: ProjectionDump;
  let rebuiltProblems: string[];
  beforeAll(() => {
    const { db, projector } = seeded();
    imported = dumpProjections(db);
    projector.rebuild();
    rebuilt = dumpProjections(db);
    rebuiltProblems = projectionProblems(db);
  });

  test('a rebuild from the log alone gives back exactly what the import wrote', () => {
    expect(rebuilt).toEqual(imported);
    expect(rebuiltProblems).toEqual([]);
  });

  test('updates that never got projected are projected on the next open', () => {
    const page = fixtures.typingPage;
    const edits = (projector: Projector) => {
      const doc = new Y.Doc();
      Y.applyUpdate(
        doc,
        records.find((record) => record.docId === page)?.update ?? new Uint8Array(),
      );
      const before = Y.encodeStateVector(doc);
      doc.getMap('meta').set('icon', '🧭');
      projector.append(page, [Y.encodeStateAsUpdate(doc, before)]);
      projector.append(WORKSPACE_DOC_ID, [treeWriter()((tree) => trashPage(tree, page, env))]);
    };

    const crashed = seeded();
    edits(crashed.projector);
    // The tab closes before the debounced projection runs.
    crashed.projector.close();
    expect(projectionProblems(crashed.db)).toEqual(['2 docs not projected']);
    const reopened = createProjector(crashed.db);
    open.push({ db: crashed.db, projector: reopened });
    reopened.recover();
    expect(projectionProblems(crashed.db)).toEqual([]);

    const flushed = seeded();
    edits(flushed.projector);
    flushed.projector.flush();
    expect(dumpProjections(crashed.db)).toEqual(dumpProjections(flushed.db));
    expect(crashed.db.selectArray('SELECT icon, trashed FROM pages WHERE id = ?', [page])).toEqual([
      '🧭',
      1,
    ]);
  });

  test('a workspace saved before the projections existed gets them on its first open', () => {
    const db = new sqlite3.oo1.DB(':memory:');
    migrateTo(db, 1);
    for (const record of records.slice(0, 101)) appendUpdates(db, record.docId, [record.update]);
    migrate(db);
    const projector = createProjector(db);
    open.push({ db, projector });
    projector.recover();
    expect(projectionProblems(db)).toEqual([]);
    expect(projector.counts().pages).toBe(2000);
    const recovered = dumpProjections(db);
    projector.rebuild();
    expect(dumpProjections(db)).toEqual(recovered);
  });
});

describe('the trash', () => {
  test('hides a trashed page from search and backlinks, and a restore brings it back', () => {
    const { projector } = seeded();
    const edit = treeWriter();
    const [{ query, expected }] = fixtures.searchQueries as [SeedFixtures['searchQueries'][0]];
    const source = projector.backlinks(fixtures.hubPage)[0]?.id ?? '';
    projector.append(WORKSPACE_DOC_ID, [
      edit((doc) => {
        trashPage(doc, expected, env);
        trashPage(doc, source, env);
      }),
    ]);
    expect(projector.search(query, 5)).toEqual([]);
    expect(projector.backlinks(fixtures.hubPage).map((link) => link.id)).not.toContain(source);
    // Subpages go to the trash with their parent.
    const newlyTrashed = new Set(
      [expected, source]
        .flatMap((id) => [id, ...descendantsOf(tree, id)])
        .filter((id) => !fixtures.trash.includes(id)),
    );
    expect(projector.counts().trashed).toBe(fixtures.trash.length + newlyTrashed.size);

    projector.append(WORKSPACE_DOC_ID, [edit((doc) => restorePage(doc, expected, env))]);
    expect(projector.search(query, 5)[0]?.id).toBe(expected);
  });

  test('deleting a page for good removes every row it had', () => {
    const { db, projector } = seeded();
    const [gone] = fixtures.trash;
    projector.append(WORKSPACE_DOC_ID, [treeWriter()((doc) => purgePage(doc, gone ?? ''))]);
    projector.flush();
    for (const sql of [
      'SELECT count(*) FROM pages WHERE id = ?',
      'SELECT count(*) FROM blocks WHERE page_id = ?',
      'SELECT count(*) FROM links WHERE source = ?',
    ]) {
      expect(db.selectValue(sql, [gone ?? ''])).toBe(0);
    }
    expect(projectionProblems(db)).toEqual([]);
    expect(projector.counts().pages).toBe(1999);
  });
});
