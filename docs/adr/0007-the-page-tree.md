# 0007. The page tree

Status: Accepted, 2026-11-12

## Context

Pages nest. People drag them to reorder and re-parent, put them in the trash, restore them, and delete them for good, often offline and on several devices at once. Yjs has no move operation, and nothing in a CRDT can stop two replicas from each moving a page under the other. A tree built from concurrent edits can therefore end up with pages whose parent was deleted, or with cycles. Every replica must repair these the same way, without talking to the others.

## Decision

- **Storage.** The tree lives in one workspace Y.Doc. Its `pages` map holds one Y.Map per page, with three keys:
  - `placement`: one value, `{ parent, order, time, client }`. A move writes only this value, so two concurrent moves of the same page can't mix the parent of one with the order key of the other. One of them wins, by Yjs's map rule, and the same one on every replica.
  - `trashed`: `{ at, client }`, or null.
  - `created`: a time.
- **Order.** Siblings sort by fractional order key, then by page id. Keys are base-62 strings with a variable-length integer part, so keys added at either end grow by about one character per power of 62. 10,000 appends stay at four characters.
  - Two replicas inserting at the same spot get the same key, and the id breaks the tie.
  - Inserting between two siblings that tie re-keys the later one first.
- **Time.** A placement's time is the later of now and one past the latest time in the doc. So a move made after seeing another always counts as more recent, even with a skewed clock.
- **Repairs.** A pure projection repairs the tree, and depends only on the set of pages:
  - A page whose parent no longer exists goes to the top level.
  - Each cycle sends its most recent mover to the top level. "Most recent" means a later time, then a larger client id, then a larger page id. Every page has one parent, so each cycle is found once and broken the same way wherever the search starts.
- **Trash.**
  - A page is in the trash when it or an ancestor is trashed.
  - Restoring puts a page back under its parent if that parent is out of the trash, and at the end of the top level otherwise.
  - Deleting for good works only on pages in the trash, and removes the page and every subpage in one transaction.
  - Moving a page into itself or one of its subpages is refused. Concurrent moves can still form cycles, and the projection repairs those.

## What we gave up

- **Lost moves.** When two people move the same page at once, one move is discarded. Yjs's map rule picks which, not the clock.
- **Surprising repairs.** A cycle repair puts a page at the top level, where nobody put it. Nothing is lost, but the page moves.
- **Clock dependence.** Which page in a cycle counts as most recent depends on device clocks, made monotonic by the rule above but not synchronized.
- **A whole-tree doc.** Reading the tree reads every page's placement. That's cheap at 2,000 pages but heavy at 52,000. The tree will not hold database rows; Phase 2 decides where they go. Measured with `node bench/model-projection.ts` on an Apple M4 (median of 7):

  | Pages | Workspace doc | Load into Yjs | Read entries | Project tree |
  |---|---|---|---|---|
  | 2,000 | 248 KB | 5.6 ms | 0.4 ms | 1.2 ms |
  | 52,000 | 6.8 MB | 151 ms | 4.4 ms | 50 ms |

## How it's verified

- **Unit tests** in `packages/model/src/tree.test.ts` and `tree-ops.test.ts` cover:
  - every operation;
  - an orphan;
  - 2-page, 3-page and self-parented cycles, and a cycle through a trashed page;
  - pages hanging off a cycle;
  - tie-breaking;
  - trash inheritance;
  - a restore under a deleted parent;
  - tied order keys;
  - clocks that run ahead.
- **fast-check properties:**
  - Order keys always fit strictly between their neighbours.
  - Any input projects to a valid forest holding every page once (2,000 runs), whatever its order (2,000 runs).
  - Two to five replicas apply random edits apart, exchange updates in random partial orders, then sync fully. They end with the same state vector, the same content and the same valid tree. This runs 1,000 times. At least 5 of those runs must end needing a cycle repair, and at least 5 an orphan repair; about 25 of each do. A failure prints its seed.
