// Bench builds only. main.tsx imports this module behind import.meta.env.MODE === 'bench',
// so production bundles never contain it. The bench harness grows it into the full API.

export interface BenchApi {
  /** Features whose metrics the bench runner may measure. Each feature declares itself. */
  readonly features: readonly string[];
}

declare global {
  interface Window {
    __bench?: BenchApi;
  }
}

window.__bench = { features: [] };
