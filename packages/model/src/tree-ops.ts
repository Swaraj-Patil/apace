// Operations on the page tree in the workspace doc. Each runs in one Yjs transaction. A move
// writes only the page's placement, a single value, so concurrent moves never mix the parent
// of one with the order key of another.
import * as Y from 'yjs';
import { randomId } from './ids.ts';
import { orderKeyBetween } from './order.ts';
import {
  childrenOf,
  nodeOf,
  type PageEntry,
  type Placement,
  projectTree,
  type Trashed,
  type Tree,
} from './tree.ts';

export interface TreeEnv {
  /** Wall-clock milliseconds. */
  readonly now: () => number;
  readonly newId: () => string;
}

export const systemEnv: TreeEnv = { now: () => Date.now(), newId: randomId };

/**
 * Where a page goes: under `parent`, right after the sibling `after`. A null `after` means first
 * among the siblings; leaving it out means last.
 */
export interface Position {
  readonly parent: string | null;
  readonly after?: string | null | undefined;
}

export function pagesOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('pages');
}

/** Every page in the doc. Malformed values read as a top-level page with an empty order key. */
export function readEntries(doc: Y.Doc): PageEntry[] {
  const entries: PageEntry[] = [];
  for (const [id, page] of pagesOf(doc)) {
    if (!(page instanceof Y.Map)) continue;
    entries.push({
      id,
      placement: asPlacement(page.get('placement')),
      trashed: asTrashed(page.get('trashed')),
      created: asNumber(page.get('created')),
    });
  }
  return entries;
}

export function readTree(doc: Y.Doc): Tree {
  return projectTree(readEntries(doc));
}

export function createPage(doc: Y.Doc, position: Position, env: TreeEnv = systemEnv): string {
  const entries = readEntries(doc);
  const tree = projectTree(entries);
  if (position.parent !== null) nodeOf(tree, position.parent);
  const id = env.newId();
  const time = nextTime(entries, env.now());
  doc.transact(() => {
    const order = makeRoom(doc, tree, position, null, time);
    const page = new Y.Map<unknown>();
    page.set('placement', placement(doc, position.parent, order, time));
    page.set('trashed', null);
    page.set('created', time);
    pagesOf(doc).set(id, page);
  });
  return id;
}

export function movePage(
  doc: Y.Doc,
  id: string,
  position: Position,
  env: TreeEnv = systemEnv,
): void {
  const entries = readEntries(doc);
  const tree = projectTree(entries);
  const node = nodeOf(tree, id);
  if (position.parent !== null) {
    nodeOf(tree, position.parent);
    if (isSelfOrDescendant(tree, position.parent, id)) {
      throw new Error('A page cannot move into itself or one of its own subpages');
    }
  }
  if (node.repair === null && position.parent === node.parent) {
    const siblings = childrenOf(tree, node.parent);
    const previous = node.index > 0 ? (siblings[node.index - 1] ?? null) : null;
    const isLast = node.index === siblings.length - 1;
    if (position.after === undefined ? isLast : position.after === previous) return;
  }
  const time = nextTime(entries, env.now());
  doc.transact(() => {
    const order = makeRoom(doc, tree, position, id, time);
    pageMap(doc, id).set('placement', placement(doc, position.parent, order, time));
  });
}

/** Puts the page in the trash. Its subpages go with it, since they inherit the state. */
export function trashPage(doc: Y.Doc, id: string, env: TreeEnv = systemEnv): void {
  const entries = readEntries(doc);
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`There is no page ${id}`);
  if (entry.trashed !== null) return;
  const trashed: Trashed = { at: nextTime(entries, env.now()), client: doc.clientID };
  doc.transact(() => pageMap(doc, id).set('trashed', trashed));
}

/**
 * Takes the page out of the trash. It goes back under its parent if that parent is still out
 * of the trash, and to the end of the top level otherwise.
 */
