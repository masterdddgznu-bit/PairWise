import type { TNode } from "./node.js";

export function nextOnline(nodes: TNode[], fromId: number): number {
  const n = nodes.length;
  for (let step = 1; step <= n; step++) {
    const id = (fromId + step) % n;
    if (nodes[id].online) return id;
  }
  return fromId;
}
