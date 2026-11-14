// Bench builds only. main.tsx imports this module behind import.meta.env.MODE === 'bench',
// so production bundles never contain it.
//
// Hooks the app can't honour yet throw and name the step that fills them in, so a scenario
// can never quietly measure nothing. The runner asks for `features` first and measures only
// the metrics whose feature the app declares, so it never reaches them.
import { CONTENT_FIELD } from '@apace/model';
import * as Y from 'yjs';
import { FEATURES } from '../features.ts';
import { type Sample, shellPending, takeSamples } from '../perf/index.ts';
import type {
  SearchHit,
  SeedFixtures,
  SeedSummary,
  StoreStatus,
  WorkspaceCounts,
} from '../store/api.ts';
import type { Store } from '../store/client.ts';

export interface BenchApi {
  /** Features whose metrics the bench runner may measure. Each feature declares itself. */
  readonly features: readonly string[];
  /** The samples the probes have taken since the last call, which this empties. */
  samples(): Sample[];
  /** Parts of the shell that haven't reported ready, when a cold start doesn't finish. */
  shellPending(): string[];
  /** The pages the bench measures, from the generator's plan. */
  fixtures(seed: number): Promise<SeedFixtures>;
  /** Opens a page the way the sidebar does, and resolves once its content is painted. */
  openPage(pageId: string): Promise<void>;
  /** Scrolls the sidebar to a page and selects its row. */
  revealInSidebar(pageId: string): Promise<void>;
  /** Puts the caret in the open page, at the top, the middle or the end. */
  placeCaret(where: 'start' | 'middle' | 'end'): Promise<void>;
  /** Puts a page back the way the seed wrote it, so edited scenarios stay comparable. */
  restoreFixture(pageId: string): Promise<void>;
  /** Empties whatever the app caches, so the next open of a page is its first. */
  dropCaches(): Promise<void>;
  /** The views the scroll metric covers. */
  scrollTargets(): readonly string[];
  /** Phase 2 declares these. Until then they say so. */
  readonly database: BenchDatabase;
  /** Hooks the end-to-end tests use to drive the store. */
  readonly store: BenchStore;
}

export interface BenchDatabase {
  filter(property: string, value: unknown): Promise<void>;
  sort(property: string, direction: 'asc' | 'desc'): Promise<void>;
  group(property: string): Promise<void>;
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

/** A hook whose feature isn't built yet. The message says when it will be. */
function arrivesIn(when: string, what: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${what} arrives in ${when}; it has nothing to drive yet`));
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
    features: FEATURES,
    samples: takeSamples,
    shellPending,
    fixtures: (seed) => store.fixtures(seed),
    openPage: arrivesIn('step 13', 'Opening a page from the sidebar'),
    revealInSidebar: arrivesIn('step 13', 'The sidebar'),
    placeCaret: arrivesIn('step 11', 'The editor'),
    restoreFixture: arrivesIn('step 11', 'Restoring an edited page'),
    async dropCaches() {
      // Nothing is cached in the app yet. Samples are dropped so a scenario starts clean.
      takeSamples();
    },
    scrollTargets: () => [],
    database: {
      filter: arrivesIn('Phase 2', 'The database'),
      sort: arrivesIn('Phase 2', 'The database'),
      group: arrivesIn('Phase 2', 'The database'),
    },
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
