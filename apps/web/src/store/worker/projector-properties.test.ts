import {
  BLOCK_TYPES,
  createPage,
  type Inline,
  makeBlock,
  movePage,
  type Page,
  purgePage,
  readEntries,
  restorePage,
  type TreeEnv,
  trashPage,
  WORKSPACE_DOC_ID,
  writePage,
} from '@apace/model';
import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import fc from 'fast-check';
import { beforeAll, expect, test } from 'vitest';
import * as Y from 'yjs';
import { dumpProjections, projectionProblems } from './projection-check.ts';
import { createProjector } from './projector.ts';
import { migrate } from './schema.ts';

let sqlite3: Sqlite3Static;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

/** Page ids the history can use. Content can be written for a page before the tree has it. */
const PAGE_IDS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] as const;
const pageId = fc.constantFrom(...PAGE_IDS);
const word = fc.constantFrom('alpha', 'Beta', 'Zéphyr', 'café'.normalize('NFD'), '中文', '😀', 'x');

const inline: fc.Arbitrary<Inline> = fc.oneof(
  { weight: 4, arbitrary: word.map((text) => ({ text })) },
  { weight: 1, arbitrary: word.map((text) => ({ text, marks: { bold: true as const } })) },
  { weight: 1, arbitrary: pageId.map((mention) => ({ mention })) },
);

// Few block ids, so rewrites keep, move, retype and repeat blocks rather than replace them all.
const block = fc
  .record({
    id: fc.constantFrom('b0', 'b1', 'b2', 'b3', 'b4'),
    type: fc.constantFrom(...BLOCK_TYPES),
    indent: fc.integer({ min: 0, max: 3 }),
    checked: fc.boolean(),
    content: fc.array(inline, { maxLength: 4 }),
  })
  .map(({ id, type, indent, checked, content }) =>
    makeBlock(type, id, { indent, attrs: type === 'todo' ? { checked } : {}, content }),
  );

const page: fc.Arbitrary<Page> = fc.record({
  title: fc.array(word, { maxLength: 3 }).map((words) => words.join(' ')),
  meta: fc.record({
    icon: fc.option(fc.constantFrom('🚀', '🌿'), { nil: null }),
    cover: fc.constant(null),
    fullWidth: fc.boolean(),
  }),
  blocks: fc.array(block, { minLength: 1, maxLength: 6 }),
});

type Step =
  | { readonly kind: 'create'; readonly parent: number }
  | { readonly kind: 'move'; readonly page: number; readonly parent: number }
  | { readonly kind: 'trash' | 'restore' | 'purge'; readonly page: number }
  | { readonly kind: 'write'; readonly id: string; readonly page: Page }
  | { readonly kind: 'type'; readonly id: string; readonly at: number; readonly text: string }
  | { readonly kind: 'icon'; readonly id: string; readonly icon: string | null }
  | { readonly kind: 'send'; readonly id: string }
  | { readonly kind: 'flush' | 'read' | 'drop' | 'crash' };

const index = fc.nat({ max: 7 });
const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('create'), parent: index }) },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('move'), page: index, parent: index }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constantFrom('trash', 'restore', 'purge'),
      page: index,
    }),
  },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('write'), id: pageId, page }) },
  {
    weight: 3,
    arbitrary: fc.record({ kind: fc.constant('type'), id: pageId, at: fc.nat(), text: word }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('icon'),
      id: pageId,
      icon: fc.option(fc.constantFrom('🧭', '📘'), { nil: null }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('send'),
      id: fc.constantFrom(WORKSPACE_DOC_ID, ...PAGE_IDS),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constantFrom('flush', 'read', 'drop') }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'crash' as const }) },
);

