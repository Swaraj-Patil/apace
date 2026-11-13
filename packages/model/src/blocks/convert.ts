// Converts between pages and Yjs docs through @tiptap/y-tiptap, the binding the editor uses,
// so the seed, the store and the editor all write the same encoding.
import type { Mark, Node } from '@tiptap/pm/model';
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap';
import type * as Y from 'yjs';
import { schema } from './schema.ts';
import {
  BLOCKS,
  type Block,
  blockAttrs,
  CONTENT_FIELD,
  clampIndent,
  cleanMarks,
  type Inline,
  isBlockType,
  type Marks,
  META_FIELD,
  normalizeContent,
  type Page,
  type PageMeta,
} from './spec.ts';

type JSONNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JSONNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

/** The page as a checked ProseMirror document. Throws if it doesn't fit the schema. */
export function pageToNode(page: Page): Node {
  const node = schema.nodeFromJSON(pageToJSON(page));
  node.check();
  return node;
}

export function pageToJSON(page: Page): JSONNode {
  const title: JSONNode = { type: 'title' };
  if (page.title !== '') title.content = [{ type: 'text', text: page.title }];
  return { type: 'doc', content: [title, ...page.blocks.map(blockToJSON)] };
}

function blockToJSON(block: Block): JSONNode {
  const node: JSONNode = {
    type: block.type,
    attrs: { id: block.id, indent: block.indent, ...block.attrs },
  };
  const content = normalizeContent(block.type, block.content).map(inlineToJSON);
  if (content.length > 0) node.content = content;
  return node;
}

function inlineToJSON(part: Inline): JSONNode {
  if ('mention' in part) return { type: 'mention', attrs: { page: part.mention } };
  if ('break' in part) return { type: 'hardBreak' };
  const node: JSONNode = { type: 'text', text: part.text };
  if (part.marks !== undefined) {
    node.marks = Object.entries(part.marks).map(([type, value]) =>
      type === 'link' ? { type, attrs: { href: (value as { href: string }).href } } : { type },
    );
  }
  return node;
}

/** Replaces the doc's content and meta with `page`, in one transaction. */
export function writePage(doc: Y.Doc, page: Page): void {
  const node = pageToNode(page);
  doc.transact(() => {
    prosemirrorToYXmlFragment(node, doc.getXmlFragment(CONTENT_FIELD));
    writeMeta(doc, page.meta);
  });
}

/** Sets only the meta values that differ, so an unchanged page writes no update. */
export function writeMeta(doc: Y.Doc, meta: PageMeta): void {
  const map = doc.getMap<unknown>(META_FIELD);
  for (const [key, value] of Object.entries(meta)) {
    if (map.get(key) !== value) map.set(key, value);
  }
}

/** The page a ProseMirror document holds. The inverse of pageToNode. */
export function nodeToPage(node: Node, meta: PageMeta): Page {
  const blocks: Block[] = [];
  let title = '';
  node.forEach((child, _offset, index) => {
    if (index === 0 && child.type.name === 'title') {
      title = child.textContent;
      return;
    }
    const type = isBlockType(child.type.name) ? child.type.name : 'paragraph';
    const content: Inline[] = [];
    if (BLOCKS[type].content !== 'none') {
      child.forEach((part) => {
        if (part.isText) content.push(textWithMarks(part.text ?? '', part.marks));
        else if (part.type.name === 'mention')
          content.push({ mention: String(part.attrs.page ?? '') });
        else if (part.type.name === 'hardBreak') content.push({ break: true });
      });
    }
    blocks.push({
      id: String(child.attrs.id ?? ''),
      type,
      indent: clampIndent(child.attrs.indent),
      attrs: blockAttrs(type, child.attrs),
      content: normalizeContent(type, content),
    });
  });
  return { title, meta, blocks };
}

function textWithMarks(text: string, marks: readonly Mark[]): Inline {
  const raw: Record<string, unknown> = {};
  for (const mark of marks) raw[mark.type.name] = mark.type.name === 'link' ? mark.attrs : true;
  const clean: Marks | undefined = cleanMarks(raw);
  return clean === undefined ? { text } : { text, marks: clean };
}
