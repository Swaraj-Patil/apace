// Projects a page's Yjs doc into rows for the store: the title, the meta, and one row per
// block with its plain text and the pages it mentions. It reads the Yjs XML directly, with no
// ProseMirror, so it runs cheaply in the store worker.
import * as Y from 'yjs';
import {
  BLOCKS,
  type Block,
  type BlockType,
  blockAttrs,
  CONTENT_FIELD,
  clampIndent,
  cleanMarks,
  type Inline,
  isBlockType,
  META_FIELD,
  normalizeContent,
  type Page,
  type PageMeta,
  textOf,
} from './spec.ts';

export interface BlockRow extends Block {
  /** Position among the page's blocks, from 0. */
  readonly index: number;
  readonly text: string;
  /** Pages this block mentions, each once, in order of first mention. */
  readonly mentions: readonly string[];
}

export interface PageProjection {
  readonly title: string;
  readonly meta: PageMeta;
  readonly blocks: readonly BlockRow[];
}

export interface PageChange {
  /** Present when the title changed. */
  readonly title?: string;
  /** Present when the meta changed. */
  readonly meta?: PageMeta;
  /** Blocks that are new, changed or moved. */
  readonly upserted: readonly BlockRow[];
  /** Ids of blocks that are gone. */
  readonly removed: readonly string[];
}

interface Located {
  readonly element: Y.XmlElement;
  readonly id: string;
  readonly rawId: unknown;
  readonly index: number;
}

/**
 * Block ids as the store sees them. A block keeps its own id unless the id is missing or was
 * already used earlier in the page; such blocks get `<id or "block">~<index>`, extended with
 * more `~` if that is taken too.
 */
export function effectiveIds(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  return raw.map((value, index) => {
    const own = typeof value === 'string' && value !== '' ? value : null;
    let id = own !== null && !seen.has(own) ? own : `${own ?? 'block'}~${index}`;
    while (seen.has(id)) id += '~';
    seen.add(id);
    return id;
  });
}

export function projectPage(doc: Y.Doc): PageProjection {
  const fragment = doc.getXmlFragment(CONTENT_FIELD);
  return {
    title: readTitle(fragment),
    meta: readMeta(doc),
    blocks: locateBlocks(fragment).map((block) => projectBlock(block)),
  };
}

export function projectionToPage(projection: PageProjection): Page {
  return {
    title: projection.title,
    meta: projection.meta,
    blocks: projection.blocks.map(({ id, type, indent, attrs, content }) => ({
      id,
      type,
      indent,
      attrs,
      content,
    })),
  };
}

/** Every block-to-page link in the projection. */
export function linksOf(projection: PageProjection): { block: string; page: string }[] {
  return projection.blocks.flatMap((block) =>
    block.mentions.map((page) => ({ block: block.id, page })),
  );
}

/** The page's searchable text: its title, then each block's text on its own line. */
export function searchTextOf(projection: PageProjection): string {
  return [projection.title, ...projection.blocks.map((block) => block.text)].join('\n');
}

/**
 * Keeps a projection current as the doc changes, and reports each transaction's changes,
 * re-projecting only the blocks that transaction touched. Edits inside blocks cost one
 * re-projection each; adding, removing or moving blocks re-reads the block list once.
 */
