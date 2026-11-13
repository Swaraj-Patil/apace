# Apace Phase 1 plan: the editor and pages

Status: Approved on 2026-11-12. Design direction: Workbench, with page body text at 16/26.

Branch: `phase-1`, from `main`.

## Goal

Apace as a working, demoable local-first app:

- Nested pages in a sidebar tree with drag, favorites and trash.
- A block editor with every Phase 1 block type, a slash menu, Markdown shortcuts, block handles, multi-block selection and indent.
- Page mentions and backlinks, plus icons, covers and full width.
- A command bar with quick search, split view, a sync indicator, and offline start.

Every Phase 1 budget is measured on every push, and the phase gate passes on CI before the merge.

## Budgets this phase gates

All of these live in `bench/budgets.json` with phase 1. A latency passes when it is under its budget. Scrolling passes at or under one refresh period.

| Metric | Budget | Measured from → to | Samples | First measured |
|---|---|---|---|---|
| `cold-start` | < 1,500 ms p95 | Navigation start → first painted frame of the interactive shell | 10 reloads | Step 7 |
| `page-open.typical` | < 100 ms p95 | Click or Enter on a sidebar row → painted content | 60 pages, one open each | Step 10 |
| `page-open.large` | < 100 ms p95 | The same, for the 3,000-block page | 20 opens | Step 10 |
| `page-editable.large` | < 200 ms p95 | The same click or Enter → end of the painted frame in which the editor holds the whole 3,000-block page and handles input itself | 20 opens | Step 10 |
| `keystroke.typical` | < 16 ms p95 | Key event → end of the frame that paints it, idle wait excluded | 200 keys | Step 10 |
| `keystroke.large` | < 16 ms p95 | The same, at the top, middle and end of the 3,000-block page | 300 keys | Step 10 |
| `scroll` | p95 ≤ one refresh period (16.7 ms at 60 Hz), worst view | Synthesized scroll gesture; frame intervals snapped to whole periods | 5 s per view | Step 10 (page); 13 (sidebar); 14 (trash); 18 (backlinks); 20 (command bar) |
| `quick-search` | < 50 ms p95 | Input event → painted ranked results | 10 queries, typed key by key | Step 20 |
| `keystroke.split`, `page-open.split` | < 16 ms, < 100 ms p95 | The same measurements with two panes open | As above | Step 21 |

Phase 2's budgets also go into `budgets.json` in step 7, tagged phase 2, so the file holds every budget from the start. Those are filtering, sorting and grouping the 50,000-row database in under 100 ms, and scrolling its views. The Phase 1 gate doesn't require them.

### How the numbers are taken

ADR 0010 holds the full method.

- **Percentiles** are nearest-rank. Each metric's warm-up samples are dropped and counted in the report.
- **Keystroke.** The span runs from the key event's `timeStamp` to the end of the frame that paints the change, where a MessageChannel message posted from `requestAnimationFrame` marks the end. From the key handler until that frame, the probe keeps a chain of MessageChannel messages going. A gap in the chain means other work ran, such as React, timers or the Yjs binding, and that work counts. The chain spinning on its own is idle time and doesn't count. If the typed change isn't in the DOM by that frame, the probe follows it to the frame that has it. Without cross-origin isolation the timer resolution is 0.1 ms, which is fine for a 16 ms budget.
- **Page open and quick search.** App code calls `performance.measure` from the triggering event's `timeStamp` to the end of the painted frame. Each page-open sample is that page's first open since app caches were dropped. A search sample ends when the results for that exact query are painted. A sample that never completes fails the run; samples are never dropped.
- **Page editable.** It starts at the same event and ends at the first painted frame in which the editor holds the whole page and a key would reach it directly, not a replay queue. When the editor paints the page itself, this equals page open.
- **Scrolling.** `Input.synthesizeScrollGesture` runs through each declared view. The intervals between `requestAnimationFrame` timestamps are snapped to whole refresh periods, and the worst view's p95 is the metric.
- **Cold start.** From navigation start to the painted frame where the shell is interactive: the sidebar is painted from projections, the store accepts writes, the command bar shortcut is live, and the restored page's content is painted. The bench restores the 3,000-block page, as the worst case, and measures 10 reloads after one unmeasured load.
- **Runs.** The Playwright library drives Chromium in new headless mode (channel `chromium`) with a persistent profile in `bench/.profile`. The viewport is 1536 × 864 at a device scale factor of 1.25, and the CPU throttle comes from `budgets.json` through CDP. Scenarios that edit a page restore their fixture first, so runs stay comparable.

Every bench run measures all declared metrics. A step's **Activates** line names the metrics it adds and the ones it's most likely to move.

## Steps

- [x] 1. Workspace and toolchain
- [x] 2. Store worker
- [x] 3. Model: the workspace tree
- [x] 4. Model: blocks and page documents
- [x] 5. Seed generator
- [x] 6. Seed import and projections
- [ ] 7. Bench harness
- [ ] 8. End-to-end smoke suite
- [ ] 9. CI
- [ ] 10. Spike: the 3,000-block page in TipTap with Yjs
- [ ] 11. Editor foundation
- [ ] 12. Design tokens and app shell
- [ ] 13. Sidebar: tree, keyboard and page open
- [ ] 14. Sidebar: move, favorites and trash
- [ ] 15. Rich blocks
- [ ] 16. Slash menu and Markdown shortcuts
- [ ] 17. Block handles, multi-block selection and indent
- [ ] 18. Mentions, backlinks and sub-pages
- [ ] 19. Page icons, covers and full width
- [ ] 20. Command bar and quick search
- [ ] 21. Split view
- [ ] 22. Installable app and offline start
- [ ] 23. Benchmarks page, README and the Phase 1 gate

