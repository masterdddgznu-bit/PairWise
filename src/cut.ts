import type { FibNode } from "./node.js";
import type { FibHandle } from "./types.js";

export function cut(_heap: FibHandle, _node: FibNode, _parent: FibNode): void {
  throw new Error("cut not implemented");
}

export function cascadingCut(_heap: FibHandle, _node: FibNode): void {
  throw new Error("cascadingCut not implemented");
}
