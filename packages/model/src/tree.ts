// The page tree's pure projection. It takes every page's stored placement and returns the
// forest the app shows, repairing what concurrent edits can leave behind: pages whose parent
// no longer exists, and cycles from concurrent moves. It depends only on the set of pages,
// never on their order, so every replica holding the same pages shows the same tree.

export interface Placement {
  readonly parent: string | null;
  readonly order: string;
  /** When the page was placed: the later of now and one past the latest time seen. */
  readonly time: number;
  /** The Yjs client id of the replica that placed it. */
  readonly client: number;
}

export interface Trashed {
  readonly at: number;
  readonly client: number;
}

export interface PageEntry {
  readonly id: string;
  readonly placement: Placement;
  readonly trashed: Trashed | null;
  readonly created: number;
}

export type Repair = 'orphan' | 'cycle';

export interface TreeNode {
  readonly id: string;
  /** The parent the app shows, after repairs. */
  readonly parent: string | null;
  readonly order: string;
  readonly depth: number;
  /** Position among its siblings. */
  readonly index: number;
  /** True when the page or one of its ancestors is in the trash. */
  readonly trashed: boolean;
  /** Why the shown parent differs from the stored one, when it does. */
  readonly repair: Repair | null;
}

export interface Tree {
  readonly nodes: ReadonlyMap<string, TreeNode>;
  /** Top-level pages in display order. */
  readonly roots: readonly string[];
  /** Children in display order, for each page that has any. */
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** Every page, parents before children and siblings in display order. */
  readonly preorder: readonly string[];
}

export function childrenOf(tree: Tree, parent: string | null): readonly string[] {
  return parent === null ? tree.roots : (tree.children.get(parent) ?? []);
}

export function nodeOf(tree: Tree, id: string): TreeNode {
  const node = tree.nodes.get(id);
  if (node === undefined) throw new Error(`There is no page ${id}`);
  return node;
}

/** True when `a` was placed after `b`: a later time, then a larger client id, then a larger page id. */
export function placedAfter(a: PageEntry, b: PageEntry): boolean {
  const x = a.placement;
  const y = b.placement;
  if (x.time !== y.time) return x.time > y.time;
  if (x.client !== y.client) return x.client > y.client;
  return a.id > b.id;
}

function compareSiblings(a: PageEntry, b: PageEntry): number {
  if (a.placement.order !== b.placement.order)
    return a.placement.order < b.placement.order ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function projectTree(entries: Iterable<PageEntry>): Tree {
  const pages = new Map<string, PageEntry>();
  for (const entry of entries) pages.set(entry.id, entry);
  const entryOf = (id: string): PageEntry => {
    const entry = pages.get(id);
    if (entry === undefined) throw new Error(`There is no page ${id}`);
    return entry;
  };

  // A page whose parent no longer exists goes to the top level.
  const parentOf = new Map<string, string | null>();
  const repairs = new Map<string, Repair>();
  for (const [id, { placement }] of pages) {
    if (placement.parent !== null && !pages.has(placement.parent)) {
      parentOf.set(id, null);
      repairs.set(id, 'orphan');
    } else {
      parentOf.set(id, placement.parent);
    }
  }

  // Each page has at most one parent, so each connected group holds at most one cycle.
  // Walking up from every page finds each cycle once, and breaking it at its most recent mover
  // gives the same answer wherever the walk started.
  const onPath = new Set<string>();
  const done = new Set<string>();
  for (const start of pages.keys()) {
    if (done.has(start)) continue;
    const path: string[] = [];
    let current: string | null = start;
    while (current !== null && !onPath.has(current) && !done.has(current)) {
      onPath.add(current);
      path.push(current);
      current = parentOf.get(current) ?? null;
    }
    if (current !== null && onPath.has(current)) {
      const cycle = path.slice(path.indexOf(current));
      let mover = current;
      for (const id of cycle) if (placedAfter(entryOf(id), entryOf(mover))) mover = id;
      parentOf.set(mover, null);
      repairs.set(mover, 'cycle');
    }
    for (const id of path) {
      onPath.delete(id);
      done.add(id);
    }
  }

  const roots: string[] = [];
  const children = new Map<string, string[]>();
  for (const [id, parent] of parentOf) {
    if (parent === null) {
      roots.push(id);
      continue;
    }
    let siblings = children.get(parent);
    if (siblings === undefined) {
      siblings = [];
      children.set(parent, siblings);
    }
    siblings.push(id);
  }
  const bySiblingOrder = (a: string, b: string) => compareSiblings(entryOf(a), entryOf(b));
  roots.sort(bySiblingOrder);
  for (const siblings of children.values()) siblings.sort(bySiblingOrder);

  // Walk the forest without recursion, so a deep chain of pages can't overflow the stack.
  const nodes = new Map<string, TreeNode>();
  const preorder: string[] = [];
  const stack: { id: string; depth: number; index: number; inTrash: boolean }[] = [];
  const pushAll = (ids: readonly string[], depth: number, inTrash: boolean) => {
    for (let index = ids.length - 1; index >= 0; index--) {
      const id = ids[index];
      if (id !== undefined) stack.push({ id, depth, index, inTrash });
    }
  };
  pushAll(roots, 0, false);
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const entry = entryOf(item.id);
    const trashed = item.inTrash || entry.trashed !== null;
    nodes.set(item.id, {
      id: item.id,
      parent: parentOf.get(item.id) ?? null,
      order: entry.placement.order,
      depth: item.depth,
      index: item.index,
      trashed,
      repair: repairs.get(item.id) ?? null,
    });
    preorder.push(item.id);
    pushAll(children.get(item.id) ?? [], item.depth + 1, trashed);
  }

  return { nodes, roots, children, preorder };
}
