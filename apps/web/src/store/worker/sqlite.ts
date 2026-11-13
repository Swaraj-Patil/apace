import sqlite3InitModule, {
  type Database,
  type SAHPoolUtil,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';

type PoolOptions = Parameters<Sqlite3Static['installOpfsSAHPoolVfs']>[0];

let loading: Promise<Sqlite3Static> | undefined;

/** Loads and compiles SQLite once per worker. */
export function loadSqlite(): Promise<Sqlite3Static> {
  loading ??= sqlite3InitModule();
  return loading;
}

/** True when this browser can give a worker synchronous OPFS file handles. */
export function sahPoolSupported(): boolean {
  return (
    typeof FileSystemFileHandle !== 'undefined' &&
    'createSyncAccessHandle' in FileSystemFileHandle.prototype &&
    typeof navigator.storage?.getDirectory === 'function'
  );
}

/** A file handle another worker still holds. Those clear on their own, so it's worth retrying. */
export function isBusy(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NoModificationAllowedError' || error.name === 'InvalidStateError')
  );
}

/**
 * Opens the workspace's pool of OPFS access handles, or takes them back after a pause. By
 * default a failed install deletes the pool, which would destroy the workspace whenever
 * another tab still held a handle, so failures here only release what was acquired.
 */
export async function claimPool(
  sqlite3: Sqlite3Static,
  paused?: SAHPoolUtil,
): Promise<SAHPoolUtil> {
  if (paused !== undefined) {
    await paused.unpauseVfs();
    return paused;
  }
  const options: PoolOptions & { forceReinitIfPreviouslyFailed: boolean } = {
    name: 'apace',
    directory: '.apace',
    preserveOnInitFailure: true,
    forceReinitIfPreviouslyFailed: true,
  };
  return sqlite3.installOpfsSAHPoolVfs(options);
}

/** The whole database as bytes. */
export function exportImage(sqlite3: Sqlite3Static, db: Database): Uint8Array {
  return sqlite3.capi.sqlite3_js_db_export(db);
}

/** An in-memory database loaded from bytes made by exportImage, and free to grow. */
export function openImage(sqlite3: Sqlite3Static, image: Uint8Array): Database {
  const db = new sqlite3.oo1.DB(':memory:');
  const { capi } = sqlite3;
  const pointer = sqlite3.wasm.allocFromTypedArray(image);
  const flags = capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE;
  db.checkRc(
    capi.sqlite3_deserialize(db, 'main', pointer, image.byteLength, image.byteLength, flags),
  );
  return db;
}
