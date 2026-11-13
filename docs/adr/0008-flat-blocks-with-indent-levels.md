# 0008. Flat blocks with indent levels

Status: Accepted, 2026-11-12

## Context

A page is a list of blocks that nest: lists, toggles, indented paragraphs. Four things shape how to store them:

- The editor is ProseMirror (through TipTap), bound to Yjs by y-tiptap.
- The store keeps one row per block, for search, backlinks and painting a page before its editor is ready.
- Concurrent offline edits must merge without loss. Yjs has no move operation: moving content means deleting it and inserting a copy, and edits made elsewhere to the deleted original are dropped.
- Long pages, of 3,000 blocks, need cheap diffs on every keystroke.

In a nested tree, indenting a block moves it under its neighbour. Indenting a paragraph while someone else types in it would lose their typing.

## Decision

- **The page doc.** Each page doc holds a Y.XmlFragment named `content`, encoded by y-tiptap: a `title`, then one or more blocks. A Y.Map named `meta` holds the icon, cover and full-width setting.
- **Flat blocks.** Blocks form a flat list. Every block has an `id` and an `indent` from 0 to 8. Nesting is implied: a block's children are the blocks after it with a deeper indent. Indenting and outdenting are attribute writes, so they never move content.
- **Block types.** There are twelve: paragraph, heading (levels 1 to 3), bulleted, numbered, todo, toggle, quote, callout, divider, code, image and embed.
  - `packages/model/src/blocks/spec.ts` describes them as data, with each type's attributes and defaults.
  - The ProseMirror schema is built from that spec and has no DOM rendering, so it runs in Node and in workers. The editor's TipTap extensions are checked against it.
- **Inline content.**
  - Text can carry bold, italic, underline, strike, inline code and links. Inline code's mark is named `inlineCode`, because ProseMirror can't have a node and a mark both named `code`.
  - Text can also hold page mentions and line breaks.
  - Code blocks hold plain text.
- **One encoding.** Pages convert to and from Yjs through @tiptap/y-tiptap, the binding the editor uses, so the seed, the store and the editor all write the same encoding.
- **The projection** reads the Yjs XML directly, without ProseMirror. It produces:
  - the title and meta;
  - one row per block with its id, position, type, indent, attributes with defaults filled in, canonical inline content, plain text and the pages it mentions;
  - the page's links and search text.
- **Incremental updates.** `watchPage` re-projects only the blocks a transaction touched. Adding, removing, moving or replacing blocks re-reads the block list once.
- **Block ids as the store sees them.** A missing or repeated id gets a stand-in, `<id or "block">~<index>`, extended with `~` until it's unique.

## What we gave up

- Children are implied by indentation, not containment.
  - A closed toggle hides the deeper-indented blocks after it.
  - Dragging a block carries its implied children as a range. In Yjs a range move is still a delete and an insert, so edits made elsewhere to blocks being dragged can be lost.
- Callouts and quotes hold one block of text, with line breaks, rather than nested blocks.
- Renaming a block type or attribute needs a migration of stored docs.
- Rows hold each block's content twice: inline runs for painting, plain text for search.

## How it's verified

- **Schema.** Every block type and mark makes a valid document, and documents that break the schema are refused.
- **Round trips** (fast-check):
  - Any page survives page → Y.Doc → projection unchanged (500 runs).
  - The editor's binding reads the same page back from the Y.Doc (500 runs).
  - Writing a page over itself writes nothing (200 runs).
- **Incremental projection** (fast-check, 300 runs). Random pages get 1 to 25 edits, and after every transaction the changes `watchPage` emits must rebuild exactly the full projection. The edits arrive two ways:
  - through the binding: inserting, deleting, moving, retyping and re-indenting blocks, rewriting content, copying ids, renaming the title;
  - straight to Yjs, as a remote update would: typing, cutting text, changing meta.

  This property caught a bug before it shipped. When a block's type changes, the binding replaces its element but keeps the id and position, and the first version of `watchPage` missed the change.
- **No DOM.** A Node worker thread, which has no DOM, loads and runs the model. The browser's store worker starts projecting pages in step 6.
