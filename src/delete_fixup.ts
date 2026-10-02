import type { RbNode } from "./node.js";
import type { RbHandle } from "./types.js";
import { rotateLeft, rotateRight } from "./rotate.js";

function colorOf(node: RbNode | null): "red" | "black" {
  return node === null ? "black" : node.color;
}

/** CLRS delete fixup; x may be a null NIL, with xParent its parent. */
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
        w === null ||
        (colorOf(w.left) === "black" && colorOf(w.right) === "black")
      ) {
        if (w !== null) w.color = "red";
        x = xParent;
        xParent = x.parent;
      } else {
        if (colorOf(w.right) === "black") {
          if (w.left !== null) w.left.color = "black";
          w.color = "red";
          rotateRight(handle, w);
          w = xParent.right!;
        }
        w.color = xParent.color;
        xParent.color = "black";
        if (w.right !== null) w.right.color = "black";
        rotateLeft(handle, xParent);
        x = handle.root;
        xParent = null;
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
        w === null ||
        (colorOf(w.right) === "black" && colorOf(w.left) === "black")
      ) {
        if (w !== null) w.color = "red";
        x = xParent;
        xParent = x.parent;
      } else {
        if (colorOf(w.left) === "black") {
          if (w.right !== null) w.right.color = "black";
          w.color = "red";
          rotateLeft(handle, w);
          w = xParent.left!;
        }
        w.color = xParent.color;
        xParent.color = "black";
        if (w.left !== null) w.left.color = "black";
        rotateRight(handle, xParent);
        x = handle.root;
        xParent = null;
      }
    }
  }
  if (x !== null) x.color = "black";
}
