# 0006. Yjs is the source of truth; SQLite holds updates and projections rebuilt from them

Status: Accepted, 2026-11-12. Updated 2026-11-13 with the projection tables and the rebuild rule.

## Context

Apace is local-first and will sync between devices and people (Phase 3). Edits made offline on several devices have to merge without conflicts and without losing anything. The views people use, such as the sidebar, search, backlinks and database views, need fast queries over the whole workspace. Neither need should be traded for the other.

## Decision

- **Yjs updates are the only record of what people did.** Every change to a page, the page tree or, later, a database is a Yjs update. Concurrent updates merge the same way on every replica, in any order.
- **SQLite stores the updates** (ADR 0002), plus projections: tables derived from the Yjs state and shaped for queries.
- **Projections are never edited directly.** Each one is a pure function of Yjs state, so it can always be rebuilt from Yjs alone. Two replicas holding the same updates hold the same projections.
- **Render paths read projections.** Only the pages open in an editor hold a Y.Doc on the main thread, and typing never waits on the worker.

### The tables

Schema version 2 adds four tables:

- **`pages`**: one row per page in the tree.
  - From the tree projection (ADR 0007): the parent the app shows after repairs, the order key, the position among siblings, the depth, the position in the whole tree (parents before children), whether the page is in the trash itself or through an ancestor, when it was trashed, any repair, and when it was created.
  - From the page's own doc: the title, icon, cover and full-width setting.
  - The row's integer key, `num`, is also the id of the page's search row.
