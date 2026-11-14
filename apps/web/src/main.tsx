import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import { shellReady } from './perf/index.ts';
import type { StorageMode } from './store/api.ts';
import { startStore } from './store/client.ts';

const store = startStore({ storage: storageOverride() });

// The shell counts as interactive once the store accepts writes.
const storeOpened = store.subscribe(() => {
  if (store.getStatus().state !== 'ready') return;
  storeOpened();
  shellReady('store');
});

// Leaving the page stops the worker at once, so a reload can claim the workspace straight away.
window.addEventListener('pagehide', () => store.shutdown());
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});
// In compatibility mode, a hidden tab writes a snapshot, so the next start replays less.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.checkpoint().catch(() => {});
});

const container = document.getElementById('root');
if (container === null) throw new Error('index.html is missing the #root element');

createRoot(container).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);

// Vite replaces import.meta.env.MODE at build time, so production builds drop this branch
// and never emit the bench chunk.
if (import.meta.env.MODE === 'bench') {
  import('./bench/index.ts').then((bench) => bench.install({ store }));
}

/** Bench builds only: ?store=compat or ?store=unsaved forces a storage fallback. */
function storageOverride(): StorageMode | undefined {
  if (import.meta.env.MODE !== 'bench') return undefined;
  const value = new URLSearchParams(location.search).get('store');
  return value === 'opfs' || value === 'compat' || value === 'unsaved' ? value : undefined;
}
