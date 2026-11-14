import { APP_NAME } from '@apace/model';
import { useEffect } from 'react';
import { shellReady } from './perf/index.ts';
import type { Store } from './store/client.ts';
import { StoreStatusLine } from './store/status.tsx';

// The unstyled shell. Layout and tokens arrive with the design direction in step 12.
export function App({ store }: { store: Store }) {
  useEffect(() => shellReady('shell'), []);
  return (
    <main>
      <h1>{APP_NAME}</h1>
      <StoreStatusLine store={store} />
    </main>
  );
}