Steps 1 to 9 are the scaffold. Step 10 is the riskiest spike, scheduled as soon as the scaffold can measure it. Step 12 onward builds the interface in the Workbench direction.

## Step details

### 1. Workspace and toolchain

**Builds**

- Root files:
  - `package.json`: private, `packageManager: pnpm@11.4.0`, Node `>=24 <25`.
  - `pnpm-workspace.yaml`: `apps/web`, `packages/*` and `bench`.
  - `.node-version`.
  - `tsconfig.base.json` for TypeScript 6.0.3: `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`.
  - `biome.json`, a root Vitest config with one project per package, and a full `.gitignore`.
- `apps/web`: Vite 8, React 19.3 and `@vitejs/plugin-react` 6, rendering an unstyled shell. A `bench` build mode exists from the start. It compiles in `src/bench/`, which step 7 fills.
- `packages/model` and `packages/seed` export `src/index.ts` directly. Vite and Node both read the TypeScript source, so there's no package build step.
- `bench/` is a workspace package. `bench/smoke.ts` imports `@apace/seed` to prove that Node 24 runs TypeScript across workspace links without a build.
- The packages are `@apace/web`, `@apace/model`, `@apace/seed` and `@apace/bench`. The display name, Apace, lives in one `APP_NAME` constant.
- The Playwright test runner with retries at 0, and a small static server for production builds that sends no COOP or COEP headers.
- The `dev`, `build`, `check`, `test` and `e2e` scripts.
- `docs/dependencies.md`, with one sentence per dependency.

**Tests**

- e2e: the production build boots and paints the shell with no console errors. No response carries a COOP or COEP header, and `crossOriginIsolated` is false.
- unit: runs `node bench/smoke.ts` as a child process and checks its output. This pins the decision that Node runs the bench scripts directly.
- `pnpm check` is clean in every package.

**Activates:** none.

**ADR:** 0001 Toolchain and workspace layout.

**Done when:** a fresh clone passes `pnpm install`, `pnpm check`, `pnpm test` and `pnpm e2e`, and `pnpm dev` serves the shell.

**Deviation:** `playwright`, the library, moves to step 7, where the bench runner first uses it; this step needs only `@playwright/test`. Biome is pinned at 2.6.6 rather than 2.6.7. Version 2.6.7 was 23 hours old, inside pnpm's one-day release-age guard, and pnpm quietly exempted it. Instead of keeping the exemption, `pnpm-workspace.yaml` now sets the guard explicitly and makes it strict.

### 2. Store worker

**Builds** (`apps/web/src/store/`)

- `rpc.ts`, the typed RPC. Calls carry ids and transfer lists, errors cross with their name, message and stack, and the worker emits typed events.
- `worker.ts`:
  - Loads `@sqlite.org/sqlite-wasm` 3.54.1-build1 and installs opfs-sahpool.
  - Opens `workspace.db` and migrates it by `PRAGMA user_version`. Schema v1 holds `docs` (snapshot and snapshot sequence) and `updates` (doc, sequence and bytes).
- The API:
  - `status` events, `takeOver()` and `close()`.
  - `appendUpdates(docId, updates)`.
  - `loadDoc(docId)`, which returns the merged state as a transferred buffer.
  - `compact(docId)`.
- The `workspace-db` lock:
  - The worker holds it for its whole life.
  - A second tab waits 1.5 s, reports `open-elsewhere` and offers "Use it here", which steals the lock.
  - The old worker notices the lost lock, closes the database, releases its access handles and reports `moved-away`.
  - The new worker retries opening for up to 3 s.
- Compatibility mode, when `FileSystemSyncAccessHandle` is missing. Handles that are merely busy don't trigger it.
  - SQLite runs in memory. IndexedDB holds the update log, where each batch is stored before it's acknowledged, and periodic serialized snapshots.
  - At startup the store loads the latest snapshot and replays the log.
  - If IndexedDB is missing too, the store reports that it can't save.
- `client.ts` on the main thread:
  - Starts the worker and exposes its status to React through `useSyncExternalStore`.
  - Closes the worker on `pagehide`, so a reload gets the lock back quickly.
  - Shows an unstyled status line until step 12.

**Tests**

- unit:
  - RPC round trips over a `MessageChannel` pair: types, errors, transfers, event order and 1,000 concurrent calls.
  - For the update log, a fast-check property: `loadDoc` after random appends and compactions equals a Y.Doc built from every update.
  - These run in Node if the package's Node build handles our schema. Otherwise they run in Chromium. This step decides which.
- e2e:
  - Writes survive a reload.
  - A second tab says "Open in another tab" only after 1.5 s.
  - "Use it here" moves the workspace, the first tab says it moved, and no write is lost across the handoff.
  - Forced compatibility mode, through a flag that only bench builds read, saves across a reload through IndexedDB.

**Activates:** none.

**ADRs:**

- 0002 Local store in a dedicated worker on opfs-sahpool, without COOP or COEP.
- 0003 One tab owns the workspace.
- 0004 Compatibility mode.
- 0005 Hand-written typed RPC.

**Done when:** tests pass, and persistence, the handoff and compatibility mode are each proven in a real browser.

**Deviation:**
- **Layout:** the worker entry is `apps/web/src/store/worker/index.ts`. The update log, SQLite helpers and IndexedDB code sit beside it and are type-checked against the WebWorker library.
- **API:** the worker gained `open(options)` and `checkpoint()`. `close()` became the client's `shutdown()`, which terminates the worker, because termination is the only close a `pagehide` handler can rely on.
- **Compatibility-mode takeover:** the new owner also waits up to 3 s for the previous owner's "released" message, since nothing else stops two tabs writing IndexedDB at once.
- **Tests:** the handoff e2e test runs in both OPFS and compatibility modes, and another test covers the no-storage mode. The update-log tests run in Node against sqlite-wasm's Node build.

