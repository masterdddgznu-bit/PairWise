export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1]);
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  return neighbors;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 0) return false;
  const neighbors = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const queue: number[] = [0];
  seen[0] = true;
  while (queue.length > 0) {
    const cur = queue.shift() as number;
    for (const next of neighbors[cur]) {
      if (!seen[next]) {
        seen[next] = true;
        queue.push(next);
      }
    }
  }
  return seen.every(Boolean);
}

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}
