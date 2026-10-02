import type { AvlNode } from "./node.js";

export function heightOf(node: AvlNode | null): number {
  return node === null ? 0 : node.height;
}

export function balanceFactor(node: AvlNode): number {
  return heightOf(node.left) - heightOf(node.right);
}

function updateHeight(node: AvlNode): void {
  node.height = 1 + Math.max(heightOf(node.left), heightOf(node.right));
}

export function rotateLeft(node: AvlNode): AvlNode {
  const pivot = node.right;
  if (pivot === null) {
    return node;
  }
  node.right = pivot.left;
  pivot.left = node;
  updateHeight(node);
  updateHeight(pivot);
  return pivot;
}

export function rotateRight(node: AvlNode): AvlNode {
  const pivot = node.left;
  if (pivot === null) {
    return node;
  }
  node.left = pivot.right;
  pivot.right = node;
  updateHeight(node);
  updateHeight(pivot);
  return pivot;
}
