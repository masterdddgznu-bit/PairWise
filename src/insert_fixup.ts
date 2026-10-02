import type { RbNode } from "./node.js";
import type { RbHandle } from "./types.js";
import { rotateLeft, rotateRight } from "./rotate.js";

/** CLRS insert fixup: recolor on red uncle, otherwise rotate. */
export function insertFixup(handle: RbHandle, z: RbNode): void {
  while (z.parent !== null && z.parent.color === "red") {
    const parent = z.parent;
    const grand = parent.parent;
    if (grand === null) break;
    if (parent === grand.left) {
      const uncle = grand.right;
      if (uncle !== null && uncle.color === "red") {
        parent.color = "black";
        uncle.color = "black";
        grand.color = "red";
        z = grand;
      } else {
        if (z === parent.right) {
          z = parent;
          rotateLeft(handle, z);
        }
        z.parent!.color = "black";
        z.parent!.parent!.color = "red";
        rotateRight(handle, z.parent!.parent!);
      }
    } else {
      const uncle = grand.left;
      if (uncle !== null && uncle.color === "red") {
        parent.color = "black";
        uncle.color = "black";
        grand.color = "red";
        z = grand;
      } else {
        if (z === parent.left) {
          z = parent;
          rotateRight(handle, z);
        }
        z.parent!.color = "black";
        z.parent!.parent!.color = "red";
        rotateLeft(handle, z.parent!.parent!);
      }
    }
  }
  if (handle.root !== null) handle.root.color = "black";
}
