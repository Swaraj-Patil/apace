import { defineConfig } from 'vitest/config';

// One project per workspace package. End-to-end specs (*.spec.ts) belong to Playwright.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'web', include: ['apps/web/src/**/*.test.{ts,tsx}'] } },
      { test: { name: 'model', include: ['packages/model/**/*.test.ts'] } },
      { test: { name: 'seed', include: ['packages/seed/**/*.test.ts'] } },
      { test: { name: 'bench', include: ['bench/**/*.test.ts'] } },
    ],
  },
});
