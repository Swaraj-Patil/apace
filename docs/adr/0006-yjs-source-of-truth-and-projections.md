# 0006. Yjs is the source of truth; SQLite holds updates and projections rebuilt from them

Status: Accepted, 2026-11-12

## Context

Apace is local-first and will sync between devices and people (Phase 3). Edits made offline on several devices have to merge without conflicts and without losing anything. The views people use, such as the sidebar, search, backlinks and database views, need fast queries over the whole workspace. Neither need should be traded for the other.

## Decision

- **Yjs updates are the only record of what people did.** Every change to a page, the page tree or, later, a database is a Yjs update. Concurrent updates merge the same way on every replica, in any order.
- **SQLite stores the updates** (ADR 0002), plus projections: tables derived from the Yjs state and shaped for queries. Pages, blocks, links and full-text search arrive in step 6.
- **Projections are never edited directly.** Each one is a pure function of Yjs state, so it can always be rebuilt from Yjs alone. Two replicas holding the same updates hold the same projections.
- **Render paths read projections.** Only the pages open in an editor hold a Y.Doc on the main thread, and typing never waits on the worker.
- **This step adds the first projection,** the page tree (`packages/model/src/tree.ts`). It's a pure function from every page's stored placement to the displayed forest (ADR 0007).

## What we gave up

- Storage. The same information lives twice, as updates and as projections.
- Freshness. Projections lag the Yjs state slightly, because they're rebuilt off the main thread, after writes and debounced while typing.
- Migration cost. Changing a projection's shape means a rebuild path, not just a schema migration.
- Direct queries. Yjs state can't be queried; anything a view needs has to be projected first.
- Some size. Yjs keeps metadata for merging, so updates are larger than the plain data.

## How it's verified

- The tree projection depends only on the set of pages, never their order. A fast-check property checks this over 2,000 random inputs (`packages/model/src/tree.test.ts`).
- Replicas that converge to the same Yjs state produce the same projection. This is checked across 1,000 random multi-replica histories (`packages/model/src/tree-ops.test.ts`).
- Step 6 adds a property that incremental projections always equal a full rebuild from Yjs.
