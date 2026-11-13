import { updateYFragment } from '@tiptap/y-tiptap';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { block, inline, meta, page, text } from './arbitraries.ts';
import { pageToNode, writeMeta, writePage } from './convert.ts';
import {
  type BlockRow,
  effectiveIds,
  linksOf,
  type PageChange,
  projectionToPage,
  projectPage,
  searchTextOf,
  watchPage,
} from './project.ts';
import { BLOCK_TYPES, CONTENT_FIELD, makeBlock, type Page } from './spec.ts';

describe('projectPage', () => {
  test('projects a hand-written page into rows, links and search text', () => {
    const doc = new Y.Doc();
    writePage(doc, {
      title: 'Release process',
      meta: { icon: 'rocket', cover: null, fullWidth: true },
      blocks: [
        makeBlock('heading', 'h', { attrs: { level: 2 }, content: [{ text: 'Checklist' }] }),
        makeBlock('todo', 't', {
          indent: 1,
          attrs: { checked: true },
          content: [
            { text: 'Ask ' },
            { mention: 'page-a' },
            { text: ' and ', marks: { bold: true } },
            { mention: 'page-b' },
            { break: true },
            { mention: 'page-a' },
          ],
        }),
        makeBlock('code', 'c', {
          attrs: { language: 'ts' },
          content: [{ text: 'pnpm gate\npnpm bench' }],
        }),
        makeBlock('divider', 'd'),
        makeBlock('image', 'i', { attrs: { asset: 'sha256-1', alt: 'A chart', width: 640 } }),
      ],
    });
    const projection = projectPage(doc);
    expect(projection.title).toBe('Release process');
    expect(projection.meta).toEqual({ icon: 'rocket', cover: null, fullWidth: true });
    expect(
      projection.blocks.map(({ id, index, type, indent, attrs, text, mentions }) => ({
        id,
        index,
        type,
        indent,
        attrs,
        text,
        mentions,
      })),
    ).toEqual([
      {
        id: 'h',
        index: 0,
        type: 'heading',
        indent: 0,
        attrs: { level: 2 },
        text: 'Checklist',
        mentions: [],
      },
      {
        id: 't',
        index: 1,
        type: 'todo',
        indent: 1,
        attrs: { checked: true },
        text: 'Ask  and \n',
        mentions: ['page-a', 'page-b'],
      },
      {
        id: 'c',
        index: 2,
        type: 'code',
        indent: 0,
        attrs: { language: 'ts' },
        text: 'pnpm gate\npnpm bench',
        mentions: [],
      },
      { id: 'd', index: 3, type: 'divider', indent: 0, attrs: {}, text: '', mentions: [] },
      {
        id: 'i',
        index: 4,
        type: 'image',
        indent: 0,
        attrs: { asset: 'sha256-1', alt: 'A chart', width: 640, height: null },
        text: '',
        mentions: [],
      },
    ]);
    expect(linksOf(projection)).toEqual([
      { block: 't', page: 'page-a' },
      { block: 't', page: 'page-b' },
    ]);
    expect(searchTextOf(projection)).toBe(
      'Release process\nChecklist\nAsk  and \n\npnpm gate\npnpm bench\n\n',
    );
  });

  test('a missing or repeated block id gets a stable stand-in', () => {
    expect(effectiveIds(['a', 'b', 'a', '', undefined, 'a~2'])).toEqual([
      'a',
      'b',
      'a~2',
      'block~3',
      'block~4',
      'a~2~5',
    ]);
    // A stand-in that clashes with an id already used grows a `~` until it is unique.
    expect(effectiveIds(['x~2', 'x', 'x'])).toEqual(['x~2', 'x', 'x~2~']);
  });
});

type Edit =
  | { readonly kind: 'insert'; readonly at: number; readonly seed: number }
  | { readonly kind: 'delete'; readonly at: number }
  | { readonly kind: 'move'; readonly at: number; readonly to: number }
  | { readonly kind: 'content'; readonly at: number; readonly seed: number }
  | { readonly kind: 'indent'; readonly at: number; readonly indent: number }
  | { readonly kind: 'retype'; readonly at: number; readonly type: (typeof BLOCK_TYPES)[number] }
  | { readonly kind: 'copy-id'; readonly at: number; readonly from: number }
  | { readonly kind: 'title'; readonly title: string }
  | { readonly kind: 'meta'; readonly seed: number }
  | {
      readonly kind: 'type-text';
      readonly at: number;
      readonly offset: number;
      readonly text: string;
    }
  | {
      readonly kind: 'cut-text';
      readonly at: number;
      readonly offset: number;
      readonly length: number;
    };

