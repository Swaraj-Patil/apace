// The main thread's handle on the store worker.
import type { OpenOptions, StoreApi, StoreEvents, StoreStatus } from './api.ts';
import { connect } from './rpc.ts';

export interface Store {
  getStatus(): StoreStatus;
  /** For useSyncExternalStore: calls back whenever the status changes. */
  subscribe(listener: () => void): () => void;
  takeOver(): Promise<void>;
  appendUpdates(docId: string, updates: readonly Uint8Array[]): Promise<void>;
  loadDoc(docId: string): Promise<Uint8Array | null>;
  compact(docId: string): Promise<void>;
  checkpoint(): Promise<void>;
  /** Stops the worker at once, which frees the lock and the files for the next page. */
  shutdown(): void;
}

export function startStore(options: OpenOptions = {}): Store {
  const worker = new Worker(new URL('./worker/index.ts', import.meta.url), {
    type: 'module',
    name: 'apace-store',
  });
  const rpc = connect<StoreApi, StoreEvents>(worker);
  const listeners = new Set<() => void>();
  let status: StoreStatus = { state: 'opening' };
  const update = (next: StoreStatus) => {
    status = next;
    for (const listener of listeners) listener();
  };

  rpc.on('status', update);
  worker.addEventListener('error', (event) => {
    update({ state: 'failed', reason: event.message || 'The store worker stopped.' });
  });
  rpc.call('open', [options]).catch(() => {});

  return {
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    takeOver: () => rpc.call('takeOver', []),
    appendUpdates: (docId, updates) => rpc.call('appendUpdates', [docId, updates]),
    loadDoc: (docId) => rpc.call('loadDoc', [docId]),
    compact: (docId) => rpc.call('compact', [docId]),
    checkpoint: () => rpc.call('checkpoint', []),
    shutdown() {
      rpc.close('The store shut down.');
      worker.terminate();
    },
  };
}
