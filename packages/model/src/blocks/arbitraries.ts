// fast-check generators for pages and blocks, shared by the block tests.
import fc from 'fast-check';
import {
  type AttrSpec,
  BLOCK_TYPES,
  BLOCKS,
  type Block,
  type BlockType,
  type Inline,
  MAX_INDENT,
  type Marks,
  makeBlock,
  type Page,
  type PageMeta,
} from './spec.ts';

// Accented letters, CJK and an emoji keep multi-unit characters in play.
export const text = fc.string({
  unit: fc.constantFrom('a', 'b', 'c', ' ', 'é', '中', '😀'),
  minLength: 1,
  maxLength: 6,
});

const marks: fc.Arbitrary<Marks> = fc.record(
  {
    bold: fc.constant(true as const),
    italic: fc.constant(true as const),
    underline: fc.constant(true as const),
    strike: fc.constant(true as const),
    inlineCode: fc.constant(true as const),
    link: fc.record({ href: fc.constantFrom('https://a.example/', 'https://b.example/') }),
  },
  { requiredKeys: [] },
);

export const inline: fc.Arbitrary<Inline> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ text, marks }, { requiredKeys: ['text'] }) },
  { weight: 1, arbitrary: fc.record({ mention: fc.constantFrom('page-1', 'page-2', 'page-3') }) },
  { weight: 1, arbitrary: fc.constant({ break: true as const }) },
);

function attrValue(spec: AttrSpec): fc.Arbitrary<unknown> {
  switch (spec.kind) {
    case 'string':
      return fc.constantFrom('', 'note', 'ts', 'https://video.example/1');
    case 'number':
      return fc.integer({ min: 1, max: 3 });
    case 'boolean':
      return fc.boolean();
    case 'string or null':
      return fc.option(fc.constantFrom('sha256-1', 'sha256-2'), { nil: null });
    case 'number or null':
      return fc.option(fc.integer({ min: 1, max: 2000 }), { nil: null });
  }
}

function attrs(type: BlockType): fc.Arbitrary<Record<string, unknown>> {
  const specs = Object.entries(BLOCKS[type].attrs);
  return fc
    .tuple(...specs.map(([, spec]) => attrValue(spec)))
    .map((values) => Object.fromEntries(specs.map(([name], index) => [name, values[index]])));
}

function content(type: BlockType): fc.Arbitrary<Inline[]> {
  const kind = BLOCKS[type].content;
  if (kind === 'none') return fc.constant([]);
  if (kind === 'text') return fc.array(fc.record({ text }), { maxLength: 3 });
  return fc.array(inline, { maxLength: 6 });
}

/** A block of any type with the given id, already in canonical form. */
export function block(id: string): fc.Arbitrary<Block> {
  return fc.constantFrom(...BLOCK_TYPES).chain((type) =>
    fc
      .record({
        indent: fc.integer({ min: 0, max: MAX_INDENT }),
        attrs: attrs(type),
        content: content(type),
      })
      .map((parts) => makeBlock(type, id, parts)),
  );
}

export const meta: fc.Arbitrary<PageMeta> = fc.record({
  icon: fc.option(fc.constantFrom('rocket', 'leaf'), { nil: null }),
  cover: fc.option(fc.constantFrom('sha256-cover'), { nil: null }),
  fullWidth: fc.boolean(),
});

/** A page with 1 to 12 blocks whose ids are b0, b1 and so on. */
export const page: fc.Arbitrary<Page> = fc.integer({ min: 1, max: 12 }).chain((count) =>
  fc.record({
    title: fc.string({ unit: fc.constantFrom('A', 'b', ' ', 'é', '😀'), maxLength: 10 }),
    meta,
    blocks: fc.tuple(...Array.from({ length: count }, (_, index) => block(`b${index}`))),
  }),
);
