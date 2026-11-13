import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';

const container = document.getElementById('root');
if (container === null) throw new Error('index.html is missing the #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Vite replaces import.meta.env.MODE at build time, so production builds drop this branch
// and never emit the bench chunk.
if (import.meta.env.MODE === 'bench') {
  void import('./bench/index.ts');
}
