import { defineConfig, devices } from '@playwright/test';
import {
  BENCH_PORT,
  BENCH_URL,
  EMBED_PORT,
  EMBED_URL,
  PRODUCTION_PORT,
  PRODUCTION_URL,
} from './apps/web/e2e/urls.ts';

// `pnpm e2e` builds both bundles first; these servers only serve them.
export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
      testIgnore: /probe\.spec\.ts/,
    },
    {
      // Calibrating the probes means measuring milliseconds, so these run on their own, after
      // everything else, rather than against four other tests on the same cores.
      name: 'probe',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
      testMatch: /probe\.spec\.ts/,
      dependencies: ['chromium'],
      fullyParallel: false,
    },
  ],
  webServer: [
    {
      command: `node bench/serve.ts --root apps/web/dist --port ${PRODUCTION_PORT}`,
      url: PRODUCTION_URL,
      reuseExistingServer: false,
    },
    {
      command: `node bench/serve.ts --root apps/web/dist-bench --port ${BENCH_PORT}`,
      url: BENCH_URL,
      reuseExistingServer: false,
    },
    {
      // Another origin, for the pictures and frames the app has to be able to load from one.
      command: `node apps/web/e2e/embed-origin.ts --port ${EMBED_PORT}`,
      url: `${EMBED_URL}embed/1.html`,
      reuseExistingServer: false,
    },
  ],
});
