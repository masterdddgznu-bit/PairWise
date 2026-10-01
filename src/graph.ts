import type { WeightedEdge } from "./types.js";

export function edgeKey(u: number, v: number): string {
  return u < v ? `${u}-${v}` : `${v}-${u}`;
}

export function defaultEdges(n: number): WeightedEdge[] {
  if (n === 6) {
    return [
      { u: 0, v: 1, w: 1 },
      { u: 1, v: 4, w: 2 },
      { u: 1, v: 2, w: 3 },
      { u: 2, v: 3, w: 4 },
      { u: 4, v: 5, w: 5 },
      { u: 3, v: 4, w: 6 },
      { u: 0, v: 5, w: 7 },
    ];
  }
  const edges: WeightedEdge[] = [];
  for (let i = 0; i + 1 < n; i++) edges.push({ u: i, v: i + 1, w: i + 1 });
  if (n > 2) edges.push({ u: 0, v: n - 1, w: n });
  return edges;
}

export function buildNeighbors(
  n: number,
  edges: WeightedEdge[],
): Array<Array<{ id: number; w: number }>> {
  const adj: Array<Array<{ id: number; w: number }>> = Array.from(
    { length: n },
    () => [],
  );
  for (const e of edges) {
    adj[e.u].push({ id: e.v, w: e.w });
    adj[e.v].push({ id: e.u, w: e.w });
  }
  for (const list of adj) list.sort((a, b) => a.w - b.w);
  return adj;
}

export function isConnected(n: number, edges: WeightedEdge[]): boolean {
  if (n <= 0) return false;
  const adj = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let count = 1;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const nb of adj[cur]) {
      if (!seen[nb.id]) {
        seen[nb.id] = true;
        count++;
        stack.push(nb.id);
      }
    }
  }
  return count === n;
}
