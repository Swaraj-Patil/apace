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

export interface StoreApi {
  /** Starts claiming the workspace. Progress arrives as status events. */
  open(options: OpenOptions): Promise<void>;
  /** Takes the workspace from whichever tab holds it. */
  takeOver(): Promise<void>;
  /** Resolves once the updates are durable. */
  appendUpdates(docId: string, updates: readonly Uint8Array[]): Promise<void>;
  /** The doc's merged state, or null if it was never written. */
  loadDoc(docId: string): Promise<Uint8Array | null>;
  /** Folds a doc's updates into its snapshot. */
  compact(docId: string): Promise<void>;
  /** In compatibility mode, writes a database snapshot now. Otherwise it does nothing. */
  checkpoint(): Promise<void>;
}

export interface StoreEvents {
  status: StoreStatus;
}

/** Held by the store worker for its whole life, so only one tab writes the workspace. */
export const LOCK_NAME = 'workspace-db';
/** How long a tab waits for the lock before saying the workspace is open elsewhere. */
export const OPEN_ELSEWHERE_AFTER_MS = 1500;
/** How long a new owner keeps trying while the previous owner lets go of the storage. */
export const RELEASE_WAIT_MS = 3000;
