import type { TreapNode } from "./node.js";

/** Rotate right: node's left child becomes the new subtree root. */
export function rotateRight(node: TreapNode): TreapNode {
  const pivot = node.left;
  if (pivot === null) {
    return node;
  }
  node.left = pivot.right;
  pivot.right = node;
  return pivot;
}

/** Rotate left: node's right child becomes the new subtree root. */
export function rotateLeft(node: TreapNode): TreapNode {
  const pivot = node.right;
  if (pivot === null) {
    return node;
  }
  node.right = pivot.left;
  pivot.left = node;
  return pivot;
}
