import { useSyncExternalStore } from 'react';
import type { StoreStatus } from './api.ts';
import type { Store } from './client.ts';

export function describeStatus(status: StoreStatus): string {
  switch (status.state) {
    case 'opening':
      return 'Opening the workspace…';
    case 'open-elsewhere':
      return 'Open in another tab';
    case 'moved-away':
      return 'Moved to another tab';
    case 'failed':
      return `Couldn't open the workspace: ${status.reason}`;
    case 'ready':
      if (status.mode === 'opfs') return 'Saved on this device';
      if (status.mode === 'compat') return 'Saved in this browser (compatibility mode)';
      return 'Not saved: this browser blocks storage';
  }
}

// Unstyled until the shell's sync indicator takes over these words.
export function StoreStatusLine({ store }: { store: Store }) {
  const status = useSyncExternalStore(store.subscribe, store.getStatus);
  const canTakeOver = status.state === 'open-elsewhere' || status.state === 'moved-away';
  return (
    <p role="status">
      {describeStatus(status)}
      {canTakeOver && (
        <>
          {' '}
          <button type="button" onClick={() => store.takeOver().catch(() => {})}>
            Use it here
          </button>
        </>
      )}
    </p>
  );
}
