export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (i === j) continue;
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([i, j]);
  }
  if (n >= 4) edges.push([1, 3]);
  return edges;
}

export function defaultUids(n: number): number[] {
  const uids: number[] = [];
  for (let i = 0; i < n; i++) uids.push(10 * (i + 1));
  for (let i = 1; i + 1 < n; i += 2) {
    const tmp = uids[i];
    uids[i] = uids[i + 1];
    uids[i + 1] = tmp;
  }
  return uids;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const adj: number[][] = [];
  for (let i = 0; i < n; i++) adj.push([]);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  for (const list of adj) list.sort((x, y) => x - y);
  return adj;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 0) return true;
  const adj = buildNeighbors(n, edges);
  const visited = new Array<boolean>(n).fill(false);
  const queue: number[] = [0];
  visited[0] = true;
  let count = 1;
  while (queue.length > 0) {
    const cur = queue.pop() as number;
    for (const next of adj[cur]) {
      if (!visited[next]) {
        visited[next] = true;
        count++;
        queue.push(next);
      }
    }
  }
  return count === n;
}
