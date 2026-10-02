import type { RbNode } from "./node.js";
import type { RbHandle } from "./types.js";

export function rotateLeft(handle: RbHandle, x: RbNode): void {
  const y = x.right;
  if (y === null) return;
  x.right = y.left;
  if (y.left !== null) y.left.parent = x;
  y.parent = x.parent;
  if (x.parent === null) {
    handle.root = y;
  } else if (x === x.parent.left) {
    x.parent.left = y;
  } else {
    x.parent.right = y;
  }
  y.left = x;
  x.parent = y;
}

export function rotateRight(handle: RbHandle, y: RbNode): void {
  const x = y.left;
  if (x === null) return;
  y.left = x.right;
  if (x.right !== null) x.right.parent = y;
  x.parent = y.parent;
  if (y.parent === null) {
    handle.root = x;
  } else if (y === y.parent.right) {
    y.parent.right = x;
  } else {
    y.parent.left = x;
  }
  x.right = y;
  y.parent = x;
}
