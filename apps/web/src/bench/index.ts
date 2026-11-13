// Bench builds only. main.tsx imports this module behind import.meta.env.MODE === 'bench',
// so production bundles never contain it. The bench harness grows it into the full API.
import * as Y from 'yjs';
import type { StoreStatus } from '../store/api.ts';
import type { Store } from '../store/client.ts';

export interface BenchApi {
  /** Features whose metrics the bench runner may measure. Each feature declares itself. */
  readonly features: readonly string[];
  /** Hooks the end-to-end tests use to drive the store. */
  readonly store: BenchStore;
}

export interface BenchStore {
  status(): StoreStatus;
  /** Every status state this page has reported since the bench module loaded. */
  history(): readonly StoreStatus['state'][];
  /** Appends text to a doc's `text` field, as one update. */
  writeText(docId: string, text: string): Promise<void>;
  readText(docId: string): Promise<string | null>;
  checkpoint(): Promise<void>;
}

declare global {
  interface Window {
    __bench?: BenchApi;
  }
}

export function install({ store }: { store: Store }): void {
  const history: StoreStatus['state'][] = [store.getStatus().state];
  store.subscribe(() => history.push(store.getStatus().state));

  const load = async (docId: string): Promise<Y.Doc | null> => {
    const state = await store.loadDoc(docId);
    if (state === null) return null;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return doc;
  };

  window.__bench = {
    features: [],
    store: {
      status: () => store.getStatus(),
      history: () => [...history],
      async writeText(docId, text) {
        const doc = (await load(docId)) ?? new Y.Doc();
        const before = Y.encodeStateVector(doc);
        const field = doc.getText('text');
        field.insert(field.length, text);
        await store.appendUpdates(docId, [Y.encodeStateAsUpdate(doc, before)]);
      },
      async readText(docId) {
        return (await load(docId))?.getText('text').toString() ?? null;
      },
      checkpoint: () => store.checkpoint(),
    },
  };
}
