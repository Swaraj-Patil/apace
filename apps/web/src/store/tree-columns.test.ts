import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { decodeTree, encodeTree, IN_TRASH, TRASHED, type TreeRow } from './tree-columns.ts';

/** Any forest, listed parents first, with titles and icons in every script. */
const rows: fc.Arbitrary<TreeRow[]> = fc
  .array(
    fc.record({
      parent: fc.nat(),
      topLevel: fc.boolean(),
      flags: fc.constantFrom(0, IN_TRASH, IN_TRASH | TRASHED),
      title: fc.string({ unit: fc.constantFrom('a', ' ', 'é', '中', '😀', '"', '\\', '\n') }),
      icon: fc.option(fc.constantFrom('🚀', '🗺️'), { nil: null }),
    }),
    { maxLength: 60 },
  )
  .map((specs) => {
    const out: TreeRow[] = [];
    specs.forEach((spec, index) => {
      const parent = index === 0 || spec.topLevel ? undefined : out[spec.parent % index];
      out.push({
        id: `page-${index}`,
        parent: parent?.id ?? null,
        depth: parent === undefined ? 0 : parent.depth + 1,
        flags: spec.flags,
        title: spec.title,
        icon: spec.icon,
      });
    });
    return out;
  });

describe('tree columns', () => {
  test('decode what was encoded', () => {
    fc.assert(
      fc.property(rows, (tree) => {
        const columns = decodeTree(encodeTree(tree));
        expect(columns.count).toBe(tree.length);
        const back = columns.ids.map(
          (id, row): TreeRow => ({
            id,
            parent:
              columns.parents[row] === -1 ? null : (columns.ids[columns.parents[row] ?? -1] ?? '?'),
            depth: columns.depths[row] ?? -1,
            flags: columns.flags[row] ?? -1,
            title: columns.titles[row] ?? '?',
            icon: columns.icons[row] ?? null,
          }),
        );
        expect(back).toEqual(tree);
      }),
      { numRuns: 300 },
    );
  });

  test('refuse a child listed before its parent', () => {
    const child: TreeRow = { id: 'b', parent: 'a', depth: 1, flags: 0, title: '', icon: null };
    const parent: TreeRow = { id: 'a', parent: null, depth: 0, flags: 0, title: '', icon: null };
    expect(() => encodeTree([child, parent])).toThrow('comes before its parent');
  });

  test('keep depths past 255', () => {
    const deep: TreeRow[] = Array.from({ length: 300 }, (_, depth) => ({
      id: `p${depth}`,
      parent: depth === 0 ? null : `p${depth - 1}`,
      depth,
      flags: 0,
      title: '',
      icon: null,
    }));
    expect(decodeTree(encodeTree(deep)).depths.at(-1)).toBe(299);
  });

  test('refuse a buffer in a format it does not know', () => {
    const buffer = encodeTree([]);
    new Uint32Array(buffer, 0, 1)[0] = 99;
    expect(() => decodeTree(buffer)).toThrow('Unknown tree format 99');
  });
});