### 3. Model: the workspace tree

**Builds** (`packages/model`)

- Random ids and fractional order keys.
- Placement time is `max(now, highest time seen + 1)`, so a move that follows another always sorts later. Ties break by client id, then page id.
- The workspace doc is a `pages` Y.Map holding one Y.Map per page. Each page's map holds `placement` (`{parent, order, time, client}`), `trashed` (`{at, client}` or null) and `created`.
- Create, move, trash, restore and purge, each one Yjs transaction. A move writes only `placement`.
- The pure tree projection:
  - Orphans go to the top level.
  - Each cycle sends its most recent mover to the top level.
  - Siblings sort by order key, then id.
  - A page is in the trash when it or an ancestor is trashed.
  - Restore puts a page back under its parent if the parent is alive, otherwise at the top level.

**Tests**

- unit: every operation and every repair case:
  - An orphan.
  - 2-page and 3-page cycles, and a cycle through a trashed page.
  - A purged parent with live children, and restore under a purged parent.
  - Equal order keys.
- fast-check:
  - Order keys: `a < between(a, b) < b`, and key length stays bounded across 10,000 appends and prepends.
  - The projection is permutation-invariant and always a forest that holds every live page exactly once.
  - Convergence: 2 to 5 replicas apply random operations, including concurrent moves that form cycles. They exchange updates in random partial orders, then sync fully. Every replica ends with identical Yjs state and an identical projection. 1,000 runs, and a failure prints its seed.
- Projection time for 2,000 and 52,000 pages is recorded for Phase 2's spike. It isn't a budget.

**Activates:** none.

**ADRs:**

- 0006 Yjs is the source of truth, and SQLite holds updates plus projections rebuilt from them.
- 0007 The page tree.

**Done when:** tests pass, including 1,000 convergence runs.

### 4. Model: blocks and page documents

**Builds** (`packages/model/src/blocks/`)

- The block spec, as data:
  - Block types: `title`, `paragraph`, `heading` (levels 1 to 3), `bulleted`, `numbered`, `todo`, `toggle`, `quote`, `callout`, `divider`, `code`, `image` and `embed`.
  - An inline `mention`, and marks for bold, italic, underline, strike, code and link.
  - Every block has an `id` and an `indent`. Blocks form a flat list, and nesting comes from indentation.
  - A page doc is `title block+`. Icon, cover and full width live in the doc's `meta` map.
- The ProseMirror schema, built from that spec. It runs in Node and in the worker.
- Block JSON ⇄ Y.Doc through `@tiptap/y-tiptap`, the binding that TipTap's Collaboration extension uses. Seed, worker and editor share one encoding.
- Projection from a Y.Doc to page meta, block rows (id, order, type, indent, text and attributes), links (block to page) and search text. A second path re-projects only the blocks a Yjs transaction changed.

**Tests**

- unit: every block type and mark validates; hand-written fixtures project as expected.
- fast-check: random block lists pass through block JSON → Y.Doc → projection unchanged; after random edits, the incremental projection equals a full projection.
- The binding and schema import cleanly in Node and in a worker, with no DOM access at module load.

**Activates:** none.

**ADR:** 0008 Flat blocks with indent levels.

**Done when:** tests pass.

**Deviation:**
- **Content in rows:** block rows also carry each block's canonical inline content (text runs with marks, mentions and line breaks), so step 10 can paint a page's first screen straight from the projection.
- **Mark name:** inline code's mark is `inlineCode`, because ProseMirror can't have a node and a mark both named `code`.
- **Incremental API:** `watchPage` emits each transaction's changed rows and removed ids.
- **Worker check:** "imports cleanly in a worker" is proven in a Node worker thread, which has no DOM. The browser's store worker starts using the model in step 6.
- **Peer dependency:** `y-protocols` 1.0.7 came in as y-tiptap's peer. Since step 5 it's pinned in the model package's own dependencies.

### 5. Seed generator

**Builds** (`packages/seed`)

- A deterministic generator driven by a seed number: an sfc32 PRNG, word lists kept in the package, and dates offset from a fixed epoch. Nothing calls `Math.random` or `Date.now`. Each page draws from its own stream, keyed by seed and page index, so one page can be regenerated without the rest.
- The workspace:
  - Exactly 2,000 pages in a realistic tree: about a dozen top-level pages, depth up to 8, skewed fan-out.
  - A median of about 30 blocks per page, in the Phase 1 block mix.
  - Exactly one page with exactly 3,000 blocks, including toggles, code, images, embeds and mentions.
  - Mention hubs, one of them with at least 300 backlinks.
  - 12 favorites and 150 trashed pages. Some pages have icons and covers.
  - Images are small generated local assets. Embeds point at a local fixture URL, so nothing touches the network.
- The databases, generated and tested now but stored from Phase 2, whose spike decides their Yjs layout:
  - Tasks: 50,000 rows with the 15 properties (Title, Status, Priority, Tags, Owner, Due, Estimate, Spent, Done, Link, Contact, the Project relation, the Blocked by self-relation, the Open blockers rollup and the Health formula).
  - Projects: 500 rows.
  - Rollup and formula values come from a plain reference implementation, ready for Phase 2's differential tests.
- Fixtures: `largePage`, `typingPage`, 60 page-open targets spread across depths and sizes, `deepPage`, `hubPage`, search queries with their expected top hit, and the trash and favorites lists.
- Output: a stream of `{docId, kind, update}` records, plus the fixtures and a content hash.

**Tests**

- Determinism: the same seed gives the same hash, and a different seed gives a different one.
- Exact counts: 2,000 pages, 3,000 blocks, 50,000 rows with 15 properties, and 500 projects.
- Integrity: every relation and mention points at something that exists.
- Fixtures are what they claim: the large page really has 3,000 blocks, and so on.
- One page regenerated alone matches its bytes from a full run.
- Generation time is recorded.