export function restorePage(doc: Y.Doc, id: string, env: TreeEnv = systemEnv): void {
  const entries = readEntries(doc);
  const tree = projectTree(entries);
  const node = nodeOf(tree, id);
  if (!node.trashed) return;
  const ownFlag = entries.find((entry) => entry.id === id)?.trashed ?? null;
  const parentInTrash = node.parent !== null && nodeOf(tree, node.parent).trashed;
  const time = nextTime(entries, env.now());
  doc.transact(() => {
    const page = pageMap(doc, id);
    if (ownFlag !== null) page.set('trashed', null);
    if (parentInTrash) {
      const order = makeRoom(doc, tree, { parent: null }, id, time);
      page.set('placement', placement(doc, null, order, time));
    }
  });
}

/** Deletes a page in the trash, with all its subpages, for good. Returns the deleted ids. */
export function purgePage(doc: Y.Doc, id: string): string[] {
  const tree = readTree(doc);
  if (!nodeOf(tree, id).trashed) throw new Error('Only pages in the trash can be deleted for good');
  const doomed = [id, ...descendantsOf(tree, id)];
  doc.transact(() => {
    const pages = pagesOf(doc);
    for (const page of doomed) pages.delete(page);
  });
  return doomed;
}

export function descendantsOf(tree: Tree, id: string): string[] {
  const found: string[] = [];
  const stack = [...(tree.children.get(id) ?? [])];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    found.push(next);
    stack.push(...(tree.children.get(next) ?? []));
  }
  return found;
}

/** A time later than every time in the doc, so a move made after another sorts after it. */
function nextTime(entries: readonly PageEntry[], now: number): number {
  let latest = 0;
  for (const entry of entries) {
    latest = Math.max(latest, entry.placement.time, entry.trashed?.at ?? 0, entry.created);
  }
  return Math.max(now, latest + 1);
}

/**
 * The order key for a page entering `position`. When the neighbours on either side of the gap
 * share a key, which happens when two replicas insert at the same spot at once, the tied
 * siblings after the gap get fresh keys first so the new key has room.
 */
function makeRoom(
  doc: Y.Doc,
  tree: Tree,
  position: Position,
  moving: string | null,
  time: number,
): string {
  const siblings = childrenOf(tree, position.parent).filter((sibling) => sibling !== moving);
  let index = siblings.length;
  if (position.after === null) {
    index = 0;
  } else if (position.after !== undefined) {
    const at = siblings.indexOf(position.after);
    if (at === -1) throw new Error(`${position.after} is not a sibling at that position`);
    index = at + 1;
  }
  const orderAt = (at: number): string | null => {
    const sibling = siblings[at];
    return sibling === undefined ? null : nodeOf(tree, sibling).order;
  };
  const before = orderAt(index - 1);
  let after = orderAt(index);
  if (before !== null && after === before) {
    let end = index;
    while (orderAt(end) === before) end++;
    const upper = orderAt(end);
    let key = before;
    for (let at = index; at < end; at++) {
      key = orderKeyBetween(key, upper);
      const sibling = siblings[at];
      if (sibling === undefined) continue;
      pageMap(doc, sibling).set('placement', placement(doc, position.parent, key, time));
      if (at === index) after = key;
    }
  }
  return orderKeyBetween(before, after);
}

function isSelfOrDescendant(tree: Tree, candidate: string, ancestor: string): boolean {
  for (let id: string | null = candidate; id !== null; id = nodeOf(tree, id).parent) {
    if (id === ancestor) return true;
  }
  return false;
}

function placement(doc: Y.Doc, parent: string | null, order: string, time: number): Placement {
  return { parent, order, time, client: doc.clientID };
}

function pageMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  const page = pagesOf(doc).get(id);
  if (!(page instanceof Y.Map)) throw new Error(`There is no page ${id}`);
  return page;
}

function asPlacement(value: unknown): Placement {
  if (typeof value === 'object' && value !== null) {
    const { parent, order, time, client } = value as Record<string, unknown>;
    if (
      (parent === null || typeof parent === 'string') &&
      typeof order === 'string' &&
      typeof time === 'number' &&
      typeof client === 'number'
    ) {
      return { parent, order, time, client };
    }
  }
  return { parent: null, order: '', time: 0, client: 0 };
}

function asTrashed(value: unknown): Trashed | null {
  if (typeof value !== 'object' || value === null) return null;
  const { at, client } = value as Record<string, unknown>;
  return typeof at === 'number' && typeof client === 'number' ? { at, client } : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
