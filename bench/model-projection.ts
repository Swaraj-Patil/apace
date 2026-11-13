// Times the page tree at two sizes: Phase 1's 2,000 pages, and 52,000, which is what the tree
// would hold if every row of a 50,000-row database were a page in it. This is not a budget.
// The numbers feed Phase 2's choice of how database rows map to Yjs docs.
//
// Run with: node bench/model-projection.ts
import { cpus } from 'node:os';
import { orderKeyBetween, pagesOf, projectTree, readEntries } from '@apace/model';
import * as Y from 'yjs';

const RUNS = 7;

/** A deterministic tree: about one page in ten starts at the top level, the rest nest. */
function buildWorkspace(size: number): Y.Doc {
  const doc = new Y.Doc();
  let state = 1;
  const random = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const lastOrder = new Map<string | null, string>();
  const ids: string[] = [];
  doc.transact(() => {
    const pages = pagesOf(doc);
    for (let i = 0; i < size; i++) {
      const parent =
        ids.length === 0 || random() < 0.1
          ? null
          : (ids[Math.floor(random() ** 2 * ids.length)] ?? null);
      const order = orderKeyBetween(lastOrder.get(parent) ?? null, null);
      lastOrder.set(parent, order);
      const id = `page-${i}`;
      const page = new Y.Map<unknown>();
      page.set('placement', { parent, order, time: i + 1, client: doc.clientID });
      page.set('trashed', null);
      page.set('created', i + 1);
      pages.set(id, page);
      ids.push(id);
    }
  });
  return doc;
}

function medianMs(run: () => unknown): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] ?? Number.NaN;
}

console.log(
  `${cpus()[0]?.model ?? 'unknown CPU'}, Node ${process.versions.node}, median of ${RUNS}`,
);
console.log('    pages   update KB    load ms    read ms  project ms');
for (const size of [2_000, 52_000]) {
  const doc = buildWorkspace(size);
  const update = Y.encodeStateAsUpdate(doc);
  const load = medianMs(() => Y.applyUpdate(new Y.Doc(), update));
  const read = medianMs(() => readEntries(doc));
  const entries = readEntries(doc);
  const project = medianMs(() => projectTree(entries));
  const cells = [size, Math.round(update.byteLength / 1024), load, read, project];
  console.log(
    cells
      .map((cell) =>
        (typeof cell === 'number' && !Number.isInteger(cell)
          ? cell.toFixed(1)
          : String(cell)
        ).padStart(11),
      )
      .join(''),
  );
}
