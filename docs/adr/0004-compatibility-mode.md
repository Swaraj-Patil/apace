# 0004. Compatibility mode

Status: Accepted, 2026-11-12

## Context

Some browsers, and some private windows, have no OPFS synchronous access handles or refuse OPFS outright. Apace has to keep working there and say plainly what's different.

## Decision

- Compatibility mode starts when synchronous access handles are missing, or when OPFS refuses access with `SecurityError` or `NotAllowedError`.
  - SQLite then runs in memory, and IndexedDB keeps it durable.
  - Busy handles never trigger the fallback. They're retried, then reported as a failure, because falling back would hide the real workspace behind an empty one.
- IndexedDB holds two things:
  - An append-only log of update batches. Each batch is committed with strict durability before its write is acknowledged.
  - A snapshot of the whole database image, from `sqlite3_js_db_export`.
- A snapshot is taken every 200 batches and whenever the tab is hidden. One transaction stores the image and deletes exactly the log entries the image contains.
- Startup loads the image with `sqlite3_deserialize`, resizable so it can keep growing, then replays the remaining log in order.
- If IndexedDB can't be used either, the store runs in memory only and says "Not saved: this browser blocks storage".
- The status line says "Saved in this browser (compatibility mode)".
- Bench builds can force a mode with `?store=compat` or `?store=unsaved`, so tests cover the fallbacks in browsers that do support OPFS.

## What we gave up

- Startup time: startup replays the log written since the last snapshot.
- Write cost: every snapshot rewrites the whole database image, which grows with the workspace.
- Memory: the whole database lives in memory.
- Space: IndexedDB's storage quota applies.
- Takeovers rely on the handoff message described in ADR 0003.

## How it's verified

- End-to-end tests in `apps/web/e2e/store.spec.ts`:
  - Compatibility mode survives a reload that needs a snapshot plus later log entries.
  - A takeover in compatibility mode loses no write.
  - The no-storage mode says it can't save, and its data is gone after a reload, as promised.
- A unit test shows a database image round-trips and stays writable after it's loaded.
