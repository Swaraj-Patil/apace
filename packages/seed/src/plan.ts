// The workspace's plan: the shape of the tree, each page's size and meta, and which pages play
// special parts in the bench. It's cheap to compute, so any single page can be generated
// without generating the others.
import { orderKeyBetween } from '@apace/model';
import { type SeedAsset, seedAssets } from './assets.ts';
import { idFrom, type Random, stream } from './random.ts';
import { PAGE_ICONS, PLANTED } from './words.ts';

export const PAGE_COUNT = 2000;
export const TOP_LEVEL_PAGES = 12;
export const MAX_DEPTH = 8;
export const MEDIAN_BLOCKS = 30;
export const LARGE_PAGE_BLOCKS = 3000;
export const TRASHED_PAGES = 150;
export const FAVORITE_PAGES = 12;
export const HUB_PAGES = 5;
/** Every page whose index is a multiple of this mentions the main hub. */
export const HUB_EVERY = 5;
export const PAGE_OPEN_TARGETS = 60;
/** How many pages sit at each depth from 1 to 8, as relative weights. */
const DEPTH_WEIGHTS = [
  [1, 14],
  [2, 24],
  [3, 24],
  [4, 16],
  [5, 10],
  [6, 6],
  [7, 4],
  [8, 2],
] as const;
/** Every generated time counts from here: Monday 5 January 2026, 09:00 UTC. */
export const EPOCH = Date.UTC(2026, 0, 5, 9, 0, 0);
export const MINUTE = 60_000;
export const DAY = 86_400_000;

export interface PagePlan {
  readonly index: number;
  readonly id: string;
  /** The parent's index, or null at the top level. */
  readonly parent: number | null;
  readonly depth: number;
  readonly order: string;
  readonly blockCount: number;
  readonly created: number;
  /** When the page went to the trash, or null if it isn't there. */
  readonly trashedAt: number | null;
  /** The planted word in this page's title, if it has one. */
  readonly planted: string | null;
  readonly icon: string | null;
  readonly cover: string | null;
  readonly fullWidth: boolean;
}

export interface WorkspacePlan {
  readonly seed: number;
  /** The Yjs client id that writes every seeded doc. */
  readonly client: number;
  readonly pages: readonly PagePlan[];
  readonly assets: readonly SeedAsset[];
  readonly large: number;
  readonly typing: number;
  readonly deep: number;
  /** Pages many others mention. The first is the main hub, with 300+ backlinks. */
  readonly hubs: readonly number[];
  /** Pages a mention can point at: every page outside the trash. */
  readonly mentionable: readonly number[];
  readonly favorites: readonly number[];
  readonly openTargets: readonly number[];
}

export function pageId(seed: number, index: number): string {
  return idFrom(stream(seed, 'page-id', index), 16);
}

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

