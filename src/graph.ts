export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i += 1) edges.push([i, i + 1]);
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const neighbors: Set<number>[] = [];
  for (let i = 0; i < n; i += 1) neighbors.push(new Set<number>());
  for (const [u, v] of edges) {
    neighbors[u].add(v);
    neighbors[v].add(u);
  }
  return neighbors.map((set) => [...set].sort((a, b) => a - b));
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 0) return false;
  const neighbors = buildNeighbors(n, edges);
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const cur = queue.shift() as number;
    for (const next of neighbors[cur]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === n;
}

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}
