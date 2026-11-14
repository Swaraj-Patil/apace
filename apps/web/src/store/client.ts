// The main thread's handle on the store worker.
import type {
  Backlink,
  OpenOptions,
  PageMetaRow,
  SearchHit,
  SeedFixtures,
  SeedSummary,
  StoreApi,
  StoreEvents,
  StoreStatus,
  WorkspaceCounts,
} from './api.ts';
import { connect } from './rpc.ts';
import { decodeTree, type TreeColumns } from './tree-columns.ts';

export interface Store {
  getStatus(): StoreStatus;
  /** For useSyncExternalStore: calls back whenever the status changes. */
  subscribe(listener: () => void): () => void;
  takeOver(): Promise<void>;
  appendUpdates(docId: string, updates: readonly Uint8Array[]): Promise<void>;
  loadDoc(docId: string): Promise<Uint8Array | null>;
  compact(docId: string): Promise<void>;
  checkpoint(): Promise<void>;
  getTree(): Promise<TreeColumns>;
  search(query: string, limit: number): Promise<readonly SearchHit[]>;
  backlinks(pageId: string): Promise<readonly Backlink[]>;
  counts(): Promise<WorkspaceCounts>;
  rebuildProjections(): Promise<void>;
  /** Calls back with the whole tree now, and again after every change to it. */
  subscribeTree(listener: (tree: TreeColumns) => void): () => void;
  /** Calls back with the pages whose title, icon, cover or width changed. */
  subscribePageMeta(listener: (pages: readonly PageMetaRow[]) => void): () => void;
  /** Bench builds only: replaces the workspace with the seeded one. */
  seed(seed: number): Promise<SeedSummary>;
  /** Bench builds only: the pages the bench measures. */
  fixtures(seed: number): Promise<SeedFixtures>;
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
  const treeListeners = new Set<(tree: TreeColumns) => void>();
  const metaListeners = new Set<(pages: readonly PageMetaRow[]) => void>();
  let status: StoreStatus = { state: 'opening' };
  const update = (next: StoreStatus) => {
    status = next;
    for (const listener of listeners) listener();
  };

  rpc.on('status', update);
  rpc.on('tree', (buffer) => {
    const tree = decodeTree(buffer);
    for (const listener of treeListeners) listener(tree);
  });
  rpc.on('pageMeta', (pages) => {
    for (const listener of metaListeners) listener(pages);
  });
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
    getTree: async () => decodeTree(await rpc.call('getTree', [])),
    search: (query, limit) => rpc.call('search', [query, limit]),
    backlinks: (pageId) => rpc.call('backlinks', [pageId]),
    counts: () => rpc.call('counts', []),
    rebuildProjections: () => rpc.call('rebuildProjections', []),
    subscribeTree(listener) {
      treeListeners.add(listener);
      // Watching again makes the worker send the tree now, so a new listener gets it too.
      rpc.call('watchTree', [true]).catch(() => {});
      return () => {
        treeListeners.delete(listener);
        if (treeListeners.size === 0) rpc.call('watchTree', [false]).catch(() => {});
      };
    },
    subscribePageMeta(listener) {
      metaListeners.add(listener);
      return () => {
        metaListeners.delete(listener);
      };
    },
    seed: (seed) => rpc.call('seed', [seed]),
    fixtures: (seed) => rpc.call('fixtures', [seed]),
    shutdown() {
      rpc.close('The store shut down.');
      worker.terminate();
    },
  };
}
