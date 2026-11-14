// Where the end-to-end servers listen. Both app servers serve prebuilt bundles from
// bench/serve.ts, with the rules the deployed site uses.
import { EMBED_ORIGIN } from '@apace/seed';

export const PRODUCTION_PORT = 4310;
export const BENCH_PORT = 4311;
export const PRODUCTION_URL = `http://127.0.0.1:${PRODUCTION_PORT}/`;
export const BENCH_URL = `http://127.0.0.1:${BENCH_PORT}/`;

/**
 * The fixture origin, which `apps/web/e2e/embed-origin.ts` serves. It comes from the seed, so
 * the pages seeded embeds point at are the pages the suite serves. Its host and port both
 * differ from the app's, so anything it sends is cross-origin.
 */
export const EMBED_URL = `${EMBED_ORIGIN}/`;
export const EMBED_PORT = Number(new URL(EMBED_ORIGIN).port);
