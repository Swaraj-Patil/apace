import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { type PageEntry, projectTree, type Tree } from './tree.ts';
import { forestProblems } from './tree-check.ts';

function page(
  id: string,
  parent: string | null,
  order = 'a0',
  { time = 1, client = 1, trashed = false } = {},
): PageEntry {
  return {
    id,
    placement: { parent, order, time, client },
    trashed: trashed ? { at: 1, client: 1 } : null,
    created: 1,
  };
}

function shape(tree: Tree) {
  return {
    preorder: tree.preorder,
    nodes: [...tree.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

describe('projectTree', () => {
  test('siblings sort by order key, then by id', () => {
    const tree = projectTree([page('b', null, 'a1'), page('c', null, 'a0'), page('a', null, 'a1')]);
    expect(tree.roots).toEqual(['c', 'a', 'b']);
    expect(tree.nodes.get('b')).toMatchObject({ index: 2, depth: 0, repair: null });
  });

  test('a page whose parent is gone goes to the top level', () => {
    const tree = projectTree([page('a', null), page('b', 'gone')]);
    expect(tree.roots).toEqual(['a', 'b']);
    expect(tree.nodes.get('b')).toMatchObject({ parent: null, repair: 'orphan' });
  });

  test('a two-page cycle sends its most recent mover to the top level', () => {
    const tree = projectTree([
      page('a', 'b', 'a0', { time: 5 }),
      page('b', 'a', 'a0', { time: 7 }),
    ]);
    expect(tree.roots).toEqual(['b']);
    expect(tree.children.get('b')).toEqual(['a']);
    expect(tree.nodes.get('b')?.repair).toBe('cycle');
    expect(tree.nodes.get('a')?.repair).toBeNull();
  });

  test('a three-page cycle does the same', () => {
    const tree = projectTree([
      page('a', 'b', 'a0', { time: 3 }),
      page('b', 'c', 'a0', { time: 9 }),
      page('c', 'a', 'a0', { time: 4 }),
    ]);
    expect(tree.preorder).toEqual(['b', 'a', 'c']);
    expect(tree.nodes.get('c')).toMatchObject({ parent: 'a', depth: 2 });
  });

  test('equal times fall back to the client id, then to the page id', () => {
    const byClient = projectTree([
      page('a', 'b', 'a0', { time: 5, client: 2 }),
      page('b', 'a', 'a0', { time: 5, client: 1 }),
    ]);
    expect(byClient.roots).toEqual(['a']);
    const byId = projectTree([
      page('a', 'b', 'a0', { time: 5 }),
      page('b', 'a', 'a0', { time: 5 }),
    ]);
    expect(byId.roots).toEqual(['b']);
  });

  test('pages hanging off a cycle stay where they were', () => {
    const tree = projectTree([
      page('a', 'b', 'a0', { time: 2 }),
      page('b', 'a', 'a0', { time: 1 }),
      page('tail', 'a', 'a1'),
    ]);
    expect(tree.preorder).toEqual(['a', 'b', 'tail']);
    expect(tree.children.get('a')).toEqual(['b', 'tail']);
  });

  test('a page that is its own parent goes to the top level', () => {
    const tree = projectTree([page('a', 'a')]);
    expect(tree.nodes.get('a')).toMatchObject({ parent: null, repair: 'cycle' });
  });

  test('a cycle through a trashed page leaves the trash where the repaired tree puts it', () => {
    const tree = projectTree([
      page('a', 'b', 'a0', { time: 9, trashed: true }),
      page('b', 'a', 'a0', { time: 1 }),
    ]);
    expect(tree.roots).toEqual(['a']);
    expect(tree.nodes.get('a')?.trashed).toBe(true);
    expect(tree.nodes.get('b')?.trashed).toBe(true);
  });

  test('the trash covers every page below a trashed one, and nothing above it', () => {
    const tree = projectTree([
      page('a', null),
      page('b', 'a', 'a0', { trashed: true }),
      page('c', 'b'),
      page('d', 'c'),
    ]);
    expect(['a', 'b', 'c', 'd'].map((id) => tree.nodes.get(id)?.trashed)).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(tree.nodes.get('d')?.depth).toBe(3);
  });

  const pool = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
  const entries = fc.uniqueArray(
    fc.record({
      id: fc.constantFrom(...pool),
      parent: fc.constantFrom(null, 'gone', ...pool),
      order: fc.constantFrom('a0', 'a1', 'a1V', 'a2', 'Zz'),
      time: fc.integer({ min: 0, max: 5 }),
      client: fc.integer({ min: 1, max: 3 }),
      trashed: fc.boolean(),
    }),
    { selector: (entry) => entry.id, maxLength: pool.length },
  );
  const toEntries = (
    records: {
      id: string;
      parent: string | null;
      order: string;
      time: number;
      client: number;
      trashed: boolean;
    }[],
  ) => records.map((r) => page(r.id, r.parent, r.order, r));

  test('any set of pages projects to a valid forest holding every page once', () => {
    fc.assert(
      fc.property(entries, (records) => {
        const pages = toEntries(records);
        expect(
          forestProblems(
            projectTree(pages),
            pages.map((p) => p.id),
          ),
        ).toEqual([]);
      }),
      { numRuns: 2000 },
    );
  });

  test('the order of the input never changes the tree', () => {
    fc.assert(
      fc.property(
        entries.chain((records) =>
          fc.tuple(
            fc.constant(records),
            fc.shuffledSubarray(records, { minLength: records.length, maxLength: records.length }),
          ),
        ),
        ([records, shuffled]) => {
          expect(shape(projectTree(toEntries(shuffled)))).toEqual(
            shape(projectTree(toEntries(records))),
          );
        },
      ),
      { numRuns: 2000 },
    );
  });
});