**Activates:** none.

**ADR:** 0009 Deterministic seed and bench fixtures.

**Done when:** tests pass.

**Deviation:**
- **Favorites:** they're a fixture list for now. Favorites live in a per-user doc, which step 14 adds, and the seed will write them there.
- **Model additions:** `writeEntries` writes many tree entries in one transaction, and `WORKSPACE_DOC_ID` names the doc that holds the tree.
- **Search fixtures:** each of the 12 planted words, and its four-letter prefix, with its page as the expected top hit: 24 queries.
- **Page icons** are emoji until step 19's picker adds its own glyphs.
- **Generation time** is recorded by `node bench/seed.ts` and in ADR 0009, since tests don't print.

### 6. Seed import and projections

**Builds**

- Store schema v2 adds `pages`, `blocks`, `links`, and an FTS5 `search` table. The table uses unicode61 with diacritics removed and prefix indexes for 2 and 3 characters, and bm25 weights the title above the body.
- The worker's projector:
  - Keeps replicas of the workspace doc and of any page that is receiving updates.
  - Re-projects only what changed, debounced while typing.
  - `rebuildProjections()` rebuilds everything from Yjs alone.
- `importWorkspace(stream)` writes updates and projections in batched transactions. This is how the seed gets in, never through the UI.
- Reads:
  - `getTree()`, in columns, as a transferred buffer.
  - `search(query, limit)` and `backlinks(pageId)`.
  - Subscriptions to tree and page-meta changes.

**Tests**

- fast-check: after random edit sequences, the incremental projections equal a full rebuild from Yjs, row for row.
- unit: FTS returns each fixture query's expected top hit, and the `pages` table equals the projection from `packages/model`.
- e2e: seed 2,000 pages through the bench-build hook, reload, and the counts and a fixture query still match.

**Activates:** none. Import time is recorded.

**ADR:** 0006, updated with the projection tables and the rebuild rule.

**Done when:** tests pass.

**Deviation:**
- **Unprojected updates:** `docs.projected_seq` records how far each doc is projected. Opening the store projects whatever a closed tab, a crash or the upgrade from schema 1 left behind, and a failed projection write recovers the same way.
- **Reads** project whatever is waiting before they run, so they reflect every durable update.
- **Seeding in OPFS:** written page by page into OPFS, the seeded workspace took 12 to 17 s to import. The seed import now builds the database in memory and hands it to the OPFS pool as one file, which takes under 2 s. Compatibility mode imports in memory and writes one snapshot.
- **Bench hooks:** the e2e test needs to seed, so `seed(n)` lands now, running the generator inside the worker. The bench build also gains `counts`, `search` and `retitle`; step 7 adds the rest of `window.__bench`.
- **Extra reads:** `counts()` and `rebuildProjections()`. Tree subscriptions send the whole encoded tree.
- **Layout:** the schema moved to `worker/schema.ts`, and `@apace/web` now depends on `@apace/seed`. Only bench builds import it, and an e2e test checks that production bundles hold none of the seed's words.

### 7. Bench harness

**Builds**

- `bench/budgets.json` holds:
  - Every product budget, each with its phase, feature, statistic, sample count and warm-up count.
  - The CI CPU throttle and the refresh period.
- `apps/web/src/perf/`, used by app code in every build:
  - `measureToPaint(name, startTime, detail)`: `requestAnimationFrame`, then a MessageChannel message, then `performance.measure`.
  - The keystroke probe, the scroll frame sampler and the cold-start mark.
- `apps/web/src/bench/`, in bench builds only: `window.__bench`, with:
  - `features`.
  - `seed(n)`, which runs the generator inside the worker and calls `importWorkspace`.
  - `fixtures`, `openPage`, `revealInSidebar`, `placeCaret`, `restoreFixture`, `dropCaches` and `scrollTargets`.
  - Database actions that throw until Phase 2 declares them.
- `bench/run.ts` (`pnpm bench`):
  - Builds and serves the bench bundle, then launches Chromium as described above.
  - Seeds only when the seed or the generator version changed.
  - Runs declared features only.
  - Writes `bench/results/<sha>.json` and prints the table. `--trace` saves Chrome traces to `bench/traces/`.
- `bench/ab.ts` (`pnpm bench:ab`):
  - Builds main in a git worktree. Both builds are served on fixed ports, so each keeps its own OPFS data.
  - Runs main and the branch interleaved, three times each, and compares medians.
  - A metric fails when it is more than 10% worse and worse by more than main's own spread.
  - Metrics new on the branch are listed as new. If the base has no harness, it says "no baseline" and compares nothing.
  - `--base <ref>` picks another base. Each step compares its uncommitted work with the last commit, and CI compares with the previous commit until main has the harness.
- `bench/gate.ts` (`pnpm gate`) runs check, test, e2e, bench and bench:ab. It then fails if any metric with phase ≤ N is missing or over budget, where N comes from the `phase-N` branch name.
- A budget ratchet test in `pnpm test` compares `bench/budgets.json` with main's copy. It fails if a budget rises, a metric disappears, a sample count drops, a warm-up count grows, or the CI throttle goes down.

**Tests**

- unit: nearest-rank percentiles, refresh-period snapping, A/B verdicts (fast-check over synthetic runs, including the spread rule), and the ratchet against crafted budget files.
- e2e probe calibration, on a bench-only page with synthetic work:
  - A key handler that busy-waits 4, 10 or 20 ms reads back within 1 ms of that plus the frame's own work.
  - A click whose paint is held back 30 ms reads 30 ± 2 ms.
  - A 50 ms stall every 20 frames shows up in the snapped p95.
  - Work queued with `setTimeout` or a MessageChannel task before the frame is counted, not hidden as idle.

