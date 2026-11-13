# 0009. Deterministic seed and bench fixtures

Status: Accepted, 2026-11-13

## Context

Every budget is measured against a seeded workspace. A/B runs compare a branch with main, so both must see exactly the same data, on every machine and every run. Otherwise a change in the data reads as a change in speed.

The workspace also has to look like a real one: 2,000 pages in a believable tree, pages of typical length with the full block mix, one very long page, pages that many others mention, and a trash. The bench needs to know where each of these is without searching for it.

The generator runs in three places:

- Node, for tests and scripts;
- the store worker, where the bench will seed through `importWorkspace`;
- Phase 2's database spike, which needs fixed data before it chooses how database rows map to Yjs docs.

So it can use only what browsers, workers and Node all provide: no Node APIs and no DOM.

## Decision

- **One number drives everything.** The generator is sfc32, seeded from a cyrb128 hash of the seed and a path of labels.
  - Each stream discards its first 12 outputs, so similar labels don't start out correlated.
  - Word lists live in the package.
  - Times count from a fixed epoch, 5 January 2026 at 09:00 UTC. The database formula's "today" is fixed at 1 June 2026.
  - Nothing calls `Math.random` or `Date.now`. Yjs picks a random client id for each new doc, so the generator overwrites it with one drawn from the seed.
- **Separate streams.** The tree, each page's size, meta, id and content, and each table draw from their own streams, keyed by seed and index. Changing how one part is generated doesn't shift the others.
- **A cheap plan.** `planWorkspace(seed)` fixes the tree, every page's id, size and meta, and the special pages, in about 3 ms. Any page's content then comes from the plan and that page's own stream, so one page can be regenerated without the rest.
- **The tree.**
  - 12 top-level pages. A chain under the first one reaches depth 8, and its last page is the deep page.
  - Every other page picks its depth first, by weight: 14 for depth 1, then 24, 24, 16, 10, 6, 4 and 2 for depth 8.
  - It then takes a parent one level up. Half the time the parent is drawn in proportion to how many children it already has, which skews the fan-out.
  - For seed 1, that puts 12, 288, 445, 479, 338, 219, 96, 93 and 30 pages at depths 0 to 8. 592 pages have children; the largest families have 79, 53 and 52.
- **Page sizes** are log-normal, with a median of 30 blocks, clamped to 3 to 400. One page has exactly 3,000.
- **Blocks.**
  - The Phase 1 mix, by weight: paragraph 46, heading 10, bulleted 12, numbered 6, todo 7, toggle 4, quote 2, callout 3, divider 2, code 4, image 2, embed 1.
  - Lists come in runs of 2 to 6 items. Each item is at most one level deeper than the item before it, and at most two levels deep.
  - Toggles have 1 to 3 children. A heading's level is 1, 2 or 3.
  - The 3,000-block page leans on what costs most to show. Seed 1 gives it 128 toggles, 186 code blocks, 59 images, 27 embeds, and mentions in 325 blocks.
  - Text is built from the word lists. About 15% of phrases carry a mark.
- **Mentions.** 4% of sentences mention a page (10% on the 3,000-block page), and half of those mention one of 5 hubs.
  - Every fifth page also opens with a paragraph that mentions the main hub. That guarantees the main hub at least 300 backlinks from pages outside the trash. Seed 1 gives it 620 and the other hubs 322 to 346.
  - Mentions point only at pages outside the trash, never at their own page.
- **The trash and favorites.**
  - 150 pages are trashed. All of them are leaves, so the trash list is the whole trash.
  - The 12 favorites are the 5 hubs, the 3,000-block page, the typing page and 5 more pages near the top. They're a fixture list for now. Step 14 adds the per-user doc that stores favorites, and the seed will write them there.
- **Search.**
  - 12 planted words appear in the titles of 12 pages and nowhere else. No other generated word shares their first four letters.
  - The fixtures pair each word, and its four-letter prefix, with its page as the expected top hit: 24 queries.
- **Nothing touches the network.**
  - Images are 20 generated SVGs and 4 SVG covers, each known by a 64-bit hash of its bytes. Step 15 decides how the store addresses assets by content, and the seed will follow it.
  - Embeds point at `http://localhost:4312/embed/<n>.html`, and links at example.com.
  - Page icons are emoji until step 19's picker adds its own glyphs.
