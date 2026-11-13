import { defineConfig, devices } from '@playwright/test';
import { BENCH_PORT, BENCH_URL, PRODUCTION_PORT, PRODUCTION_URL } from './apps/web/e2e/urls.ts';

// `pnpm e2e` builds both bundles first; these servers only serve them.
export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
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
  ],
});
