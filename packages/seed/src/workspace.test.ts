import {
  type PageProjection,
  projectPage,
  readTree,
  type Tree,
  WORKSPACE_DOC_ID,
} from '@apace/model';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import { EMBED_ORIGIN } from './pages.ts';
import {
  FAVORITE_PAGES,
  LARGE_PAGE_BLOCKS,
  MAX_DEPTH,
  PAGE_COUNT,
  PAGE_OPEN_TARGETS,
  planWorkspace,
  TRASHED_PAGES,
} from './plan.ts';
import { PLANTED } from './words.ts';
import {
  pageRecord,
  type SeededWorkspace,
  seedFixtures,
  seedWorkspace,
  workspaceRecord,
} from './workspace.ts';

let seeded: SeededWorkspace;
let tree: Tree;
/** Each page's projection, read back from its Yjs update, by page id. */
const pages = new Map<string, PageProjection>();
/** For each page, the pages outside the trash that mention it. */
const backlinks = new Map<string, Set<string>>();

beforeAll(() => {
  seeded = seedWorkspace(1);
  const [workspace, ...pageRecords] = seeded.records;
  const treeDoc = new Y.Doc();
  Y.applyUpdate(treeDoc, workspace?.update ?? new Uint8Array());
  tree = readTree(treeDoc);
  for (const record of pageRecords) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, record.update);
    const projection = projectPage(doc);
    pages.set(record.docId, projection);
    if (tree.nodes.get(record.docId)?.trashed) continue;
    for (const block of projection.blocks) {
      for (const target of block.mentions) {
        backlinks.set(target, (backlinks.get(target) ?? new Set()).add(record.docId));
      }
    }
  }
});

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean =>
  a !== undefined &&
  b !== undefined &&
  a.length === b.length &&
  a.every((byte, i) => byte === b[i]);

const page = (id: string): PageProjection => {
  const projection = pages.get(id);
  if (projection === undefined) throw new Error(`No page ${id}`);
  return projection;
};

