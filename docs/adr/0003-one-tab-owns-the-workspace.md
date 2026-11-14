# 0003. One tab owns the workspace

Status: Accepted, 2026-11-12

## Context

The OPFS pool holds exclusive file handles for as long as it's open, so two tabs can't both open the database (ADR 0002). Editing in several tabs at once is out of scope for the first version. A second tab must never corrupt or silently lose data, and people need a plain way to move the workspace to the tab they're using.

## Decision

- The store worker requests the Web Lock `workspace-db` and holds it for its whole life.
- A tab that hasn't got the lock after 1.5 s says "Open in another tab" and offers "Use it here". Its request stays in the queue, so closing the other tab hands the workspace over without a click.
- "Use it here" cancels the queued request and asks for the lock with `steal: true`.
- The tab that loses the lock sees its lock request reject with an AbortError. It then:
  - says "Moved to another tab", and new calls fail with "The workspace moved to another tab.";
  - lets operations already running finish;
  - closes the database and pauses the pool, which releases the handles but keeps the files;
  - says "released" on a BroadcastChannel.
- The new owner retries claiming the handles for up to 3 s. In compatibility mode it first waits up to 3 s for the "released" message, because nothing else stops two tabs writing IndexedDB at the same time.
- The OPFS pool is opened with its own logging off. A handoff is expected to find the handles busy until the other tab lets them go, and the pool prints every such failure to the console as well as throwing it. The throw is what this worker acts on: it either retries or puts the reason in the status line, so the console stays for problems nobody planned for.
- Either tab can take the workspace back the same way.
- A page stops its worker on `pagehide`, so a reload reclaims the workspace at once. A page restored from the back-forward cache reloads.

## What we gave up

- Two tabs can't edit at the same time.
- A second tab waits 1.5 s before explaining itself.
- Writes sent to a tab that just lost the workspace are refused, not forwarded. The caller retries where the workspace now lives.
- In compatibility mode, a takeover can wait up to 3 s if the previous owner closed without saying goodbye.

## How it's verified

End-to-end tests in `apps/web/e2e/store.spec.ts`, run in both OPFS and compatibility modes:

- A second tab shows "Open in another tab" only after at least 1.5 s.
- "Use it here" moves the workspace, and the first tab reports the move and refuses writes.
- No write is lost across the handoff, and the first tab can take the workspace back.
- Reloads never show "Open in another tab".
- The suite fails any test on a console error, so a handoff that started logging one would fail these.

These passed 5 repeated runs without a failure when introduced.
