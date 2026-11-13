import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { page } from './arbitraries.ts';
import { nodeToPage, writePage } from './convert.ts';
import { projectionToPage, projectPage, readMeta } from './project.ts';
import { schema } from './schema.ts';
import { CONTENT_FIELD } from './spec.ts';

describe('page round trip', () => {
  test('any page survives page → Y.Doc → projection unchanged', () => {
    fc.assert(
      fc.property(page, (original) => {
        const doc = new Y.Doc();
        writePage(doc, original);
        expect(projectionToPage(projectPage(doc))).toEqual(original);
      }),
      { numRuns: 500 },
    );
  });

  test("the editor's binding reads the same page back from the Y.Doc", () => {
    fc.assert(
      fc.property(page, (original) => {
        const doc = new Y.Doc();
        writePage(doc, original);
        const node = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(CONTENT_FIELD), schema);
        node.check();
        expect(nodeToPage(node, readMeta(doc))).toEqual(original);
      }),
      { numRuns: 500 },
    );
  });

  test('writing a page over itself changes nothing', () => {
    fc.assert(
      fc.property(page, (original) => {
        const doc = new Y.Doc();
        writePage(doc, original);
        let updates = 0;
        doc.on('update', () => updates++);
        writePage(doc, original);
        expect(updates).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
