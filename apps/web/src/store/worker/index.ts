// The store worker. While it holds the workspace-db lock it is the only code in the origin
// that touches the workspace's storage. The main thread drives it through rpc.ts.
import type { Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import {
  LOCK_NAME,
  OPEN_ELSEWHERE_AFTER_MS,
  type OpenOptions,
  RELEASE_WAIT_MS,
  type StorageMode,
  type StoreApi,
  type StoreEvents,
  type StoreStatus,
} from '../api.ts';
import { serve, transfer } from '../rpc.ts';
import { type CompatStorage, openCompatStorage } from './compat.ts';
import { appendUpdates, compactDoc, loadDoc, migrate } from './log.ts';
import {
  claimPool,
  exportImage,
  isBusy,
  loadSqlite,
  openImage,
  sahPoolSupported,
} from './sqlite.ts';

/** In compatibility mode, how many logged batches trigger a database snapshot. */
const SNAPSHOT_EVERY = 200;
const DB_FILE = '/workspace.db';

interface Opened {
  readonly db: Database;
  readonly mode: StorageMode;
  readonly compat: CompatStorage | null;
  /** Compatibility mode: log keys already in the database but not yet in a snapshot. */
  readonly unsnapshotted: number[];
}

// After a takeover, the previous owner says on this channel that it has stopped writing.
const handoff = new BroadcastChannel('apace-store-handoff');
// The lock callback awaits this, so the lock is held until the worker ends or it's stolen.
const forever = new Promise<never>(() => {});

let options: OpenOptions = {};
let status: StoreStatus = { state: 'opening' };
let opened: Opened | undefined;
let readiness = waitForReady();
let pool: SAHPoolUtil | undefined;
let holdingLock = false;
let cancelQueuedRequest: (() => void) | undefined;
let queue: Promise<unknown> = Promise.resolve();

const server = serve<StoreApi, StoreEvents>(self as unknown as DedicatedWorkerGlobalScope, {
  open(next) {
    options = next;
    claim(false).catch(() => {});
  },
  takeOver: () => claim(true),
  appendUpdates: (docId, updates) =>
    serially(async () => {
      const store = await current();
      if (store.compat !== null) {
        store.unsnapshotted.push(await store.compat.append(docId, updates));
      }
      appendUpdates(store.db, docId, updates);
      if (store.unsnapshotted.length >= SNAPSHOT_EVERY) await snapshot(store);
    }),
  loadDoc: (docId) =>
    serially(async () => {
      const state = loadDoc((await current()).db, docId);
      if (state === null) return null;
      const own =
        state.byteOffset === 0 && state.byteLength === state.buffer.byteLength
          ? state
          : state.slice();
      return transfer(own, [own.buffer as ArrayBuffer]);
    }),
  compact: (docId) => serially(async () => compactDoc((await current()).db, docId)),
  checkpoint: () =>
    serially(async () => {
      const store = await current();
      if (store.unsnapshotted.length > 0) await snapshot(store);
    }),
});

/**
 * Asks for the workspace lock. A normal request waits in line. After OPEN_ELSEWHERE_AFTER_MS
 * the status says the workspace is open elsewhere, but the request keeps waiting, so closing
 * the other tab hands the workspace over. A takeover steals the lock instead.
 */
function claim(steal: boolean): Promise<void> {
  if (holdingLock) return readiness.promise.then(() => {});
  cancelQueuedRequest?.();
  cancelQueuedRequest = undefined;
  setStatus({ state: 'opening' });

  // Listen before stealing, so the previous owner's goodbye can't arrive unheard.
  const previousOwnerDone = steal ? waitForHandoff() : Promise.resolve();
  const controller = new AbortController();
  const timer = steal
    ? undefined
    : setTimeout(() => {
        if (!holdingLock) setStatus({ state: 'open-elsewhere' });
      }, OPEN_ELSEWHERE_AFTER_MS);
  let granted = false;

  return new Promise<void>((resolve, reject) => {
    const request = navigator.locks.request(
      LOCK_NAME,
      steal ? { steal: true } : { signal: controller.signal },
      async () => {
        granted = true;
        holdingLock = true;
        cancelQueuedRequest = undefined;
        clearTimeout(timer);
        try {
          becomeReady(await openStorage(previousOwnerDone));
          resolve();
        } catch (error) {
          holdingLock = false;
          closeStorage(undefined);
          becomeUnavailable({ state: 'failed', reason: describe(error) });
          reject(error);
          return;
        }
        await forever;
      },
    );
    request.catch((error: unknown) => {
      clearTimeout(timer);
      if (granted) {
        letGo();
      } else if (!isAbortError(error)) {
        becomeUnavailable({ state: 'failed', reason: describe(error) });
        reject(error);
      }
    });
    if (!steal) cancelQueuedRequest = () => controller.abort();
  });
}

/** Another tab took the workspace: refuse new work, finish what's running, then let go. */
function letGo(): void {
  holdingLock = false;
  const store = opened;
  becomeUnavailable({ state: 'moved-away' });
  void serially(() => {
    closeStorage(store);
    handoff.postMessage('released');
  });
}

async function openStorage(previousOwnerDone: Promise<void>): Promise<Opened> {
  const sqlite3 = await loadSqlite();
  const mode = options.storage ?? (sahPoolSupported() ? 'opfs' : 'compat');
  if (mode === 'opfs') {
    const claimed = await claimPoolUnlessRefused(sqlite3);
    if (claimed !== null) {
      const db = new claimed.OpfsSAHPoolDb(DB_FILE);
      try {
        migrate(db);
      } catch (error) {
        db.close();
        throw error;
      }
      return { db, mode: 'opfs', compat: null, unsnapshotted: [] };
    }
  }
  if (mode !== 'unsaved') {
    await previousOwnerDone;
    const compat = await openCompatStorage();
    if (compat !== null) return openCompat(sqlite3, compat);
  }
  const db = new sqlite3.oo1.DB(':memory:');
  migrate(db);
  return { db, mode: 'unsaved', compat: null, unsnapshotted: [] };
}

/**
 * The OPFS pool, retried while another worker still holds its handles. Returns null when the
 * browser refuses OPFS outright, as some private windows do.
 */
async function claimPoolUnlessRefused(sqlite3: Sqlite3Static): Promise<SAHPoolUtil | null> {
  const deadline = performance.now() + RELEASE_WAIT_MS;
  for (;;) {
    try {
      pool = await claimPool(sqlite3, pool);
      return pool;
    } catch (error) {
      if (refusesOpfs(error)) return null;
      if (!isBusy(error)) throw error;
      if (performance.now() >= deadline) {
        throw new Error('Another tab is still holding the workspace files. Close it and reload.');
      }
      await sleep(50);
    }
  }
}

function openCompat(sqlite3: Sqlite3Static, compat: CompatStorage): Opened {
  const db =
    compat.image === null ? new sqlite3.oo1.DB(':memory:') : openImage(sqlite3, compat.image);
  migrate(db);
  const unsnapshotted: number[] = [];
  for (const entry of compat.entries) {
    appendUpdates(db, entry.docId, entry.updates);
    unsnapshotted.push(entry.key);
  }
  return { db, mode: 'compat', compat, unsnapshotted };
}

async function snapshot(store: Opened): Promise<void> {
  if (store.compat === null) return;
  const keys = store.unsnapshotted.splice(0);
  try {
    await store.compat.snapshot(exportImage(await loadSqlite(), store.db), keys);
  } catch (error) {
    store.unsnapshotted.unshift(...keys);
    throw error;
  }
}

function closeStorage(store: Opened | undefined): void {
  store?.compat?.close();
  store?.db.close();
  if (pool !== undefined && !pool.isPaused()) pool.pauseVfs();
}

/** The open store. While the workspace is still being claimed, this waits for it. */
function current(): Promise<Opened> {
  if (opened !== undefined) return Promise.resolve(opened);
  if (status.state === 'moved-away' || status.state === 'failed') {
    return Promise.reject(new Error(unavailable(status)));
  }
  return readiness.promise;
}

function becomeReady(store: Opened): void {
  opened = store;
  readiness.resolve(store);
  setStatus({ state: 'ready', mode: store.mode });
}

function becomeUnavailable(next: StoreStatus): void {
  opened = undefined;
  readiness.reject(new Error(unavailable(next)));
  readiness = waitForReady();
  setStatus(next);
}

function waitForReady(): PromiseWithResolvers<Opened> {
  const deferred = Promise.withResolvers<Opened>();
  // Callers see the rejection through current(); this only keeps it from being unhandled.
  deferred.promise.catch(() => {});
  return deferred;
}

function setStatus(next: StoreStatus): void {
  status = next;
  server.emit('status', next);
}

/** Runs storage work one task at a time, in the order the calls arrived. */
function serially<T>(task: () => T | Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

/** Resolves when the previous owner says it has let go, or after RELEASE_WAIT_MS. */
function waitForHandoff(): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      handoff.removeEventListener('message', onMessage);
      resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data === 'released') finish();
    };
    const timer = setTimeout(finish, RELEASE_WAIT_MS);
    handoff.addEventListener('message', onMessage);
  });
}

function unavailable(next: StoreStatus): string {
  switch (next.state) {
    case 'moved-away':
      return 'The workspace moved to another tab.';
    case 'open-elsewhere':
      return 'The workspace is open in another tab.';
    case 'failed':
      return `The workspace could not open: ${next.reason}`;
    default:
      return 'The workspace is not open.';
  }
}

function refusesOpfs(error: unknown): boolean {
  return (
    (error instanceof DOMException &&
      (error.name === 'SecurityError' || error.name === 'NotAllowedError')) ||
    (error instanceof Error && error.message === 'Missing required OPFS APIs.')
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