- **Output.**
  - `seedRecords(plan)` yields `{ docId, kind, update }` records. The first is the workspace doc, id `workspace`, which holds the page tree. One record per page follows, in plan order.
  - Each update is a doc's whole state, written by the seed's client id.
  - `seedFixtures(plan)` names the special pages:
    - `largePage` and `typingPage` (35 to 45 blocks, one to three levels down);
    - `deepPage` and `hubPage`;
    - 60 page-open targets, starting with the main hub and the deep page. The rest are taken in turn from groups of each depth and size band (under 15 blocks, 15 to 60, over 60). The 3,000-block page has a metric of its own, so it isn't one of them.
    - the search queries, the trash and the favorites.
  - `contentHash` covers every record and asset. It's 64 bits from two 32-bit lanes, enough to see that output changed.
  - `GENERATOR_VERSION` goes up whenever the output changes, so a persisted bench profile gets reseeded.
- **Databases.** These are generated and tested now, and stored from Phase 2.
  - 40 people and 500 projects.
  - 50,000 tasks with 15 properties: Title, Status, Priority, Tags, Owner, Due, Estimate, Spent, Done, Link, Contact, the Project relation, the Blocked by self-relation, the Open blockers rollup and the Health formula.
  - Blocked by only points at earlier tasks, mostly from the same project, so it can never form a cycle.
  - The rollup and the formula come from plain reference functions, which Phase 2's engine must agree with:
    - `openBlockersOf` counts the tasks in Blocked by that aren't done.
    - `healthOf` returns the first of these that holds: Done, Blocked (open blockers), Overdue (due before today), Over budget (spent more than the estimate), and otherwise On track.

## What we gave up

- **Real prose.** Text is recombined from short English word lists, so it has no long words, no other scripts and no realistic word frequencies. Search ranking on real writing may behave differently. The model's property tests cover multi-byte text instead.
- **Data that stays put.** Any change to the generator changes the workspace and its hash, and re-baselines the bench. An A/B run across such a change compares two different workspaces, because each build seeds with its own generator.
- **A model of a tree.** The depth weights and the fan-out rule are a model, not measurements of real workspaces.
- **One writer.** Every seeded doc carries the same Yjs client id, as if one device wrote the whole workspace.
- **A weak hash.** The content hash only detects change. It isn't cryptographic, and two outputs could in principle collide.

## How it's verified

- **Unit tests** in `packages/seed/src` cover:
  - Streams: the same seed and path repeat, a different seed or path differs, ranges hold, and weights and normal draws have the right shape.
  - The workspace:
    - exactly 2,000 pages, in a tree that needs no repairs, with 12 top-level pages, depth up to 8 and a skewed fan-out;
    - a median of 27 to 33 blocks, every block type, and exactly one page over 400 blocks, with exactly 3,000;
    - block ids unique in each page, and no indent more than one step deeper than the block before.
  - Integrity: every mention points at a page outside the trash; every image, cover and embed points at a seeded asset or the local origin; every relation, owner and contact points at a row that exists.
  - Fixtures are what they claim:
    - the hub has the most backlinks, at least 300;
    - the trash list is exactly the trashed pages, and no favorite is trashed;
    - the typing page has 35 to 45 blocks, one to three levels down, and the deep page is at depth 8;
    - the page-open targets cover every depth and size band;
    - each search query matches its expected page and no other.
  - Databases: 50,000 tasks with exactly the 15 properties, 500 projects, every value in its domain, and stored rollup and formula values that match the reference functions, which have tests of their own.
  - Determinism: the same seed gives the same hash, and a different seed a different one, for the workspace and the databases. A page generated alone matches its bytes from a full run. A spy confirms that nothing calls `Math.random` or `Date.now`.
- **Generation time**, measured with `node bench/seed.ts` on an Apple M4 (median of 5). This is a record, not a budget:

  | Step | Time | Output |
  |---|---|---|
  | Plan the workspace | 3.5 ms | 2,000 pages |
  | Generate page updates | 321 ms | 14.2 MB, of which the 3,000-block page is 519 KB |
  | Hash the workspace | 61 ms | |
  | Generate the databases | 98 ms | 50,000 tasks |
  | Hash the databases | 119 ms | |
