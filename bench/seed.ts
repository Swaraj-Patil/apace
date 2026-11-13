// Times the seed generator: the plan, every page's Yjs update, the content hash, and the
// databases. This is not a budget. It records what generation costs, so the bench can say how
// long reseeding takes and Phase 2 knows what its database spike starts from.
//
// Run with: node bench/seed.ts [seed]
import { cpus } from 'node:os';
import {
  contentHash,
  DEFAULT_SEED,
  databasesHash,
  planWorkspace,
  seedDatabases,
  seedRecords,
} from '@apace/seed';

const RUNS = 5;
const seed = Number(process.argv[2] ?? DEFAULT_SEED);

function medianMs<T>(run: () => T): { ms: number; result: T } {
  const times: number[] = [];
  let result = run();
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    result = run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { ms: times[Math.floor(times.length / 2)] ?? Number.NaN, result };
}

const plan = medianMs(() => planWorkspace(seed));
const records = medianMs(() => [...seedRecords(plan.result)]);
const hash = medianMs(() => contentHash(records.result, plan.result.assets));
const databases = medianMs(() => seedDatabases(seed));
const databaseHash = medianMs(() => databasesHash(databases.result));

const bytes = records.result.reduce((sum, record) => sum + record.update.byteLength, 0);
const large = records.result[plan.result.large + 1]?.update.byteLength ?? 0;
const rows = [
  ['Plan the workspace', plan.ms, `${plan.result.pages.length} pages`],
  ['Generate page updates', records.ms, `${(bytes / 1024 / 1024).toFixed(1)} MB in all`],
  ['  of which the 3,000-block page', Number.NaN, `${Math.round(large / 1024)} KB`],
  ['Hash the workspace', hash.ms, hash.result],
  ['Generate the databases', databases.ms, `${databases.result.tasks.length} tasks`],
  ['Hash the databases', databaseHash.ms, databaseHash.result],
] as const;

console.log(
  `${cpus()[0]?.model ?? 'unknown CPU'}, Node ${process.versions.node}, seed ${seed}, median of ${RUNS}`,
);
for (const [label, ms, note] of rows) {
  const time = Number.isNaN(ms) ? '' : `${ms.toFixed(1)} ms`;
  console.log(`${label.padEnd(34)}${time.padStart(10)}   ${note}`);
}
