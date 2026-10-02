import type { AvlNode } from "./node.js";
import { balanceFactor, heightOf, rotateLeft, rotateRight } from "./rotate.js";

/** Rebalance a node after insertion; returns the new subtree root. */
export function rebalanceAfterInsert(node: AvlNode): AvlNode {
  node.height = 1 + Math.max(heightOf(node.left), heightOf(node.right));
  const bf = balanceFactor(node);
  if (bf > 1) {
    if (node.left !== null && balanceFactor(node.left) < 0) {
      node.left = rotateLeft(node.left);
    }
    return rotateRight(node);
  }
  if (bf < -1) {
    if (node.right !== null && balanceFactor(node.right) > 0) {
      node.right = rotateRight(node.right);
    }
    return rotateLeft(node);
  }
  return node;
}
