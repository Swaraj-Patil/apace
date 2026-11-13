// The page document's block model, as data. A page is a title followed by a flat list of
// blocks. Nesting comes from each block's indent level, not from blocks containing blocks.

/** The Y.XmlFragment that holds a page's title and blocks. The editor binds to the same name. */
export const CONTENT_FIELD = 'content';
/** The Y.Map that holds a page's icon, cover and full-width setting. */
export const META_FIELD = 'meta';
/** The deepest indent a block can have. */
export const MAX_INDENT = 8;

export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulleted',
  'numbered',
  'todo',
  'toggle',
  'quote',
  'callout',
  'divider',
  'code',
  'image',
  'embed',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** What a block holds: text with marks and mentions, plain text, or nothing. */
export type BlockContent = 'inline' | 'text' | 'none';

export type AttrValue = string | number | boolean | null;
type AttrKind = 'string' | 'number' | 'boolean' | 'string or null' | 'number or null';

export interface AttrSpec {
  readonly kind: AttrKind;
  readonly default: AttrValue;
}

export interface BlockTypeSpec {
  readonly content: BlockContent;
  /** The type's own attributes. Every block also has `id` and `indent`. */
  readonly attrs: Readonly<Record<string, AttrSpec>>;
}

export const BLOCKS: Readonly<Record<BlockType, BlockTypeSpec>> = {
  paragraph: { content: 'inline', attrs: {} },
  heading: { content: 'inline', attrs: { level: { kind: 'number', default: 1 } } },
  bulleted: { content: 'inline', attrs: {} },
  numbered: { content: 'inline', attrs: {} },
  todo: { content: 'inline', attrs: { checked: { kind: 'boolean', default: false } } },
  toggle: { content: 'inline', attrs: {} },
  quote: { content: 'inline', attrs: {} },
  callout: { content: 'inline', attrs: { icon: { kind: 'string', default: 'note' } } },
  divider: { content: 'none', attrs: {} },
  code: { content: 'text', attrs: { language: { kind: 'string', default: 'plain' } } },
  image: {
    content: 'none',
    attrs: {
      asset: { kind: 'string or null', default: null },
      alt: { kind: 'string', default: '' },
      width: { kind: 'number or null', default: null },
      height: { kind: 'number or null', default: null },
    },
  },
  embed: {
    content: 'none',
    attrs: {
      url: { kind: 'string', default: '' },
      height: { kind: 'number or null', default: null },
    },
  },
};

export const MARK_TYPES = ['bold', 'italic', 'underline', 'strike', 'inlineCode', 'link'] as const;
export type MarkType = (typeof MARK_TYPES)[number];

export interface Marks {
  readonly bold?: true;
  readonly italic?: true;
  readonly underline?: true;
  readonly strike?: true;
  readonly inlineCode?: true;
  readonly link?: { readonly href: string };
}

export type Inline =
  | { readonly text: string; readonly marks?: Marks }
  | { readonly mention: string }
  | { readonly break: true };

export interface Block {
  readonly id: string;
  readonly type: BlockType;
  readonly indent: number;
  /** The type's own attributes, each present, with defaults filled in. */
  readonly attrs: Readonly<Record<string, AttrValue>>;
  readonly content: readonly Inline[];
}

export interface PageMeta {
  readonly icon: string | null;
  readonly cover: string | null;
  readonly fullWidth: boolean;
}

export interface Page {
  readonly title: string;
  readonly meta: PageMeta;
  readonly blocks: readonly Block[];
}

export const EMPTY_META: PageMeta = { icon: null, cover: null, fullWidth: false };

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && (BLOCK_TYPES as readonly string[]).includes(value);
}

/** The value if it fits the attribute's kind, otherwise the attribute's default. */
export function readAttr(spec: AttrSpec, value: unknown): AttrValue {
  switch (spec.kind) {
    case 'string':
      return typeof value === 'string' ? value : spec.default;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : spec.default;
    case 'boolean':
      return typeof value === 'boolean' ? value : spec.default;
    case 'string or null':
      return typeof value === 'string' || value === null ? value : spec.default;
    case 'number or null':
      return (typeof value === 'number' && Number.isFinite(value)) || value === null
        ? value
        : spec.default;
  }
}

/** Every attribute of `type`, read from `raw` with defaults filled in. */
export function blockAttrs(
  type: BlockType,
  raw: Readonly<Record<string, unknown>>,
): Record<string, AttrValue> {
  const attrs: Record<string, AttrValue> = {};
  for (const [name, spec] of Object.entries(BLOCKS[type].attrs))
    attrs[name] = readAttr(spec, raw[name]);
  return attrs;
}

export function clampIndent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(MAX_INDENT, Math.max(0, Math.trunc(value)));
}

export function makeBlock(
  type: BlockType,
  id: string,
  options: {
    indent?: number;
    attrs?: Readonly<Record<string, unknown>>;
    content?: readonly Inline[];
  } = {},
): Block {
  return {
    id,
    type,
    indent: clampIndent(options.indent ?? 0),
    attrs: blockAttrs(type, options.attrs ?? {}),
    content: normalizeContent(type, options.content ?? []),
  };
}

/** Marks with only known, well-formed entries, in a fixed order, or undefined when there are none. */
export function cleanMarks(
  marks: Readonly<Record<string, unknown>> | undefined,
): Marks | undefined {
  if (marks === undefined) return undefined;
  const clean: Record<string, unknown> = {};
  for (const name of MARK_TYPES) {
    const value = marks[name];
    if (name === 'link') {
      const href = (value as { href?: unknown } | undefined)?.href;
      if (typeof href === 'string') clean.link = { href };
    } else if (value !== undefined && value !== null && value !== false) {
      clean[name] = true;
    }
  }
  return Object.keys(clean).length === 0 ? undefined : (clean as Marks);
}

function sameMarks(a: Marks | undefined, b: Marks | undefined): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function textRun(text: string, marks: Marks | undefined): Inline {
  return marks === undefined ? { text } : { text, marks };
}

/**
 * The one canonical form of a block's content. Neighbouring text with the same marks merges,
 * empty text goes, plain-text blocks hold one unmarked run, and blocks without content hold none.
 */
export function normalizeContent(type: BlockType, content: readonly Inline[]): Inline[] {
  const kind = BLOCKS[type].content;
  if (kind === 'none') return [];
  if (kind === 'text') {
    const text = content.map((part) => ('text' in part ? part.text : '')).join('');
    return text === '' ? [] : [{ text }];
  }
  const out: Inline[] = [];
  for (const part of content) {
    if (!('text' in part)) {
      out.push(part);
      continue;
    }
    if (part.text === '') continue;
    const marks = cleanMarks(part.marks as Readonly<Record<string, unknown>> | undefined);
    const last = out.at(-1);
    if (last !== undefined && 'text' in last && sameMarks(last.marks, marks)) {
      out[out.length - 1] = textRun(last.text + part.text, marks);
    } else {
      out.push(textRun(part.text, marks));
    }
  }
  return out;
}

/** A block's plain text, with each line break as a newline. Mentions add no text. */
export function textOf(content: readonly Inline[]): string {
  return content.map((part) => ('text' in part ? part.text : 'break' in part ? '\n' : '')).join('');
}