const edit: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant('insert'), at: fc.nat(), seed: fc.nat() }),
  fc.record({ kind: fc.constant('delete'), at: fc.nat() }),
  fc.record({ kind: fc.constant('move'), at: fc.nat(), to: fc.nat() }),
  fc.record({ kind: fc.constant('content'), at: fc.nat(), seed: fc.nat() }),
  fc.record({ kind: fc.constant('indent'), at: fc.nat(), indent: fc.integer({ min: 0, max: 8 }) }),
  fc.record({ kind: fc.constant('retype'), at: fc.nat(), type: fc.constantFrom(...BLOCK_TYPES) }),
  fc.record({ kind: fc.constant('copy-id'), at: fc.nat(), from: fc.nat() }),
  fc.record({ kind: fc.constant('title'), title: fc.string({ maxLength: 6 }) }),
  fc.record({ kind: fc.constant('meta'), seed: fc.nat() }),
  fc.record({ kind: fc.constant('type-text'), at: fc.nat(), offset: fc.nat(), text }),
  fc.record({
    kind: fc.constant('cut-text'),
    at: fc.nat(),
    offset: fc.nat(),
    length: fc.integer({ min: 1, max: 4 }),
  }),
);

/** Draws one value from an arbitrary with a fixed seed, so edits stay reproducible. */
function sample<T>(arbitrary: fc.Arbitrary<T>, seed: number): T {
  const [value] = fc.sample(arbitrary, { seed, numRuns: 1 });
  if (value === undefined) throw new Error('fast-check returned no sample');
  return value;
}

/** The page as the doc holds it now, ready for an editor-style edit. */
function currentPage(doc: Y.Doc): Page {
  return projectionToPage(projectPage(doc));
}

describe('watchPage', () => {
  test("each transaction's changes rebuild exactly the full projection", () => {
    fc.assert(
      fc.property(page, fc.array(edit, { minLength: 1, maxLength: 25 }), (start, edits) => {
        const doc = new Y.Doc();
        writePage(doc, start);
        const fragment = doc.getXmlFragment(CONTENT_FIELD);
        const binding = { mapping: new Map(), isOMark: new Map() };

        let state = projectPage(doc);
        const rows = new Map<string, BlockRow>(state.blocks.map((row) => [row.id, row]));
        const apply = (change: PageChange) => {
          for (const id of change.removed) rows.delete(id);
          for (const row of change.upserted) rows.set(row.id, row);
          state = {
            title: change.title ?? state.title,
            meta: change.meta ?? state.meta,
            blocks: [...rows.values()].sort((a, b) => a.index - b.index),
          };
        };
        const watcher = watchPage(doc, apply);
        let nextId = 0;

        for (const step of edits) {
          const now = currentPage(doc);
          const blocks = [...now.blocks];
          const at = step.kind === 'title' || step.kind === 'meta' ? 0 : step.at % blocks.length;
          const target = blocks[at];
          if (target === undefined) continue;
          switch (step.kind) {
            case 'insert':
              blocks.splice(at, 0, sample(block(`new${nextId++}`), step.seed));
              break;
            case 'delete':
              if (blocks.length > 1) blocks.splice(at, 1);
              break;
            case 'move': {
              blocks.splice(at, 1);
              blocks.splice(step.to % (blocks.length + 1), 0, target);
              break;
            }
            case 'content':
              blocks[at] = makeBlock(target.type, target.id, {
                indent: target.indent,
                attrs: target.attrs,
                content: sample(fc.array(inline, { maxLength: 5 }), step.seed),
              });
              break;
            case 'indent':
              blocks[at] = { ...target, indent: step.indent };
              break;
            case 'retype':
              blocks[at] = makeBlock(step.type, target.id, {
                indent: target.indent,
                content: target.content,
              });
              break;
            case 'copy-id': {
              const source = blocks[step.from % blocks.length];
              if (source !== undefined) blocks[at] = { ...target, id: source.id };
              break;
            }
            case 'title':
            case 'meta':
            case 'type-text':
            case 'cut-text':
              break;
          }

          if (step.kind === 'meta') {
            doc.transact(() => writeMeta(doc, sample(meta, step.seed)));
          } else if (step.kind === 'type-text' || step.kind === 'cut-text') {
            // Edit Yjs directly, the way a remote replica's update arrives.
            const element = fragment.get(at + 1);
            const run =
              element instanceof Y.XmlElement
                ? element.toArray().find((child) => child instanceof Y.XmlText)
                : undefined;
            if (run instanceof Y.XmlText) {
              const offset = step.offset % (run.length + 1);
              if (step.kind === 'type-text') run.insert(offset, step.text);
              else run.delete(offset, Math.min(step.length, run.length - offset));
            }
          } else {
            const next: Page = {
              ...now,
              blocks,
              title: step.kind === 'title' ? step.title : now.title,
            };
            updateYFragment(doc, fragment, pageToNode(next), binding);
          }

          expect(state).toEqual(projectPage(doc));
          expect(watcher.current()).toEqual(projectPage(doc));
        }
        watcher.stop();
      }),
      { numRuns: 300 },
    );
  });
});
