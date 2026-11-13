import { describe, expect, test } from 'vitest';
import { pageToNode } from './convert.ts';
import { schema } from './schema.ts';
import { BLOCK_TYPES, EMPTY_META, MARK_TYPES, makeBlock, type Page } from './spec.ts';

describe('schema', () => {
  test('every block type and every mark makes a valid document', () => {
    const page: Page = {
      title: 'Every block',
      meta: EMPTY_META,
      blocks: BLOCK_TYPES.map((type, index) =>
        makeBlock(type, `b${index}`, {
          indent: index % 3,
          content: [
            { text: 'plain ' },
            { text: 'marked', marks: { bold: true, italic: true, underline: true, strike: true } },
            { text: ' code', marks: { inlineCode: true } },
            { text: ' link', marks: { link: { href: 'https://example.com/' } } },
            { break: true },
            { mention: 'page-1' },
          ],
        }),
      ),
    };
    const doc = pageToNode(page);
    expect(doc.childCount).toBe(BLOCK_TYPES.length + 1);
    expect(Object.keys(schema.marks)).toEqual([...MARK_TYPES]);
    expect(BLOCK_TYPES.every((type) => schema.nodes[type]?.isInGroup('block'))).toBe(true);
  });

  test('content that breaks the schema is refused', () => {
    expect(() => schema.nodeFromJSON({ type: 'doc', content: [] }).check()).toThrow();
    expect(() =>
      schema
        .nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'b0' } }] })
        .check(),
    ).toThrow();
    expect(() =>
      schema
        .nodeFromJSON({
          type: 'doc',
          content: [
            { type: 'title' },
            {
              type: 'code',
              attrs: { id: 'b0' },
              content: [{ type: 'mention', attrs: { page: 'page-1' } }],
            },
          ],
        })
        .check(),
    ).toThrow();
    expect(() =>
      schema
        .nodeFromJSON({
          type: 'doc',
          content: [
            { type: 'title', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] },
            { type: 'paragraph', attrs: { id: 'b0' } },
          ],
        })
        .check(),
    ).toThrow();
  });
});