**Activates:** `cold-start` (feature `shell`).

**ADRs:**

- 0010 Benchmark method.
- 0011 The A/B rule and the budget ratchet.

**Done when:** all of these hold:

- `pnpm bench` prints and saves `cold-start`.
- The probes are calibrated.
- `pnpm bench:ab` runs.
- `pnpm gate` runs end to end and fails only on the Phase 1 metrics that aren't declared yet.

### 8. End-to-end smoke suite

**Builds**

- Playwright fixtures for a fresh profile and for a seeded persistent profile.
- A guard that fails any test on a console error or an unhandled rejection.
- A store-status helper.
- Smoke specs, tagged `@smoke`:
  - The production build boots.
  - The bench build seeds the workspace and keeps it across a reload.
  - The lock handoff and compatibility mode work.
  - A cross-origin image and iframe load from a fixture server on a second port. This breaks if COOP or COEP ever creeps in.

**Tests:** the specs above. `pnpm e2e --grep @smoke` finishes in under a minute.

**Activates:** none.

**Done when:** tests pass.

### 9. CI

**Builds**

- `.github/workflows/ci.yml` runs on every push and on manual dispatch:
  - `ubuntu-24.04`, pinned. The repository is public, so this is GitHub's standard 4-vCPU runner.
  - Node 24, and pnpm from `packageManager`.
  - The pnpm store and Chromium are cached, with full history for the worktree.
- It runs `pnpm check`, `pnpm test`, `pnpm e2e`, `pnpm bench` and `pnpm bench:ab`. On a phase branch whose plan has every step ticked, it runs `pnpm gate` instead.
- Reports and traces upload as artifacts, and the bench table goes into the job summary.
- Every report records the runner's CPU model and the time of a fixed calibration workload, so a change in runner hardware shows up in the numbers.

**Tests:** the workflow passes on GitHub.

**Activates:** `cold-start` on CI, the first CI baseline.

**ADR:** 0012 The GitHub runner stands in for the mid-range laptop, and the throttle only goes up.

**Done when:** the workflow passes on GitHub for the pushed branch. The step stays unticked until that run is green.

### 10. Spike: the 3,000-block page in TipTap with Yjs

**Question:** can TipTap 3 with Yjs open the seeded 3,000-block page with content painted in under 100 ms p95, make it editable in under 200 ms p95, and keep keystrokes under 16 ms p95, at the CI throttle? If so, which rendering strategy gets there?

**Setup**

- The page loads from the store; the worker merges the state and transfers it.
- The step 4 schema, rendered as plain DOM with no React node views.
- Representative CSS, with real sizes and line heights.
- A temporary unstyled list of fixture pages serves as the click target until the sidebar lands in step 13.
- Measured locally at the calibrated throttle and confirmed on CI.

**Variants**, measured in order. The spike stops at the first variant that meets all three budgets with headroom: p95 open at or under 80 ms, editable at or under 160 ms, and keystroke at or under 12 ms. That leaves room for steps 15 to 18.

- A. A new TipTap editor per open, with Collaboration bound to a fresh Y.Doc.
- B. A, plus `content-visibility: auto` with remembered intrinsic sizes on top-level blocks.
- C. B, plus one long-lived editor whose state is swapped on open. The initial ProseMirror doc is built before the binding attaches, which avoids the binding's deferred first render and its full-document replace.
- D. C, plus first paint from the `blocks` projection:
  - Static DOM for the first viewport.
  - The editor mounts in the next task and replaces it within one frame.
  - Input that arrives before mount is queued and replayed at the mapped caret.

**For each variant**

- A breakdown of worker read and merge, transfer, `applyUpdate`, Y.Doc to ProseMirror, view render, style and layout, and paint, plus the time until the page is editable.
- Keystrokes at the top, middle and end of the page: characters, Enter, and Backspace joining two blocks.
- A Chrome trace of the winning variant.

**Tests**

- e2e: open, type and reload, with the content intact.
- For variant D only: a click that lands before mount still puts the caret where it landed.

**Activates:** `page-open.large`, `page-editable.large`, `page-open.typical`, `keystroke.large`, `keystroke.typical`, and `scroll` on the 3,000-block page.

**Output:** `docs/spikes/large-page.md`, with every variant's numbers. Losing variants are deleted.

**ADR:** 0013 Rendering long pages.

**Done when:** a variant meets all three budgets with that headroom at the CI throttle. If none does, the spike stops with the numbers and the options: a windowed Yjs binding that mounts only the visible blocks, sectioned long pages, or a lighter schema.

### 11. Editor foundation

**Builds:** the winning variant, made permanent.

- The page doc lifecycle:
  - Open, load, bind and edit.
  - Switch pages without losing edits.
  - Flush on `pagehide`, and restore the last page at startup.
- Updates go to the worker fire-and-forget, batched per frame. The worker compacts after a set number of updates.
- Base blocks: paragraph, three heading levels, bulleted, numbered and to-do lists through indent, quote and divider. Marks and title editing.
- Undo and redo through Y.UndoManager, for local changes only.
- A block-id plugin that looks only at changed ranges and fixes duplicate ids after a paste.
- A test that TipTap's generated schema equals the spec in `packages/model`.

**Tests**

- unit: schema equality; block ids stay unique after split, join and paste; numbered-list numbering.
- fast-check: random editor transactions leave the worker's projection equal to a full rebuild.
- e2e: type and reload, with the text persisted; undo and redo; switching pages mid-typing; edits made just before a reload survive.

**Activates:** re-measures `keystroke.*`, `page-open.*` and `page-editable.large`. `cold-start` now includes restoring the last page.

**Done when:** tests pass and every active metric is within budget.

### 12. Design tokens and app shell

This step uses the Workbench direction, with page body text at 16/26.

**Builds**

