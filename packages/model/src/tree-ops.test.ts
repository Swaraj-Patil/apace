import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { childrenOf, nodeOf, type Tree } from './tree.ts';
import { forestProblems } from './tree-check.ts';
import {
  createPage,
  movePage,
  pagesOf,
  purgePage,
  readEntries,
  readTree,
  restorePage,
  type TreeEnv,
  trashPage,
} from './tree-ops.ts';

function replica(clientID: number): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  return doc;
}

function sync(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

function syncAll(docs: readonly Y.Doc[]): void {
  for (const from of docs) for (const to of docs) if (from !== to) sync(from, to);
}

/** A shared clock that ticks on every read, so later edits always carry later wall times. */
function clock() {
  let tick = 0;
  return (prefix: string, skew = 0): TreeEnv => {
    let count = 0;
    return { now: () => ++tick * 10 + skew, newId: () => `${prefix}${count++}` };
  };
}

function shape(tree: Tree) {
  return {
    preorder: tree.preorder,
    nodes: [...tree.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

function isWithin(tree: Tree, candidate: string, root: string): boolean {
  for (let id: string | null = candidate; id !== null; id = nodeOf(tree, id).parent) {
    if (id === root) return true;
  }
  return false;
}

describe('tree operations', () => {
  test('create puts a page last, first, or right after a sibling', () => {
    const doc = replica(1);
    const env = clock()('p');
    const a = createPage(doc, { parent: null }, env);
    const b = createPage(doc, { parent: null }, env);
    const c = createPage(doc, { parent: null, after: null }, env);
    const d = createPage(doc, { parent: null, after: a }, env);
    const e = createPage(doc, { parent: d }, env);
    const tree = readTree(doc);
    expect(tree.roots).toEqual([c, a, d, b]);
    expect(tree.children.get(d)).toEqual([e]);
    expect(forestProblems(tree, [a, b, c, d, e])).toEqual([]);
  });

  test('move re-parents and reorders, and refuses to move a page into its own subpages', () => {
    const doc = replica(1);
    const env = clock()('p');
    const a = createPage(doc, { parent: null }, env);
    const b = createPage(doc, { parent: a }, env);
    const c = createPage(doc, { parent: b }, env);
    expect(() => movePage(doc, a, { parent: c }, env)).toThrow('its own subpages');
    expect(() => movePage(doc, a, { parent: a }, env)).toThrow('its own subpages');
    movePage(doc, c, { parent: null, after: null }, env);
    movePage(doc, b, { parent: null }, env);
    expect(readTree(doc).roots).toEqual([c, a, b]);
  });

  test('moving a page to where it already is writes nothing', () => {
    const doc = replica(1);
    const env = clock()('p');
    const a = createPage(doc, { parent: null }, env);
    const b = createPage(doc, { parent: null }, env);
    let updates = 0;
    doc.on('update', () => updates++);
    movePage(doc, b, { parent: null }, env);
    movePage(doc, b, { parent: null, after: a }, env);
    movePage(doc, a, { parent: null, after: null }, env);
    expect(updates).toBe(0);
    movePage(doc, a, { parent: null }, env);
    expect(updates).toBe(1);
    expect(readTree(doc).roots).toEqual([b, a]);
  });

  test('a page created between two siblings that share a key lands between them', () => {
    const [one, two] = [replica(1), replica(2)];
    const envs = clock();
    const [env1, env2] = [envs('one-'), envs('two-')];
    const first = createPage(one, { parent: null }, env1);
    sync(one, two);
    const fromOne = createPage(one, { parent: null, after: first }, env1);
    const fromTwo = createPage(two, { parent: null, after: first }, env2);
    syncAll([one, two]);
    const tied = readTree(one);
    expect(tied.roots).toEqual([first, fromOne, fromTwo]);
    expect(nodeOf(tied, fromOne).order).toBe(nodeOf(tied, fromTwo).order);

    const between = createPage(one, { parent: null, after: fromOne }, env1);
    const tree = readTree(one);
    expect(tree.roots).toEqual([first, fromOne, between, fromTwo]);
    const orders = tree.roots.map((id) => nodeOf(tree, id).order);
    expect(orders.every((order, i) => i === 0 || (orders[i - 1] ?? '') < order)).toBe(true);
  });

  test('trash takes the subpages along, and restore brings them back under a live parent', () => {
    const doc = replica(1);
    const env = clock()('p');
    const a = createPage(doc, { parent: null }, env);
    const b = createPage(doc, { parent: a }, env);
    const c = createPage(doc, { parent: b }, env);
    trashPage(doc, b, env);
    let tree = readTree(doc);
    expect([a, b, c].map((id) => nodeOf(tree, id).trashed)).toEqual([false, true, true]);
    restorePage(doc, b, env);
    tree = readTree(doc);
    expect([a, b, c].map((id) => nodeOf(tree, id).trashed)).toEqual([false, false, false]);
    expect(nodeOf(tree, b).parent).toBe(a);
  });

  test('restoring a page whose parent is in the trash puts it at the end of the top level', () => {
    const doc = replica(1);
    const env = clock()('p');
    const a = createPage(doc, { parent: null }, env);
    const b = createPage(doc, { parent: a }, env);
    const other = createPage(doc, { parent: null }, env);
    trashPage(doc, a, env);
    restorePage(doc, b, env);
    const tree = readTree(doc);
    expect(tree.roots).toEqual([a, other, b]);
    expect(nodeOf(tree, b).trashed).toBe(false);
    expect(nodeOf(tree, a).trashed).toBe(true);
  });

  test('delete for good takes the subpages too, and only works on pages in the trash', () => {
    const doc = replica(1);
    const env = clock()('p');
    const a = createPage(doc, { parent: null }, env);
    const b = createPage(doc, { parent: a }, env);
    expect(() => purgePage(doc, a)).toThrow('Only pages in the trash');
    trashPage(doc, a, env);
    expect(purgePage(doc, a).sort()).toEqual([a, b].sort());
    expect(readEntries(doc)).toEqual([]);
  });

  test('a page restored after its parent was deleted elsewhere lands at the top level', () => {
    const [one, two] = [replica(1), replica(2)];
    const envs = clock();
    const [env1, env2] = [envs('one-'), envs('two-')];
    const parent = createPage(one, { parent: null }, env1);
    sync(one, two);
    trashPage(one, parent, env1);
    purgePage(one, parent);
    const late = createPage(two, { parent }, env2);
    trashPage(two, late, env2);
    syncAll([one, two]);
    expect(nodeOf(readTree(one), late)).toMatchObject({
      parent: null,
      repair: 'orphan',
      trashed: true,
    });
    restorePage(one, late, env1);
    syncAll([one, two]);
    for (const doc of [one, two]) {
      expect(nodeOf(readTree(doc), late)).toMatchObject({ parent: null, trashed: false });
    }
  });

  test('a move made after seeing a later clock still sorts after it', () => {
    const [one, two] = [replica(1), replica(2)];
    const envs = clock();
    const fast = envs('fast-', 1_000_000);
    const slow = envs('slow-');
    const a = createPage(one, { parent: null }, slow);
    const b = createPage(one, { parent: null }, slow);
    const c = createPage(one, { parent: null }, slow);
    sync(one, two);
    movePage(two, a, { parent: b }, fast);
    sync(two, one);
    movePage(one, c, { parent: null, after: null }, slow);
    const entries = readEntries(one);
    const timeOf = (id: string) => entries.find((entry) => entry.id === id)?.placement.time ?? 0;
    expect(timeOf(a)).toBeGreaterThan(1_000_000);
    expect(timeOf(c)).toBeGreaterThan(timeOf(a));
  });

  test('two replicas moving two pages under each other repair to the same tree', () => {
    const [one, two] = [replica(1), replica(2)];
    const envs = clock();
    const [env1, env2] = [envs('one-'), envs('two-')];
    const a = createPage(one, { parent: null }, env1);
    const b = createPage(one, { parent: null }, env1);
    sync(one, two);
    movePage(one, a, { parent: b }, env1);
    movePage(two, b, { parent: a }, env2);
    syncAll([one, two]);
    for (const doc of [one, two]) {
      const tree = readTree(doc);
      expect(tree.preorder).toEqual([b, a]);
      expect(nodeOf(tree, b).repair).toBe('cycle');
    }
  });

  test('three replicas closing a three-page cycle repair to the same tree', () => {
    const docs = [replica(1), replica(2), replica(3)];
    const envs = clock();
    const [e1, e2, e3] = [envs('one-'), envs('two-'), envs('three-')];
    const a = createPage(docs[0] as Y.Doc, { parent: null }, e1);
    const b = createPage(docs[0] as Y.Doc, { parent: null }, e1);
    const c = createPage(docs[0] as Y.Doc, { parent: null }, e1);
    syncAll(docs);
    movePage(docs[0] as Y.Doc, a, { parent: b }, e1);
    movePage(docs[1] as Y.Doc, b, { parent: c }, e2);
    movePage(docs[2] as Y.Doc, c, { parent: a }, e3);
    syncAll(docs);
    for (const doc of docs) {
      const tree = readTree(doc);
      expect(tree.preorder).toEqual([c, b, a]);
      expect(forestProblems(tree, [a, b, c])).toEqual([]);
    }
  });
});

type Kind = 'create' | 'move' | 'trash' | 'restore' | 'purge' | 'sync';
interface Command {
  readonly replica: number;
  readonly kind: Kind;
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

const command: fc.Arbitrary<Command> = fc.record({
  replica: fc.nat(),
  // Moves dominate because concurrent moves make cycles. Creating, trashing and purging stay
  // common because a purge racing an edit beneath it makes orphans.
  kind: fc.constantFrom<Kind>(
    'create',
    'create',
    'create',
    'move',
    'move',
    'move',
    'move',
    'move',
    'move',
    'trash',
    'trash',
    'trash',
    'restore',
    'purge',
    'purge',
    'purge',
    'sync',
  ),
  a: fc.nat(),
  b: fc.nat(),
  c: fc.nat(),
});

function pick<T>(items: readonly T[], n: number): T | undefined {
  return items.length === 0 ? undefined : items[n % items.length];
}

/** Turns a placement choice into a Position: 'last' leaves `after` out, 'first' makes it null. */
function after(choice: string | undefined): string | null | undefined {
  if (choice === 'first') return null;
  return choice === 'last' ? undefined : choice;
}

describe('convergence', () => {
  test('replicas that edit apart and sync in any order end with the same state and tree', () => {
    let runsWithCycles = 0;
    let runsWithOrphans = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.array(fc.integer({ min: -50, max: 50 }), { minLength: 5, maxLength: 5 }),
        fc.array(command, { maxLength: 60 }),
        (count, skews, commands) => {
          const docs = Array.from({ length: count }, (_, i) => replica(i + 1));
          const envs = clock();
          const replicaEnvs = docs.map((_, i) => envs(`r${i}-`, (skews[i] ?? 0) * 10));
          const base = docs[0] as Y.Doc;
          const baseEnv = replicaEnvs[0] as TreeEnv;
          const top = createPage(base, { parent: null }, baseEnv);
          const side = createPage(base, { parent: null }, baseEnv);
          createPage(base, { parent: top }, baseEnv);
          createPage(base, { parent: top }, baseEnv);
          createPage(base, { parent: side }, baseEnv);
          syncAll(docs);

          for (const step of commands) {
            const index = step.replica % count;
            const doc = docs[index] as Y.Doc;
            const env = replicaEnvs[index] as TreeEnv;
            const tree = readTree(doc);
            const ids = tree.preorder;
            const trashed = ids.filter((id) => nodeOf(tree, id).trashed);
            switch (step.kind) {
              case 'create': {
                const parent = pick([null, ...ids], step.a) ?? null;
                const slot = pick(['last', 'first', ...childrenOf(tree, parent)], step.b);
                createPage(doc, { parent, after: after(slot) }, env);
                break;
              }
              case 'move': {
                const id = pick(ids, step.a);
                const parent = pick([null, ...ids], step.b) ?? null;
                if (id === undefined || (parent !== null && isWithin(tree, parent, id))) break;
                const siblings = childrenOf(tree, parent).filter((sibling) => sibling !== id);
                movePage(
                  doc,
                  id,
                  { parent, after: after(pick(['last', 'first', ...siblings], step.c)) },
                  env,
                );
                break;
              }
              case 'trash': {
                const id = pick(ids, step.a);
                if (id !== undefined) trashPage(doc, id, env);
                break;
              }
              case 'restore': {
                const id = pick(trashed, step.a);
                if (id !== undefined) restorePage(doc, id, env);
                break;
              }
              case 'purge': {
                const id = pick(trashed, step.a);
                if (id !== undefined) purgePage(doc, id);
                break;
              }
              case 'sync': {
                const from = docs[step.a % count] as Y.Doc;
                const to = docs[step.b % count] as Y.Doc;
                if (from !== to) sync(from, to);
                break;
              }
            }
          }

          syncAll(docs);
          const trees = docs.map(readTree);
          const first = trees[0] as Tree;
          for (const doc of docs) {
            expect(Y.encodeStateVector(doc)).toEqual(Y.encodeStateVector(base));
            expect(pagesOf(doc).toJSON()).toEqual(pagesOf(base).toJSON());
          }
          for (const tree of trees) expect(shape(tree)).toEqual(shape(first));
          expect(
            forestProblems(
              first,
              readEntries(base).map((entry) => entry.id),
            ),
          ).toEqual([]);
          const repairs = [...first.nodes.values()].map((node) => node.repair);
          if (repairs.includes('cycle')) runsWithCycles++;
          if (repairs.includes('orphan')) runsWithOrphans++;
        },
      ),
      { numRuns: 1000 },
    );
    // The generator has to reach the repairs, or the property proves less than it claims.
    // About 25 runs in 1,000 end with each repair, so a floor of 5 can't fail by chance.
    expect(runsWithCycles).toBeGreaterThanOrEqual(5);
    expect(runsWithOrphans).toBeGreaterThanOrEqual(5);
  });
});