- **`blocks`**: one row per block (ADR 0008). It holds the page, the block id, its position, type and indent, its attributes and inline content as JSON, and its plain text.
- **`links`**: one row for each page mentioned by each block.
- **`search`**: an FTS5 table with one row per page, holding the title and the body (each block's text on its own line).
  - It uses the unicode61 tokenizer with diacritics removed, and prefix indexes for 2 and 3 characters.
  - Text is composed (NFC) before it's indexed or queried, so a decomposed accent can't split a word.
  - bm25 weights a title match 10 to 1 against a body match.

Only pages in the tree have rows. A page's content can arrive before its place in the tree; it gets its rows when the tree gains it. Deleting a page for good deletes its rows.

### The projector

The projector lives in the store worker. Every append goes through it: first to the log, then to the doc's replica.

- **Replicas.**
  - The workspace doc is kept for the worker's life.
  - Each page receiving updates gets a replica, which is dropped after 60 s without updates.
  - A page replica starts from the doc's state before the new updates, so `watchPage` reports exactly what changed. A flush then writes only those blocks and their links, the title and meta if they changed, and the search row if the text changed.
- **The tree** is re-projected in full when its doc changes, about 1.6 ms at 2,000 pages (ADR 0007). The result is compared with the stored rows, and only changed rows are written.
- **Timing.**
  - Tree updates are projected straight after they're appended, so a move shows at once.
  - Page updates wait for 250 ms of quiet, and never more than 2 s.
  - Every read first projects whatever is waiting, so reads always reflect every durable update.
- **Events.**
  - While the main thread watches the tree, the worker sends the whole encoded tree now and after every change: its shape, the trash, or a title or icon.
  - Changes to a page's title, icon, cover or width are sent as `pageMeta` events.

### The rebuild rule

- `docs.projected_seq` records how far each doc's updates have been projected. It's written in the same transaction as the rows. A doc whose `last_seq` is ahead has updates that aren't projected yet.
- **On open,** the projector projects every such doc in full from the log. That covers updates left behind by a tab that closed mid-debounce, by a crash, or by an upgrade.
  - Docs from schema version 1 start at 0, so the first open after the upgrade projects the whole workspace.
- **When a projection write fails,** it rolls back and the in-memory state is dropped. The next flush recovers from the log the same way.
- **`rebuildProjections()`** deletes every projection row and rebuilds them all from the log alone.

### Import

`importWorkspace(records)` replaces the workspace. This is how the seed gets in, never through the UI.

- It clears the log and the tables, then writes each batch of 100 docs, their updates and their projections, in one transaction.
- In OPFS mode, the seed import builds the database in memory and hands it to the OPFS pool as one file. Written page by page into OPFS, the seeded workspace took 12 to 17 s; built in memory, it takes under 2 s. Larger pages, a bigger cache and lighter syncing helped less: the best of them still took 5 s.
- Compatibility mode imports into its in-memory database, then writes one snapshot rather than one log entry per doc.

### Reads

- **`getTree()`** returns every page row in tree order as columns in one buffer, which is transferred, not copied. Ids, titles and icons go as JSON text; parents as row numbers, depths and flags go as typed arrays.
- **`search(query, limit)`.**
  - Each word typed becomes a quoted prefix term, and every word must match. FTS5's own syntax, such as AND, NEAR, quotes and stars, is only ever searched for as text.
  - Pages in the trash are left out.
- **`backlinks(pageId)`** lists the pages outside the trash that mention the page, other than the page itself. They come in title order, each with its mentioning blocks in page order.
- **`counts()`** counts pages, trashed pages, blocks and links.

## What we gave up

- **Storage.** The same information lives twice, as updates and as projections, and block text three times: as plain text, inside the content JSON, and in the search index.
- **Freshness.** A page's rows can lag its updates by up to 2 s, unless something reads them first.
- **Whole-page re-indexing.** A page's search row holds its whole body, so editing any block re-indexes the page. On the 3,000-block page that's about 4 ms of worker time per flush; on a typical page, 0.2 ms.
- **Slow bulk writes in OPFS.** A rebuild, and the first open after an upgrade, write their rows page by page. For the seeded workspace that's likely to take as long as the direct import did, 12 s or more. Only the seed import avoids it so far.
- **Word splitting.** unicode61 doesn't split Chinese, Japanese or Thai into words, so a run of such characters counts as one word and matches only by its start.
- **Migration cost.** Changing a projection's shape means a rebuild path, not just a schema migration.
- **Direct queries.** Yjs state can't be queried; anything a view needs has to be projected first.
- **Some size.** Yjs keeps metadata for merging, so updates are larger than the plain data.

## How it's verified

- **The tree projection** depends only on the set of pages, never their order. A fast-check property checks this over 2,000 random inputs (`packages/model/src/tree.test.ts`). Replicas that converge to the same Yjs state produce the same projection, across 1,000 random multi-replica histories (`packages/model/src/tree-ops.test.ts`).
- **Incremental equals rebuilt** (`apps/web/src/store/worker/projector-properties.test.ts`, fast-check, 300 histories of up to 40 steps).
  - A history mixes:
    - tree edits;
    - whole-page rewrites and keystrokes;
    - meta changes;
    - content sent before its page exists, and updates sent in batches;
    - flushes, reads and dropped replicas;
    - crashes that lose everything in memory.
  - After each history, the tables must equal a rebuild from the log, row for row, and pass every consistency check:
    - FTS5's integrity check;
    - one search row per page;
    - no blocks or links without their page or block;
    - no unprojected docs.
  - At least 50 crashes must happen with unprojected work, 50 sends of content before its page, and 50 dropped replicas. Typical runs see 75 to 105, about 500 and about 170.
  - The property caught a bug before it shipped: an update that changed nothing a projection shows never marked its doc projected.
- **The seeded workspace** (`projector.test.ts`):
  - After an import, the pages table equals the projection from `packages/model`, and the blocks and links tables equal each page's projection.
  - Each of the 24 fixture queries returns its expected top hit.
  - The hub's backlinks are exactly the pages outside the trash that mention it.
  - The tree columns match the tree, and the counts match the projections.
  - A rebuild equals the import. Updates a closed tab never projected are projected on the next open, the same as a normal flush. A schema 1 workspace gets its projections on its first open.
  - Trashing hides a page from search and backlinks, a restore brings it back, and deleting it for good removes all its rows.
- **Search queries** (`fts.test.ts`): prefixes from two letters, title ranking, accents typed either way, FTS5 syntax as text, and other scripts. 500 random strings never break a query.
- **End to end** (`apps/web/e2e/seed.spec.ts`):
  - The 2,000-page workspace is seeded through the bench build's hook, in OPFS and in compatibility mode. After a reload, the counts still match and the first fixture query still finds its page; before the reload, all 24 do.
  - A retitled page is found by its new title at once, and again after a reload.
- **Import time**, measured on an Apple M4:

  | Step | Node, in memory | Chromium, OPFS | Chromium, compatibility mode |
  |---|---|---|---|
  | Generate the seeded workspace | 0.35 s | 0.43 s | 0.44 s |
  | Import it | 1.43 s | 1.8 to 1.9 s | 1.8 to 1.9 s |
  | Rebuild every projection | 1.34 s | not measured | not measured |