- Workbench's tokens as CSS custom properties, light and dark. The app follows the system theme, with an override.
- Self-hosted, preloaded fonts.
- The layout regions, the focus ring and the reduced-motion tokens.
- The first in-house icons.
- The sync indicator, with its Phase 1 states and details.
- A skip link and landmarks.

**Tests**

- unit: a contrast test recomputes every pair in `docs/design/directions.md` from the token file and fails below AA.
- e2e:
  - axe, with WCAG 2.1 AA rules, is clean in light, in dark, and with reduced motion forced.
  - Every region is reachable by keyboard, with visible focus.
  - The indicator shows the right words for each state.

**Activates:** re-measures `cold-start` (for the fonts) and `page-open.*`.

**ADR:** 0014 Design direction and tokens.

**Dependencies:** `@fontsource-variable/recursive` 5.3.0, and `@axe-core/playwright` 4.14.0 (dev).

**Done when:** tests pass and everything is within budget.

### 13. Sidebar: tree, keyboard and page open

**Builds**

- A virtualized tree (TanStack Virtual) fed by the worker's tree projection: a snapshot at start, then diffs.
- The ARIA tree pattern, including `aria-level`, `aria-setsize` and `aria-posinset`, which virtualization makes necessary.
- Arrow keys, Home, End, type-ahead and Enter.
- New page, and inline rename.
- Collapse to the icon rail, which stays keyboard-navigable.
- Page open, measured from the click or the Enter.
- `revealInSidebar` and expand-all for the bench.

**Tests**

- unit: flattening with expansion state, and the keyboard reducer.
- e2e: open by click and by keyboard; create; rename; collapse and expand; axe.

**Activates:** `page-open.*` now runs from the real sidebar, and `scroll` adds the sidebar with all 2,000 rows expanded.

**Dependency:** `@tanstack/react-virtual` 3.14.26.

**Done when:** tests pass and everything is within budget.

### 14. Sidebar: move, favorites and trash

**Builds**

- Drag to reorder and re-parent: a drop indicator, auto-expand on hover and auto-scroll. A page can't be dropped into its own descendants.
- Keyboard moves with Alt+Shift+arrow keys.
- Every move writes one placement through the worker, and moves are announced through a live region.
- Favorites in a per-user doc, reorderable.
- A virtualized trash view with restore and delete forever. Restore goes to the original parent, or to the top level.

**Tests**

- unit: drop-target computation.
- e2e: drag reorder, re-parent, keyboard move, favorite, trash, restore and purge, all persisting across a reload.
- fast-check: sequences of UI moves keep the projection a forest.

**Activates:** `scroll` adds the trash view.

**ADR:** 0015 Personal state: favorites per user, view state per device.

**Done when:** tests pass and everything is within budget.

### 15. Rich blocks

**Builds**

- Toggles. Their open state lives on the device, and a closed toggle hides the deeper-indented blocks after it.
- Callouts.
- Code blocks with highlighting:
  - lowlight, with a per-block cache, so only changed blocks are re-highlighted.
  - Common languages are bundled and the rest load on demand.
- Images:
  - Paste, drop or pick.
  - Stored locally by content hash, with alt text.
  - Width and height are kept, so nothing jumps.
- Simple embeds:
  - Allowlisted providers load in sandboxed iframes, and other links become link cards.
  - Offline, an embed shows "This embed needs a connection".
- To-do checkboxes and numbered-list numbering.

**Tests**

- unit: toggle visibility, numbering and the embed allowlist.
- e2e: each block type is created, edited, persisted and operable by keyboard; axe; an image survives an offline reload.

**Activates:** re-measures `keystroke.large` with highlighting live, and `page-open.large`.

**ADR:** 0016 Local assets and embeds before there's a server.

**Dependency:** `lowlight` 3.3.0.

**Done when:** tests pass and everything is within budget.

### 16. Slash menu and Markdown shortcuts

**Builds**

- The slash menu: filtered, with the ARIA combobox and listbox pattern, and keyboard-driven.
- Markdown input rules: `#`, `##`, `###`, `-`, `*`, `1.`, `[]`, `>`, three backticks and `---`, plus marks for bold, italic, code and strike.
- "Turn into".

**Tests**

- unit: each rule produces its block or mark.
- e2e: every block type inserted through the menu and through its shortcut; axe on the menu.

**Activates:** re-measures `keystroke.*`, since input rules run on every key.

**Dependency:** `@tiptap/suggestion` 3.33.0.

**Done when:** tests pass and everything is within budget.

### 17. Block handles, multi-block selection and indent

**Builds**

- One floating handle, shown on hover and on focus. Dragging a block moves its indented children with it.
- Alt+Shift+Up and Alt+Shift+Down move blocks.
- Block selection: Esc selects the current block, Shift+arrow keys extend it, and Shift+click selects a range.
- Delete, duplicate, "Turn into" and indent on a selection.
- Tab and Shift+Tab indent and outdent, as attribute writes.

**Tests**

- unit: the range a block carries with it, and indent limits.
- e2e: drag, keyboard moves, and actions on multi-block selections.
- fast-check: an indent on one replica and a text edit on another converge, with no text lost.

**Activates:** re-measures `keystroke.*` and `page-open.large`.

**Done when:** tests pass and everything is within budget.

### 18. Mentions, backlinks and sub-pages

**Builds**

- `@` opens a page picker backed by the worker's search.
- The mention node shows the target's live title and icon from the projection. When the target is in the trash or deleted, it says so in words.
- The links projection, and a virtualized "Linked from N pages" section with context.
- `/page` creates a child page and inserts a mention to it. The hierarchy itself lives only in the tree.

**Tests**

- unit: the links projection.
- e2e: a new mention shows up as a backlink; renaming the target updates the mention; trashing the target changes the mention's words; all of it works by keyboard alone.

