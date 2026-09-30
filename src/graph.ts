export function defaultEdges(n: number): number[][] {
  if (n < 2) return [];
  const edges: number[][] = [];
  for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);
  if (n > 2) edges.push([0, n - 1]);
  return edges;
}

export function defaultUids(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  for (const list of neighbors) list.sort((x, y) => x - y);
  return neighbors;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 1) return true;
  const neighbors = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const queue: number[] = [0];
  seen[0] = true;
  let count = 1;
  while (queue.length > 0) {
    const cur = queue.shift() as number;
    for (const next of neighbors[cur]) {
      if (!seen[next]) {
        seen[next] = true;
        count++;
        queue.push(next);
      }
    }
  }
  return count === n;
}
