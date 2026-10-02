import type { RbNode } from "./node.js";
import type { RbHandle } from "./types.js";
import { rotateLeft, rotateRight } from "./rotate.js";

function colorOf(node: RbNode | null): "red" | "black" {
  return node === null ? "black" : node.color;
}

/** CLRS delete fixup: restore black-height after removing a black node. */
export function deleteFixup(
  handle: RbHandle,
  x: RbNode | null,
  xParent: RbNode | null,
): void {
  while (x !== handle.root && colorOf(x) === "black") {
    if (xParent === null) break;
    if (x === xParent.left) {
      let w = xParent.right;
      if (w !== null && w.color === "red") {
        w.color = "black";
        xParent.color = "red";
        rotateLeft(handle, xParent);
        w = xParent.right;
      }
      if (
        w !== null &&
        colorOf(w.left) === "black" &&
        colorOf(w.right) === "black"
      ) {
        w.color = "red";
        x = xParent;
        xParent = x.parent;
      } else if (w !== null) {
        if (colorOf(w.right) === "black") {
          if (w.left !== null) w.left.color = "black";
          w.color = "red";
          rotateRight(handle, w);
          w = xParent.right;
        }
        if (w !== null) {
          w.color = xParent.color;
          if (w.right !== null) w.right.color = "black";
        }
        xParent.color = "black";
        rotateLeft(handle, xParent);
        x = handle.root;
        xParent = null;
      } else {
        x = xParent;
        xParent = x.parent;
      }
    } else {
      let w = xParent.left;
      if (w !== null && w.color === "red") {
        w.color = "black";
        xParent.color = "red";
        rotateRight(handle, xParent);
        w = xParent.left;
      }
      if (
        w !== null &&
        colorOf(w.right) === "black" &&
        colorOf(w.left) === "black"
      ) {
        w.color = "red";
        x = xParent;
        xParent = x.parent;
      } else if (w !== null) {
        if (colorOf(w.left) === "black") {
          if (w.right !== null) w.right.color = "black";
          w.color = "red";
          rotateLeft(handle, w);
          w = xParent.left;
        }
        if (w !== null) {
          w.color = xParent.color;
          if (w.left !== null) w.left.color = "black";
        }
        xParent.color = "black";
        rotateRight(handle, xParent);
        x = handle.root;
        xParent = null;
      } else {
        x = xParent;
        xParent = x.parent;
      }
    }
  }
  if (x !== null) x.color = "black";
}