export function planWorkspace(seed: number): WorkspacePlan {
  const structure = stream(seed, 'structure');
  const parents: (number | null)[] = [];
  const depths: number[] = [];
  const atDepth: number[][] = Array.from({ length: MAX_DEPTH + 1 }, () => []);
  // Each page's parent, listed once per child, so picking from it favours big families.
  const families: number[][] = Array.from({ length: MAX_DEPTH + 1 }, () => []);
  for (let i = 0; i < PAGE_COUNT; i++) {
    let parent: number | null = null;
    if (i >= TOP_LEVEL_PAGES && i < TOP_LEVEL_PAGES + MAX_DEPTH) {
      // A chain under the first page reaches the deepest level.
      parent = i === TOP_LEVEL_PAGES ? 0 : i - 1;
    } else if (i >= TOP_LEVEL_PAGES + MAX_DEPTH) {
      // Pick the depth first, so most pages sit two or three levels down, then a parent one
      // level up. Half the time that parent is drawn by its number of children, which skews
      // the fan-out the way real workspaces are skewed.
      const level = structure.weighted(DEPTH_WEIGHTS) - 1;
      const family = families[level] ?? [];
      parent =
        family.length > 0 && structure.chance(0.5)
          ? structure.pick(family)
          : structure.pick(atDepth[level] ?? []);
    }
    const depth = parent === null ? 0 : (depths[parent] ?? 0) + 1;
    parents.push(parent);
    depths.push(depth);
    atDepth[depth]?.push(i);
    if (parent !== null) families[depth - 1]?.push(parent);
  }
  const depth = (i: number) => depths[i] ?? 0;
  const childCount = new Array<number>(PAGE_COUNT).fill(0);
  for (const parent of parents) {
    if (parent !== null) childCount[parent] = (childCount[parent] ?? 0) + 1;
  }

  // Sizes are log-normal around the median, as real pages are: mostly short, a few long.
  const blockCounts = Array.from({ length: PAGE_COUNT }, (_, i) => {
    const size = Math.exp(stream(seed, 'size', i).normal(Math.log(MEDIAN_BLOCKS), 0.8));
    return Math.min(400, Math.max(3, Math.round(size)));
  });

  const deep = TOP_LEVEL_PAGES + MAX_DEPTH - 1;
  const large = depths.findIndex((d, i) => i > deep && d === 2);
  blockCounts[large] = LARGE_PAGE_BLOCKS;
  const typing = blockCounts.findIndex(
    (count, i) =>
      i > deep && i !== large && depth(i) >= 1 && depth(i) <= 3 && count >= 35 && count <= 45,
  );

  const reserved = new Set([deep, large, typing]);
  const hubs = shuffled(
    depths.flatMap((d, i) => (d <= 1 && !reserved.has(i) ? [i] : [])),
    stream(seed, 'hubs'),
  ).slice(0, HUB_PAGES);
  for (const hub of hubs) reserved.add(hub);

  const planted = shuffled(
    depths.flatMap((_, i) => (i > deep && !reserved.has(i) ? [i] : [])),
    stream(seed, 'planted'),
  ).slice(0, PLANTED.length);
  const plantedWord = new Map(planted.map((index, n) => [index, PLANTED[n] ?? null]));
  for (const index of planted) reserved.add(index);

  // Only leaves go in the trash, so exactly this many pages end up in it.
  const trashed = new Set(
    shuffled(
      childCount.flatMap((count, i) => (count === 0 && !reserved.has(i) ? [i] : [])),
      stream(seed, 'trash'),
    ).slice(0, TRASHED_PAGES),
  );

  const extraFavorites = shuffled(
    depths.flatMap((d, i) => (d <= 1 && !reserved.has(i) && !trashed.has(i) ? [i] : [])),
    stream(seed, 'favorites'),
  ).slice(0, FAVORITE_PAGES - hubs.length - 2);

  const assets = seedAssets(seed);
  const covers = assets.filter((asset) => asset.kind === 'cover');
  const lastOrder = new Map<number | null, string>();
  const pages = parents.map((parent, index): PagePlan => {
    const order = orderKeyBetween(lastOrder.get(parent) ?? null, null);
    lastOrder.set(parent, order);
    const meta = stream(seed, 'meta', index);
    const created = EPOCH + index * 37 * MINUTE;
    return {
      index,
      id: pageId(seed, index),
      parent,
      depth: depth(index),
      order,
      blockCount: blockCounts[index] ?? 3,
      created,
      trashedAt: trashed.has(index) ? created + meta.int(1, 60) * DAY : null,
      planted: plantedWord.get(index) ?? null,
      icon: meta.chance(0.25) ? meta.pick(PAGE_ICONS) : null,
      cover: meta.chance(0.05) ? meta.pick(covers).id : null,
      fullWidth: meta.chance(0.1),
    };
  });

  return {
    seed,
    client: stream(seed, 'client').uint32(),
    pages,
    assets,
    large,
    typing,
    deep,
    hubs,
    mentionable: pages.flatMap((page) => (page.trashedAt === null ? [page.index] : [])),
    favorites: [...hubs, large, typing, ...extraFavorites],
    openTargets: pickOpenTargets(seed, pages, large, hubs, deep),
  };
}

/**
 * Pages for the page-open bench, spread across depths and sizes. The main hub and the deepest
 * page come first. The 3,000-block page has a metric of its own, so it isn't one of them.
 */
function pickOpenTargets(
  seed: number,
  pages: readonly PagePlan[],
  large: number,
  hubs: readonly number[],
  deep: number,
): number[] {
  const groups = new Map<string, number[]>();
  for (const page of pages) {
    if (page.trashedAt !== null || page.index === large) continue;
    const size = page.blockCount < 15 ? 'short' : page.blockCount <= 60 ? 'medium' : 'long';
    const key = `${page.depth}-${size}`;
    groups.set(key, [...(groups.get(key) ?? []), page.index]);
  }
  const random = stream(seed, 'targets');
  const queues = [...groups.keys()].sort().map((key) => shuffled(groups.get(key) ?? [], random));
  const targets: number[] = [hubs[0] ?? 0, deep];
  while (targets.length < PAGE_OPEN_TARGETS && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined && !targets.includes(next) && targets.length < PAGE_OPEN_TARGETS) {
        targets.push(next);
      }
    }
  }
  return targets;
}
