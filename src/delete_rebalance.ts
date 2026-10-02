import { InternalNode } from "./internal.js";
import { LeafNode } from "./leaf.js";

export type RebuiltTree = {
  root: LeafNode | InternalNode;
  nodes: Map<number, LeafNode | InternalNode>;
  nextId: number;
};

/**
 * Rebalance after a deletion by deterministically compacting the remaining
 * sorted pairs: underfull siblings are borrowed from / merged until the
 * remaining entries pack into fresh leaves (left to right, fullest first),
 * then internal levels are rebuilt bottom-up with even fanout.
 */
export function rebalanceAfterDelete(
  pairs: { key: string; value: number }[],
  leafMaxKeys: number,
  internalMaxKeys: number,
  nextId: number,
): RebuiltTree {
  const nodes = new Map<number, LeafNode | InternalNode>();
  const alloc = (): number => {
    const id = nextId;
    nextId += 1;
    return id;
  };

  if (pairs.length === 0) {
    const root = new LeafNode(alloc());
    nodes.set(root.id, root);
    return { root, nodes, nextId };
  }

  const leaves: LeafNode[] = [];
  for (let i = 0; i < pairs.length; i += leafMaxKeys) {
    const slice = pairs.slice(i, i + leafMaxKeys);
    const leaf = new LeafNode(
      alloc(),
      slice.map((pair) => pair.key),
      slice.map((pair) => pair.value),
    );
    nodes.set(leaf.id, leaf);
    leaves.push(leaf);
  }
  for (let i = 0; i + 1 < leaves.length; i += 1) {
    leaves[i]!.next = leaves[i + 1]!.id;
  }

  let level: (LeafNode | InternalNode)[] = leaves;
  let levelMins: string[] = leaves.map((leaf) => leaf.keys[0]!);
  while (level.length > 1) {
    const fanout = internalMaxKeys + 1;
    const groupCount = Math.ceil(level.length / fanout);
    const baseSize = Math.floor(level.length / groupCount);
    const extra = level.length % groupCount;
    const nextLevel: InternalNode[] = [];
    const nextMins: string[] = [];
    let offset = 0;
    for (let group = 0; group < groupCount; group += 1) {
      const size = baseSize + (group < extra ? 1 : 0);
      const children = level.slice(offset, offset + size);
      const childMins = levelMins.slice(offset, offset + size);
      const internal = new InternalNode(
        alloc(),
        childMins.slice(1),
        children.map((child) => child.id),
      );
      nodes.set(internal.id, internal);
      nextLevel.push(internal);
      nextMins.push(childMins[0]!);
      offset += size;
    }
    level = nextLevel;
    levelMins = nextMins;
  }

  return { root: level[0]!, nodes, nextId };
}
