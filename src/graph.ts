export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1]);
  if (n > 2) edges.push([0, n - 1]);
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    adj[u].push(v);
    adj[v].push(u);
  }
  for (const list of adj) list.sort((a, b) => a - b);
  return adj;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 0) return false;
  const adj = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const queue = [0];
  seen[0] = true;
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of adj[u]) {
      if (!seen[v]) {
        seen[v] = true;
        queue.push(v);
      }
    }
  }
  return seen.every(Boolean);
}
