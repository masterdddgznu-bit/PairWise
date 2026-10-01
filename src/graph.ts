export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (n === 2 && i === 1) continue;
    edges.push([i, (i + 1) % n]);
  }
  if (n >= 4) edges.push([1, 3]);
  return edges;
}

export function defaultUids(n: number): number[] {
  const uids: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) uids.push(10);
    else if (i % 2 === 1) uids.push(10 * (i + 2));
    else uids.push(10 * i);
  }
  return uids;
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
  if (n <= 0) return true;
  const neighbors = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const queue: number[] = [0];
  seen[0] = true;
  let reached = 0;
  while (queue.length > 0) {
    const cur = queue.pop() as number;
    reached++;
    for (const nb of neighbors[cur]) {
      if (!seen[nb]) {
        seen[nb] = true;
        queue.push(nb);
      }
    }
  }
  return reached === n;
}
