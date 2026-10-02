import { LeafNode } from "./leaf.js";

/** Deterministic node id allocation from the tree-local counter. */
export function allocateId(nextId: number): number {
  return nextId;
}

/** Discriminate leaf nodes from internal nodes. */
export function isLeafNode(node: unknown): node is LeafNode {
  return node instanceof LeafNode;
}