**Activates:** `scroll` adds the hub page's backlinks, and the hub page joins the `page-open.typical` targets.

**ADR:** 0017 Sub-pages live in the tree, not in page content.

**Done when:** tests pass and everything is within budget.

### 19. Page icons, covers and full width

**Builds**

- The icon picker: a monogram by default, the in-house glyphs, or an emoji.
- Covers: a local image or a token pattern.
- The per-page full-width toggle.
- The page header, in Workbench.
- The sub-pages list, derived from the tree.

**Tests**

- e2e: an icon shows in the sidebar and in mentions; a cover persists offline; full width changes the layout; axe.

**Activates:** re-measures `page-open.typical`, which includes pages with covers.

**Done when:** tests pass and everything is within budget.

### 20. Command bar and quick search

**Builds**

- Ctrl+K (Cmd+K on Mac) opens it from anywhere, including inside the editor.
- Jump to a page, with FTS5 ranking: title-weighted bm25 plus recency.
- Actions: new page, theme, collapse sidebar, open in split, move page, trash and favorites.
- Create.
- Virtualized results, the ARIA combobox pattern, and the query time on screen.

**Tests**

- unit: FTS query building and escaping, and ranking fixtures.
- e2e: it opens from anywhere, jumps, runs actions and creates pages; axe.

**Activates:** `quick-search`, and `scroll` adds the results list.

**Done when:** tests pass and everything is within budget.

### 21. Split view

**Builds**

- Two panes that scroll independently.
- Open in split from the sidebar or the command bar with Shift+Enter, or by shortcut.
- F6 moves between panes, and either pane can be closed.
- The same page open in both panes shares one Y.Doc.

**Tests**

- e2e: open a split, type in both panes, and persist; the same page in both panes stays identical; all of it works by keyboard alone.

**Activates:** `keystroke.split` and `page-open.split`.

**Done when:** tests pass and everything is within budget.

### 22. Installable app and offline start

**Builds**

- A web manifest, with in-house icons.
- A hand-written service worker that precaches the build from Vite's manifest. It skips the sqlite-wasm helper files that every build emits but the app never loads: the OPFS async proxy and the Worker1 API, about 250 kB.
- An update prompt in plain words.
- Plain-word messages for anything that needs the network. That's embeds and web images now. Sign-in, share links and the assistant will say so the same way when they arrive.

**Tests**

- e2e: load, go offline, reload, edit, reload offline again, and everything is there; the update flow.

**Activates:** re-measures `cold-start` with the service worker.

**ADR:** 0018 Offline policy and the service worker.

**Done when:** tests pass and everything is within budget.

### 23. Benchmarks page, README and the Phase 1 gate

**Builds**

- The in-app benchmarks page: the latest gate report, bundled at build time, plus this session's own measurements.
- The README: the problem, an architecture diagram, how to run it locally, and the latest numbers.
- A two-minute Phase 1 demo script.
- A review of TypeScript 7 and Vitest 5: what moving would change and what it would cost, for a decision at the gate.

**Tests**

- e2e: the page renders the report as an accessible table, and says so plainly when there is no report yet.

**Activates:** the full Phase 1 gate.

**Done when:** `pnpm gate` passes locally and on CI, and `phase-1` is ready to merge into `main`.

## ADRs this phase writes

| ADR | Decision | Step |
|---|---|---|
| 0001 | Toolchain and workspace layout | 1 |
| 0002 | Local store in a dedicated worker on opfs-sahpool, without COOP or COEP | 2 |
| 0003 | One tab owns the workspace: the lock, the 1.5 s wait, the steal and the 3 s retry | 2 |
| 0004 | Compatibility mode: in-memory SQLite with IndexedDB snapshots and update log | 2 |
| 0005 | Hand-written typed RPC | 2 |
| 0006 | Yjs is the source of truth; SQLite holds updates and rebuildable projections | 3, extended in 6 |
| 0007 | The page tree: one workspace doc, one placement value per move, deterministic repair | 3 |
| 0008 | Flat blocks with indent levels | 4 |
| 0009 | Deterministic seed and bench fixtures | 5 |
| 0010 | Benchmark method | 7 |
| 0011 | The A/B rule and the budget ratchet | 7 |
| 0012 | The GitHub runner as the mid-range laptop, with a throttle that only goes up | 9 |
| 0013 | Rendering long pages | 10 |
| 0014 | Design direction and tokens | 12 |
| 0015 | Personal state: favorites per user, view state per device | 14 |
| 0016 | Local assets and embeds before there's a server | 15 |
| 0017 | Sub-pages live in the tree, not in page content | 18 |
| 0018 | Offline policy and the service worker | 22 |
| 0019 | Hosting on Vercel | Outside the steps, between 6 and 7 |

The remaining decisions get their ADRs in the phases that implement them: rows to Yjs docs in Phase 2, and the change feed and batched first sync in Phase 3.

## Dependencies this phase adds

Every version is exact: the newest in each chosen line on 2026-11-12. pnpm itself is pinned at 11.4.0 through `packageManager`, so CI runs the same pnpm as local development. Each package gets its sentence in `docs/dependencies.md` when it lands, and anything not listed here needs approval before it's added.

