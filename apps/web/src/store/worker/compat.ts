// Compatibility mode keeps the in-memory database durable in IndexedDB. There's an append-only
// log of update batches, each committed before the batch is acknowledged, and a snapshot of
// the whole database image taken from time to time. Startup restores the snapshot and replays
// the log written after it.

export interface LogEntry {
  readonly key: number;
  readonly docId: string;
  readonly updates: readonly Uint8Array[];
}

export interface CompatStorage {
  /** The latest database image, or null before the first snapshot. */
  readonly image: Uint8Array | null;
  /** Batches written since that image, oldest first. */
  readonly entries: readonly LogEntry[];
  /** Commits a batch to the log and returns its key. */
  append(docId: string, updates: readonly Uint8Array[]): Promise<number>;
  /** Replaces the image and drops exactly the log entries it now contains. */
  snapshot(image: Uint8Array, containedKeys: readonly number[]): Promise<void>;
  close(): void;
}

const DB_NAME = 'apace-compat';
const LOG = 'log';
const META = 'meta';
const IMAGE = 'image';

/** Opens the IndexedDB side of compatibility mode, or returns null where IndexedDB is unusable. */
export async function openCompatStorage(): Promise<CompatStorage | null> {
  if (typeof indexedDB === 'undefined') return null;
  let db: IDBDatabase;
  try {
    db = await openDatabase();
  } catch {
    return null;
  }

  const read = db.transaction([LOG, META], 'readonly');
  const [image, keys, values] = await Promise.all([
    request(read.objectStore(META).get(IMAGE)),
    request(read.objectStore(LOG).getAllKeys()),
    request(read.objectStore(LOG).getAll()),
  ]);
  const entries = keys.map((key, index) => {
    const value = values[index] as { docId: string; updates: Uint8Array[] };
    return { key: Number(key), docId: value.docId, updates: value.updates };
  });

  return {
    image: image instanceof Uint8Array ? image : null,
    entries,
    async append(docId, updates) {
      const tx = db.transaction(LOG, 'readwrite', { durability: 'strict' });
      const done = finished(tx);
      const key = await request(tx.objectStore(LOG).add({ docId, updates }));
      await done;
      return Number(key);
    },
    async snapshot(nextImage, containedKeys) {
      const tx = db.transaction([LOG, META], 'readwrite', { durability: 'strict' });
      const done = finished(tx);
      tx.objectStore(META).put(nextImage, IMAGE);
      const log = tx.objectStore(LOG);
      for (const key of containedKeys) log.delete(key);
      await done;
    },
    close() {
      db.close();
    },
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(LOG, { autoIncrement: true });
      open.result.createObjectStore(META);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('IndexedDB is blocked by another connection'));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('The IndexedDB transaction was aborted'));
  });
}
