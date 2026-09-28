import type { TNode } from "./node.js";

export function nextOnline(nodes: TNode[], fromId: number): number {
  const n = nodes.length;
  for (let step = 1; step <= n; step++) {
    const candidate = (fromId + step) % n;
    if (nodes[candidate].online) {
      return candidate;
    }
  }
  return fromId;
}