| Package | Version | Step |
|---|---|---|
| `vite` | 8.3.8 | 1 |
| `@vitejs/plugin-react` | 6.3.0 | 1 |
| `react`, `react-dom` | 19.3.1 | 1 |
| `typescript` | 6.0.3 | 1 |
| `@types/react`, `@types/react-dom` | 19.3.0 | 1 |
| `@types/node` | 24.19.2 | 1 |
| `vitest` | 4.1.12 | 1 |
| `@playwright/test` | 1.65.0 | 1 |
| `@biomejs/biome` | 2.6.6 | 1 |
| `@sqlite.org/sqlite-wasm` | 3.54.1-build1 | 2 |
| `yjs` | 13.6.33 | 2 |
| `fast-check` | 4.10.2 | 2 |
| `@tiptap/pm`, `@tiptap/y-tiptap` | 3.33.1, 3.3.0 | 4 |
| `y-protocols` | 1.0.7 | 4 |
| `playwright` | 1.65.0 | 7 |
| `@tiptap/core`, `@tiptap/extension-collaboration` | 3.33.1 | 10 |
| `@fontsource-variable/recursive` | 5.3.0 | 12 |
| `@axe-core/playwright` | 4.14.0 | 12 |
| `@tanstack/react-virtual` | 3.14.26 | 13 |
| `lowlight` | 3.3.0 | 15 |
| `@tiptap/suggestion` | 3.33.1 | 16 |

Several pieces are written in-house rather than added as packages: fractional order keys, the PRNG, the static server, the service worker, IndexedDB access and the icons. Each is small and easy to test, so a package wouldn't earn its place.

## Risks

1. **Opening the 3,000-block page.** Building the DOM for 3,000 blocks may cost more than 100 ms on its own. Step 10 measures it first, and variant D sidesteps it.
2. **The Yjs binding on long documents.** The binding defers its first render and replaces the whole document when it re-renders. Remote changes in Phase 3 take the same path. Step 10 measures the first problem, and ADR 0013 records the second for Phase 3.
3. **Plugin cost per keystroke.** Any plugin that walks the whole document on every transaction breaks the 16 ms budget on the large page: placeholders, highlighting, numbering and ids are the usual suspects. Every editor step re-measures `keystroke.large`.
4. **Releasing OPFS handles on reload and on takeover.** The timing is sensitive and adds variance to `cold-start`. Step 2 closes the worker on `pagehide`, and step 7 reports the spread.
5. **Noisy GitHub runners whose hardware changes.** Interleaved runs, medians, the spread rule and recorded CPU models contain the noise. A pinned image keeps the software steady.
6. **Screen readers with a virtualized tree.** Rows that aren't in the DOM need correct set sizes and positions. Step 13 checks this with axe and by hand with VoiceOver.
7. **Short FTS5 prefix queries scale with the vocabulary.** Prefix indexes bound them for now, and the Phase 2 gate re-measures with 50,000 more pages.

## Decisions for this phase

These were settled on 2026-11-12. Each ADR records the reasoning when its decision is implemented.

1. **Name.** The app is Apace. Packages use the `@apace/*` scope, and the display name lives in one `APP_NAME` constant.
2. **Gate scope.** The gate for phase N requires every metric with phase ≤ N, so Phase 1's budgets stay enforced in later phases.
3. **A/B baseline.** `bench:ab --base <ref>` defaults to main.
   - Each step compares its uncommitted work with the last commit, in every phase.
   - CI compares with main once main has the harness, and with the previous commit until then.
   - The gate compares with main, and reports "no baseline" for Phase 1 only.
4. **Editable, not just painted.** "Shows content" means the title and the first viewport of real blocks are painted, even when a static first paint supplies them. `page-editable.large` adds a gated budget of under 200 ms p95 for the 3,000-block page to become editable, so a fast first paint can't hide a slow editor.
5. **Cold start.** The interactive shell means the sidebar is painted from projections, the store accepts writes, the command bar shortcut is live, and the restored page's content is painted. The bench restores the 3,000-block page, as the worst case.
6. **Runner and throttle.** The repository is public, so CI runs on GitHub's standard 4-vCPU Linux runner, pinned to `ubuntu-24.04`. The throttle starts at 1× as the floor. Local runs use a multiplier calibrated against the runner; they're reported and never gate.
7. **Phase 1 scope.** Phase 1 also ships the command bar with quick search, split view for pages, installable offline start, and the benchmarks page. Each is cheap now and expensive to retrofit.
8. **Flat blocks.** Page content is a flat list of blocks with an indent level.
   - Indent and outdent are attribute writes, so concurrent edits are never lost to a subtree move. Yjs has no move operation.
   - Each block is one row, and diffs on a 3,000-block page stay cheap.
   - What it gives up: children are implied by indentation, so a closed toggle hides the deeper-indented blocks after it. Callouts and quotes hold one block of text rather than nested blocks.
9. **Sub-pages.** The hierarchy lives only in the tree. A page lists its sub-pages from the tree, and `/page` creates a child page and inserts a mention to it.
10. **Personal state.** Favorites live in a per-user doc, since they become personal once Phase 3 adds members. Toggle open state and sidebar expansion stay on the device and never sync.
11. **Images and embeds.** Images are stored locally by content hash, in OPFS files, or in IndexedDB in compatibility mode, and they upload in Phase 3. Embeds are limited to an allowlist (YouTube, Vimeo, Loom, Figma, CodePen and Google Maps) in sandboxed iframes, and anything else becomes a link card.
12. **Highlighting.** lowlight, synchronous and per block, with common languages bundled and the rest loaded on demand.
13. **Seed scope.** Phase 1 generates and tests the Tasks and Projects data. Storing it waits for Phase 2's spike, and Phase 2's gate reruns every Phase 1 metric with the full dataset.
14. **Viewport.** 1536 × 864 at a device scale factor of 1.25, a common 15-inch laptop setup.
15. **Versions.** Playwright, React and sqlite-wasm move to their newest lines: 1.65, 19.3 and 3.54.1. TypeScript stays on 6 and Vitest on 4 for Phase 1, and step 23 reviews TypeScript 7 and Vitest 5 for a decision at the gate. pnpm is pinned at 11.4.0.

16. **Design direction.** Workbench, from `docs/design/directions.md`, with page body text at 16/26 instead of 15/24. The interface sizes are unchanged.