test('after any edit history, the incremental projections equal a rebuild from Yjs', () => {
  // How often the cases that matter came up, so a weak generator can't pass unnoticed.
  const seen = { crashWithUnprojectedWork: 0, contentBeforeItsPage: 0, droppedReplica: 0 };
  fc.assert(
    fc.property(fc.array(step, { minLength: 1, maxLength: 40, size: 'max' }), (steps) => {
      const db = new sqlite3.oo1.DB(':memory:');
      migrate(db);
      let clock = 0;
      let projector = createProjector(db, { now: () => clock });

      // One writer per doc, as the editor would be. Its updates queue until they're sent.
      const writers = new Map<string, Y.Doc>();
      const queued = new Map<string, Uint8Array[]>();
      const writer = (id: string): Y.Doc => {
        let doc = writers.get(id);
        if (doc === undefined) {
          doc = new Y.Doc();
          const queue: Uint8Array[] = [];
          doc.on('update', (update: Uint8Array) => queue.push(update));
          writers.set(id, doc);
          queued.set(id, queue);
        }
        return doc;
      };
      const send = (id: string) => {
        const updates = queued.get(id)?.splice(0) ?? [];
        if (
          updates.length > 0 &&
          id !== WORKSPACE_DOC_ID &&
          !readEntries(tree).some((entry) => entry.id === id)
        ) {
          seen.contentBeforeItsPage++;
        }
        projector.append(id, updates);
      };
      const tree = writer(WORKSPACE_DOC_ID);
      let nextPage = 0;
      const env: TreeEnv = {
        now: () => ++clock,
        newId: () => PAGE_IDS[nextPage++] ?? `extra-${nextPage}`,
      };
      const pageAt = (n: number): string | undefined => {
        const ids = readEntries(tree).map((entry) => entry.id);
        return ids.sort()[n % Math.max(1, ids.length)];
      };
      // The model refuses some edits, such as a move into the page's own subpage, by throwing.
      const attempt = (edit: () => void) => {
        try {
          edit();
        } catch {}
      };

      for (const s of steps) {
        clock++;
        switch (s.kind) {
          case 'create':
            attempt(() =>
              createPage(
                tree,
                { parent: s.parent % 3 === 0 ? null : (pageAt(s.parent) ?? null) },
                env,
              ),
            );
            break;
          case 'move': {
            const id = pageAt(s.page);
            if (id !== undefined) {
              attempt(() =>
                movePage(
                  tree,
                  id,
                  { parent: s.parent % 3 === 0 ? null : (pageAt(s.parent) ?? null) },
                  env,
                ),
              );
            }
            break;
          }
          case 'trash':
          case 'restore':
          case 'purge': {
            const id = pageAt(s.page);
            if (id === undefined) break;
            if (s.kind === 'trash') attempt(() => trashPage(tree, id, env));
            else if (s.kind === 'restore') attempt(() => restorePage(tree, id, env));
            else attempt(() => purgePage(tree, id));
            break;
          }
          case 'write':
            writePage(writer(s.id), s.page);
            break;
          case 'type': {
            // A keystroke: text typed straight into a block, as a remote edit would arrive.
            const fragment = writer(s.id).getXmlFragment('content');
            const blocks = fragment.toArray().filter((node) => node instanceof Y.XmlElement);
            const target = blocks[s.at % Math.max(1, blocks.length)];
            const text = target?.toArray().find((node) => node instanceof Y.XmlText);
            if (text instanceof Y.XmlText) text.insert(s.at % (text.length + 1), s.text);
            break;
          }
          case 'icon':
            writer(s.id).getMap('meta').set('icon', s.icon);
            break;
          case 'send':
            send(s.id);
            break;
          case 'flush':
            projector.flush();
            break;
          case 'read':
            projector.search('a', 5);
            break;
          case 'drop':
            projector.dropIdleReplicas(0);
            seen.droppedReplica++;
            break;
          case 'crash':
            // In-memory state is lost; only the log and the tables survive.
            if (
              Number(db.selectValue('SELECT count(*) FROM docs WHERE projected_seq < last_seq')) > 0
            ) {
              seen.crashWithUnprojectedWork++;
            }
            projector.close();
            projector = createProjector(db, { now: () => clock });
            projector.recover();
            break;
        }
      }

      for (const id of queued.keys()) send(id);
      projector.flush();
      const problems = projectionProblems(db);
      const incremental = dumpProjections(db);
      projector.rebuild();
      expect(problems).toEqual([]);
      expect(dumpProjections(db)).toEqual(incremental);
      projector.close();
      db.close();
    }),
    { numRuns: 300 },
  );
  expect(seen.crashWithUnprojectedWork).toBeGreaterThanOrEqual(50);
  expect(seen.contentBeforeItsPage).toBeGreaterThanOrEqual(50);
  expect(seen.droppedReplica).toBeGreaterThanOrEqual(50);
});
