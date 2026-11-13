import type { Tree } from './tree.ts';

/**
 * Every way `tree` breaks the rules of a valid page forest, or an empty list when it keeps
 * them all. Tests run it over projections of arbitrary input.
 */
export function forestProblems(tree: Tree, pageIds: Iterable<string>): string[] {
  const problems: string[] = [];
  const expected = new Set(pageIds);
  const seen = new Set<string>();
  for (const id of tree.preorder) {
    if (seen.has(id)) problems.push(`${id} appears twice`);
    if (!expected.has(id)) problems.push(`${id} is not a page`);
    seen.add(id);
  }
  for (const id of expected) if (!seen.has(id)) problems.push(`${id} is missing`);
  if (tree.nodes.size !== expected.size)
    problems.push(`${tree.nodes.size} nodes for ${expected.size} pages`);

  const lists: [string | null, readonly string[]][] = [[null, tree.roots], ...tree.children];
  for (const [parent, siblings] of lists) {
    const parentNode = parent === null ? undefined : tree.nodes.get(parent);
    siblings.forEach((id, index) => {
      const node = tree.nodes.get(id);
      if (node === undefined) {
        problems.push(`${id} is listed but has no node`);
        return;
      }
      if (node.parent !== parent)
        problems.push(`${id} is listed under ${parent}, not ${node.parent}`);
      if (node.index !== index) problems.push(`${id} has index ${node.index} at position ${index}`);
      if (node.depth !== (parentNode === undefined ? 0 : parentNode.depth + 1)) {
        problems.push(`${id} has the wrong depth`);
      }
      if (parentNode?.trashed && !node.trashed) problems.push(`${id} escaped its parent's trash`);
      const previous = index > 0 ? tree.nodes.get(siblings[index - 1] ?? '') : undefined;
      if (
        previous !== undefined &&
        (previous.order > node.order || (previous.order === node.order && previous.id > node.id))
      ) {
        problems.push(`${id} is out of order`);
      }
    });
  }

  for (const id of seen) {
    let steps = 0;
    for (
      let up = tree.nodes.get(id)?.parent ?? null;
      up !== null;
      up = tree.nodes.get(up)?.parent ?? null
    ) {
      if (++steps > expected.size) {
        problems.push(`${id} sits in a cycle`);
        break;
      }
    }
  }
  return problems;
}