describe('the workspace', () => {
  test('starts with the page tree, then one record per page', () => {
    const [workspace, ...rest] = seeded.records;
    expect(workspace).toMatchObject({ docId: WORKSPACE_DOC_ID, kind: 'workspace' });
    expect(rest).toHaveLength(PAGE_COUNT);
    expect(rest.every((record) => record.kind === 'page')).toBe(true);
    expect(new Set(rest.map((record) => record.docId)).size).toBe(PAGE_COUNT);
  });

  test('has exactly 2,000 pages in a tree that needs no repairs', () => {
    expect(tree.nodes.size).toBe(PAGE_COUNT);
    expect([...tree.nodes.values()].filter((node) => node.repair !== null)).toEqual([]);
    expect(new Set(tree.nodes.keys())).toEqual(new Set(pages.keys()));
  });

  test('has about a dozen top-level pages, depth up to 8 and a skewed fan-out', () => {
    expect(tree.roots).toHaveLength(12);
    const depths = [...tree.nodes.values()].map((node) => node.depth);
    expect(Math.max(...depths)).toBe(MAX_DEPTH);
    // Most pages sit within four levels of the top, as in a real workspace.
    expect(depths.filter((depth) => depth <= 4).length / PAGE_COUNT).toBeGreaterThan(0.75);
    const families = [...tree.children.values()].map((children) => children.length);
    families.sort((a, b) => b - a);
    const median = families[Math.floor(families.length / 2)] ?? 0;
    expect(families[0]).toBeGreaterThan(10 * median);
  });

  test('has a median of about 30 blocks per page, and at least 3 on every page', () => {
    const sizes = [...pages.values()].map((projection) => projection.blocks.length);
    sizes.sort((a, b) => a - b);
    expect(sizes[0]).toBeGreaterThanOrEqual(3);
    expect(sizes[PAGE_COUNT / 2]).toBeGreaterThanOrEqual(27);
    expect(sizes[PAGE_COUNT / 2]).toBeLessThanOrEqual(33);
  });

  test('uses every block type, mostly paragraphs', () => {
    const counts = new Map<string, number>();
    for (const projection of pages.values()) {
      for (const block of projection.blocks)
        counts.set(block.type, (counts.get(block.type) ?? 0) + 1);
    }
    expect(counts.size).toBe(12);
    const paragraphs = counts.get('paragraph') ?? 0;
    expect(Math.max(...counts.values())).toBe(paragraphs);
  });

  test('has exactly one page with exactly 3,000 blocks, holding every heavy block type', () => {
    // Other pages stop at 400 blocks.
    const large = [...pages].filter(([, projection]) => projection.blocks.length > 400);
    expect(large.map(([id]) => id)).toEqual([seeded.fixtures.largePage]);
    const blocks = page(seeded.fixtures.largePage).blocks;
    expect(blocks).toHaveLength(LARGE_PAGE_BLOCKS);
    for (const type of ['toggle', 'code', 'image', 'embed']) {
      expect(blocks.filter((block) => block.type === type).length).toBeGreaterThan(20);
    }
    expect(blocks.filter((block) => block.mentions.length > 0).length).toBeGreaterThan(100);
  });

  test('gives every block an id unique in its page, and never indents more than one step', () => {
    const problems: string[] = [];
    for (const [id, projection] of pages) {
      const ids = new Set(projection.blocks.map((block) => block.id));
      if (ids.size !== projection.blocks.length) problems.push(`${id} repeats a block id`);
      let previous = -1;
      for (const block of projection.blocks) {
        if (block.indent > previous + 1) problems.push(`${id} jumps to indent ${block.indent}`);
        previous = block.indent;
      }
    }
    expect(problems).toEqual([]);
  });

  test('points every mention at a page outside the trash, and never at its own page', () => {
    const problems: string[] = [];
    let mentions = 0;
    for (const [id, projection] of pages) {
      for (const block of projection.blocks) {
        for (const target of block.mentions) {
          mentions++;
          if (target === id) problems.push(`${id} mentions itself`);
          if (tree.nodes.get(target)?.trashed !== false) problems.push(`${id} mentions ${target}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(mentions).toBeGreaterThan(PAGE_COUNT);
  });

  test('points every image and cover at a seeded asset, and every embed at the local origin', () => {
    const images = new Set(
      seeded.plan.assets.filter((asset) => asset.kind === 'image').map((asset) => asset.id),
    );
    const covers = new Set(
      seeded.plan.assets.filter((asset) => asset.kind === 'cover').map((asset) => asset.id),
    );
    let embeds = 0;
    let withCover = 0;
    let withIcon = 0;
    for (const projection of pages.values()) {
      if (projection.meta.cover !== null) {
        expect(covers.has(projection.meta.cover)).toBe(true);
        withCover++;
      }
      if (projection.meta.icon !== null) withIcon++;
      for (const block of projection.blocks) {
        if (block.type === 'image') {
          expect(images.has(String(block.attrs.asset))).toBe(true);
          expect(block.attrs.width).toBeGreaterThan(0);
          expect(block.attrs.height).toBeGreaterThan(0);
        }
        if (block.type === 'embed') {
          expect(String(block.attrs.url).startsWith(`${EMBED_ORIGIN}/`)).toBe(true);
          embeds++;
        }
      }
    }
    expect(embeds).toBeGreaterThan(0);
    expect(withCover).toBeGreaterThan(0);
    expect(withIcon).toBeGreaterThan(0);
  });

  test('has a hub with at least 300 backlinks from pages outside the trash', () => {
    const hub = backlinks.get(seeded.fixtures.hubPage)?.size ?? 0;
    expect(hub).toBeGreaterThanOrEqual(300);
    const most = Math.max(...[...backlinks.values()].map((sources) => sources.size));
    expect(hub).toBe(most);
  });

  test('has 12 favorites and 150 trashed pages', () => {
    const { favorites, trash } = seeded.fixtures;
    expect(new Set(favorites).size).toBe(FAVORITE_PAGES);
    expect(new Set(trash).size).toBe(TRASHED_PAGES);
    expect(favorites.every((id) => tree.nodes.get(id)?.trashed === false)).toBe(true);
    // Only leaves are trashed, so the trash list is the whole of the trash.
    const trashed = [...tree.nodes.values()].filter((node) => node.trashed);
    expect(new Set(trashed.map((node) => node.id))).toEqual(new Set(trash));
    expect(trash.every((id) => !tree.children.has(id))).toBe(true);
  });
});

describe('the fixtures', () => {
  test('name a typing page of 35 to 45 blocks, one to three levels down', () => {
    const { typingPage } = seeded.fixtures;
    expect(page(typingPage).blocks.length).toBeGreaterThanOrEqual(35);
    expect(page(typingPage).blocks.length).toBeLessThanOrEqual(45);
    expect(tree.nodes.get(typingPage)?.depth).toBeGreaterThanOrEqual(1);
    expect(tree.nodes.get(typingPage)?.depth).toBeLessThanOrEqual(3);
  });

  test('name a page at the deepest level', () => {
    expect(tree.nodes.get(seeded.fixtures.deepPage)?.depth).toBe(MAX_DEPTH);
  });

  test('spread 60 page-open targets across every depth and size, outside the trash', () => {
    const targets = seeded.fixtures.pageOpenTargets;
    expect(new Set(targets).size).toBe(PAGE_OPEN_TARGETS);
    expect(targets).not.toContain(seeded.fixtures.largePage);
    const depths = new Set<number>();
    const sizes = targets.map((id) => page(id).blocks.length);
    for (const id of targets) {
      const node = tree.nodes.get(id);
      expect(node?.trashed).toBe(false);
      depths.add(node?.depth ?? -1);
    }
    expect([...depths].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sizes.some((size) => size < 15)).toBe(true);
    expect(sizes.some((size) => size >= 15 && size <= 60)).toBe(true);
    expect(sizes.some((size) => size > 60)).toBe(true);
  });

  test('give each search query exactly one page that matches it, its expected hit', () => {
    const { searchQueries } = seeded.fixtures;
    expect(searchQueries).toHaveLength(PLANTED.length * 2);
    const words = new Map<string, string[]>();
    for (const [id, projection] of pages) {
      const text = [projection.title, ...projection.blocks.map((block) => block.text)].join(' ');
      words.set(id, text.toLowerCase().split(/[^\p{L}\p{N}]+/u));
    }
    for (const { query, expected } of searchQueries) {
      const prefix = query.toLowerCase();
      const hits = [...words].filter(([, list]) => list.some((word) => word.startsWith(prefix)));
      expect(hits.map(([id]) => id)).toEqual([expected]);
      expect(page(expected).title.toLowerCase().split(' ')[0]?.startsWith(prefix)).toBe(true);
      expect(tree.nodes.get(expected)?.trashed).toBe(false);
    }
  });
});

describe('generation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('gives the same hash for the same seed', () => {
    expect(seedWorkspace(1).hash).toBe(seeded.hash);
  });

  test('gives a different hash for another seed', () => {
    expect(seedWorkspace(2).hash).not.toBe(seeded.hash);
  });

  test('regenerates any one page alone, byte for byte', () => {
    const plan = planWorkspace(1);
    const { largePage, typingPage, deepPage, hubPage } = seedFixtures(plan);
    expect(sameBytes(workspaceRecord(plan).update, seeded.records[0]?.update)).toBe(true);
    for (const id of [largePage, typingPage, deepPage, hubPage]) {
      const index = plan.pages.findIndex((entry) => entry.id === id);
      expect(sameBytes(pageRecord(plan, index).update, seeded.records[index + 1]?.update)).toBe(
        true,
      );
    }
  });

  test('never reads the clock or Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');
    const plan = planWorkspace(3);
    workspaceRecord(plan);
    pageRecord(plan, plan.large);
    seedFixtures(plan);
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });
});
