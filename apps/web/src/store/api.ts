// The store worker's interface, shared by the worker and the main thread.

/** Where this tab keeps the workspace. */
export type StorageMode = 'opfs' | 'compat' | 'unsaved';

export type StoreStatus =
  | { readonly state: 'opening' }
  | { readonly state: 'open-elsewhere' }
  | { readonly state: 'ready'; readonly mode: StorageMode }
  | { readonly state: 'moved-away' }
  | { readonly state: 'failed'; readonly reason: string };

export interface OpenOptions {
  /** Skips detection. Only bench builds set it, to exercise the fallbacks where OPFS works. */
  readonly storage?: StorageMode | undefined;
}

export interface SearchHit {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
}

/** A page that mentions another, with the blocks that do, in page order. */
export interface Backlink {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
  readonly blocks: readonly string[];
}

export interface PageMetaRow {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
  readonly cover: string | null;
  readonly fullWidth: boolean;
}

export interface WorkspaceCounts {
  readonly pages: number;
  /** Pages in the trash, counting those whose ancestor is. */
  readonly trashed: number;
  readonly blocks: number;
  readonly links: number;
}

/** What a bench seed wrote, and how long it took. */
export interface SeedSummary {
  readonly seed: number;
  /** The counts the generator planned, for checking against the store. */
  readonly expected: Pick<WorkspaceCounts, 'pages' | 'trashed' | 'blocks'>;
  readonly searchQueries: readonly { readonly query: string; readonly expected: string }[];
  readonly generateMs: number;
  readonly importMs: number;
}

export interface StoreApi {
  /** Starts claiming the workspace. Progress arrives as status events. */
  open(options: OpenOptions): Promise<void>;
  /** Takes the workspace from whichever tab holds it. */
  takeOver(): Promise<void>;
  /** Resolves once the updates are durable. Their projections follow shortly after. */
  appendUpdates(docId: string, updates: readonly Uint8Array[]): Promise<void>;
  /** The doc's merged state, or null if it was never written. */
  loadDoc(docId: string): Promise<Uint8Array | null>;
  /** Folds a doc's updates into its snapshot. */
  compact(docId: string): Promise<void>;
  /** In compatibility mode, writes a database snapshot now. Otherwise it does nothing. */
  checkpoint(): Promise<void>;
  /** The page tree, encoded by tree-columns.ts. */
  getTree(): Promise<ArrayBuffer>;
  /** Pages outside the trash that match every word of the query, best first. */
  search(query: string, limit: number): Promise<readonly SearchHit[]>;
  /** Pages outside the trash that mention the page, other than the page itself. */
  backlinks(pageId: string): Promise<readonly Backlink[]>;
  counts(): Promise<WorkspaceCounts>;
  /** Throws every projection away and rebuilds it from the Yjs updates alone. */
  rebuildProjections(): Promise<void>;
  /** While on, the worker sends a tree event now and after every change to the tree. */
  watchTree(on: boolean): Promise<void>;
  /** Bench builds only: replaces the workspace with the seeded one. */
  seed(seed: number): Promise<SeedSummary>;
}

export interface StoreEvents {
  status: StoreStatus;
  /** The page tree, encoded by tree-columns.ts. */
  tree: ArrayBuffer;
  /** Pages whose title, icon, cover or width changed. */
  pageMeta: readonly PageMetaRow[];
}

/** Held by the store worker for its whole life, so only one tab writes the workspace. */
export const LOCK_NAME = 'workspace-db';
/** How long a tab waits for the lock before saying the workspace is open elsewhere. */
export const OPEN_ELSEWHERE_AFTER_MS = 1500;
/** How long a new owner keeps trying while the previous owner lets go of the storage. */
export const RELEASE_WAIT_MS = 3000;