export function watchPage(
  doc: Y.Doc,
  onChange: (change: PageChange) => void,
): { readonly current: () => PageProjection; stop(): void } {
  const fragment = doc.getXmlFragment(CONTENT_FIELD);
  const meta = doc.getMap<unknown>(META_FIELD);
  const initial = projectPage(doc);
  let title = initial.title;
  let pageMeta = initial.meta;
  const rows = new Map<string, BlockRow>(initial.blocks.map((row) => [row.id, row]));
  let located = new Map<Y.XmlElement, Located>(
    locateBlocks(fragment).map((block) => [block.element, block]),
  );

  let structural = false;
  let metaTouched = false;
  const touched = new Set<Y.XmlElement>();

  const onDeep = (events: Y.YEvent<Y.XmlElement | Y.XmlText | Y.XmlFragment>[]) => {
    for (const event of events) {
      if (event.target === fragment) {
        structural = true;
        continue;
      }
      const block = topLevel(fragment, event.target);
      if (block !== null) touched.add(block);
    }
  };
  const onMeta = () => {
    metaTouched = true;
  };

  const flush = () => {
    if (!structural && touched.size === 0 && !metaTouched) return;
    const upserted: BlockRow[] = [];
    const removed: string[] = [];
    // A block whose own id attribute changed may now clash or stop clashing with another,
    // so it needs the whole list re-read, like a structural change.
    for (const element of touched) {
      const known = located.get(element);
      if (known !== undefined && known.rawId !== element.getAttribute('id')) structural = true;
    }
    if (structural) {
      const next = locateBlocks(fragment);
      const nextIds = new Set(next.map((block) => block.id));
      for (const id of rows.keys()) {
        if (!nextIds.has(id)) {
          rows.delete(id);
          removed.push(id);
        }
      }
      for (const block of next) {
        const before = rows.get(block.id);
        // The binding replaces a block's element when its type changes, keeping the id and
        // the position, so a new element always needs projecting.
        if (
          before === undefined ||
          before.index !== block.index ||
          !located.has(block.element) ||
          touched.has(block.element)
        ) {
          const row = projectBlock(block);
          rows.set(block.id, row);
          upserted.push(row);
        }
      }
      located = new Map(next.map((block) => [block.element, block]));
    } else {
      for (const element of touched) {
        const block = located.get(element);
        if (block === undefined) continue;
        const row = projectBlock(block);
        rows.set(block.id, row);
        upserted.push(row);
      }
    }
    const nextTitle = readTitle(fragment);
    const change: { title?: string; meta?: PageMeta; upserted: BlockRow[]; removed: string[] } = {
      upserted,
      removed,
    };
    if (nextTitle !== title) {
      title = nextTitle;
      change.title = title;
    }
    if (metaTouched) {
      const nextMeta = readMeta(doc);
      if (JSON.stringify(nextMeta) !== JSON.stringify(pageMeta)) {
        pageMeta = nextMeta;
        change.meta = pageMeta;
      }
    }
    structural = false;
    metaTouched = false;
    touched.clear();
    if (upserted.length > 0 || removed.length > 0 || 'title' in change || 'meta' in change) {
      onChange(change);
    }
  };

  fragment.observeDeep(onDeep);
  meta.observe(onMeta);
  doc.on('afterTransaction', flush);
  return {
    current: () => ({
      title,
      meta: pageMeta,
      blocks: [...rows.values()].sort((a, b) => a.index - b.index),
    }),
    stop() {
      fragment.unobserveDeep(onDeep);
      meta.unobserve(onMeta);
      doc.off('afterTransaction', flush);
    },
  };
}

function readTitle(fragment: Y.XmlFragment): string {
  const first = fragment.get(0);
  if (!(first instanceof Y.XmlElement) || first.nodeName !== 'title') return '';
  return textOf(readInline(first, 'text'));
}

export function readMeta(doc: Y.Doc): PageMeta {
  const meta = doc.getMap<unknown>(META_FIELD);
  const icon = meta.get('icon');
  const cover = meta.get('cover');
  return {
    icon: typeof icon === 'string' ? icon : null,
    cover: typeof cover === 'string' ? cover : null,
    fullWidth: meta.get('fullWidth') === true,
  };
}

function locateBlocks(fragment: Y.XmlFragment): Located[] {
  const elements: Y.XmlElement[] = [];
  fragment.toArray().forEach((child, position) => {
    if (!(child instanceof Y.XmlElement)) return;
    if (position === 0 && child.nodeName === 'title') return;
    elements.push(child);
  });
  const rawIds = elements.map((element) => element.getAttribute('id') as unknown);
  const ids = effectiveIds(rawIds);
  return elements.map((element, index) => ({
    element,
    id: ids[index] ?? '',
    rawId: rawIds[index],
    index,
  }));
}

/** The direct child of the fragment that contains `type`, or null if there is none. */
function topLevel(
  fragment: Y.XmlFragment,
  type: { readonly parent: unknown },
): Y.XmlElement | null {
  let current: { readonly parent: unknown } | null = type;
  while (current !== null && current.parent !== fragment) {
    current = (current.parent ?? null) as { readonly parent: unknown } | null;
  }
  return current instanceof Y.XmlElement ? current : null;
}

function projectBlock({ element, id, index }: Located): BlockRow {
  const type: BlockType = isBlockType(element.nodeName) ? element.nodeName : 'paragraph';
  const raw = element.getAttributes() as Record<string, unknown>;
  const content = normalizeContent(type, readInline(element, BLOCKS[type].content));
  const mentions: string[] = [];
  for (const part of content) {
    if ('mention' in part && !mentions.includes(part.mention)) mentions.push(part.mention);
  }
  return {
    id,
    index,
    type,
    indent: clampIndent(raw.indent),
    attrs: blockAttrs(type, raw),
    content,
    text: textOf(content),
    mentions,
  };
}

function readInline(element: Y.XmlElement, kind: 'inline' | 'text' | 'none'): Inline[] {
  if (kind === 'none') return [];
  const parts: Inline[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as {
        insert?: unknown;
        attributes?: Record<string, unknown>;
      }[]) {
        if (typeof op.insert !== 'string') continue;
        const marks = kind === 'inline' ? cleanMarks(op.attributes) : undefined;
        parts.push(marks === undefined ? { text: op.insert } : { text: op.insert, marks });
      }
    } else if (child instanceof Y.XmlElement && kind === 'inline') {
      if (child.nodeName === 'mention')
        parts.push({ mention: String(child.getAttribute('page') ?? '') });
      else if (child.nodeName === 'hardBreak') parts.push({ break: true });
    }
  }
  return parts;
}
