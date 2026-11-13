// Bench builds only. main.tsx imports this module behind import.meta.env.MODE === 'bench',
// so production bundles never contain it. The bench harness grows it into the full API.
import { CONTENT_FIELD } from '@apace/model';
import * as Y from 'yjs';
import type { SearchHit, SeedSummary, StoreStatus, WorkspaceCounts } from '../store/api.ts';
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
  /** Replaces the workspace with the one generated from `seed`, inside the store worker. */
  seed(seed: number): Promise<SeedSummary>;
  /** Replaces a page's title, as one update, the way typing in it would. */
  retitle(pageId: string, title: string): Promise<void>;
  counts(): Promise<WorkspaceCounts>;
  search(query: string, limit: number): Promise<readonly SearchHit[]>;
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
      seed: (seed) => store.seed(seed),
      async retitle(pageId, title) {
        const doc = await load(pageId);
        const heading = doc?.getXmlFragment(CONTENT_FIELD).get(0);
        if (doc === null || !(heading instanceof Y.XmlElement)) {
          throw new Error(`${pageId} has no title`);
        }
        const before = Y.encodeStateVector(doc);
        const text = heading.get(0);
        if (text instanceof Y.XmlText) {
          text.delete(0, text.length);
          text.insert(0, title);
        } else {
          heading.insert(0, [new Y.XmlText(title)]);
        }
        await store.appendUpdates(pageId, [Y.encodeStateAsUpdate(doc, before)]);
      },
      counts: () => store.counts(),
      search: (query, limit) => store.search(query, limit),
    },
  };
}
