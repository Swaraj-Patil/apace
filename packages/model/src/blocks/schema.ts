// The ProseMirror schema, built from the block spec. It holds no DOM rendering, so it runs in
// Node and in workers. The editor's TipTap extensions are checked against it.
import { type MarkSpec, type NodeSpec, Schema } from '@tiptap/pm/model';
import { BLOCK_TYPES, BLOCKS, type BlockType } from './spec.ts';

function blockNode(type: BlockType): NodeSpec {
  const spec = BLOCKS[type];
  const attrs: Record<string, { default: unknown }> = {
    id: { default: '' },
    indent: { default: 0 },
  };
  for (const [name, attr] of Object.entries(spec.attrs)) attrs[name] = { default: attr.default };
  if (spec.content === 'inline') return { group: 'block', attrs, content: 'inline*' };
  if (spec.content === 'text')
    return { group: 'block', attrs, content: 'text*', marks: '', code: true };
  return { group: 'block', attrs, atom: true };
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'title block+' },
  title: { content: 'text*', marks: '' },
};
for (const type of BLOCK_TYPES) nodes[type] = blockNode(type);
nodes.text = { group: 'inline' };
nodes.hardBreak = { group: 'inline', inline: true, selectable: false };
nodes.mention = { group: 'inline', inline: true, atom: true, attrs: { page: { default: '' } } };

const marks: Record<string, MarkSpec> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  inlineCode: {},
  link: { attrs: { href: { default: '' } }, inclusive: false },
};

export const schema = new Schema({ nodes, marks });
