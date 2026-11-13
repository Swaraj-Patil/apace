# 0002. Local store in a dedicated worker on opfs-sahpool, without COOP or COEP

Status: Accepted, 2026-11-12

## Context

Apace keeps the whole workspace on the device, and every read and write happens locally. That needs a real database: indexes, transactions and, later, full-text search. SQLite compiled to WebAssembly provides one, persisted in the Origin Private File System (OPFS).

SQLite's browser build offers two OPFS back ends:

- The `opfs` VFS shares memory between threads using SharedArrayBuffer and Atomics. Browsers allow those only on cross-origin-isolated pages, where every response carries `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy`. Isolation breaks things Apace needs:
  - embeds from sites that don't opt in to being embedded that way;
  - cross-origin images that don't send CORP headers;
  - sign-in popups that rely on `window.opener`, such as Google sign-in, which COOP cuts off.
- The `opfs-sahpool` VFS needs no shared memory. It opens a pool of synchronous access handles up front and keeps them. Synchronous access handles exist only in workers.

The main thread must never wait on storage.

## Decision

- SQLite runs in a dedicated module worker (`apps/web/src/store/worker/`) on `opfs-sahpool`. The VFS is named `apace`, it lives in the OPFS directory `.apace`, and the database file is `/workspace.db`.
- No page sends COOP or COEP, and tests assert it.
- The pool is always installed with `preserveOnInitFailure` and `forceReinitIfPreviouslyFailed`.
  - Without the first option, a failed install deletes the pool. A failed install is exactly what happens while another tab still holds a handle, so the default would destroy the workspace.
  - The second option lets the next attempt run instead of returning the cached failure.
- The schema is versioned with `PRAGMA user_version`. Migrations run in one transaction, and a database written by a newer version is refused rather than guessed at.
- Schema v1 is the Yjs update log:
  - `docs` holds each doc's merged snapshot, the sequence it covers and the last sequence.
  - `updates` holds each update's doc, sequence and bytes, clustered by doc and sequence.
- Loading a doc merges its snapshot with the updates after it. Compaction folds updates into the snapshot with `Y.mergeUpdates`, which keeps deleted content, so page history can still reach past states.
- Every storage operation in the worker runs one at a time, in arrival order. A write resolves only after its transaction commits.

## What we gave up

- One connection. Only the worker holding the pool can touch the database, which is why one tab owns the workspace (ADR 0003).
- Direct access to the files. The pool's files are opaque inside OPFS; it can export a database file when one is needed.
- WAL mode, which needs shared memory. Writes use SQLite's rollback journal.
- APIs that need cross-origin isolation, such as SharedArrayBuffer. `performance.now()` stays at 0.1 ms resolution.
- Some size. Keeping full history makes compacted docs larger than garbage-collected ones would be.

## How it's verified

- End-to-end: writes survive reloads (`apps/web/e2e/store.spec.ts`). No response sends COOP or COEP, and `crossOriginIsolated` is false (`apps/web/e2e/shell.spec.ts`).
- Unit tests in Node against the real SQLite build (`apps/web/src/store/worker/log.test.ts`):
  - migrations, and refusal of a newer schema;
  - a fast-check property that any mix of appends and compactions loads back to the same Yjs doc;
  - a database image round trip.
- Production builds open the store in Chromium, and so does the dev server.
