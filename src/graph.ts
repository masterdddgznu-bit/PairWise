export function defaultEdges(n: number): number[][] {
  if (n < 2) return [];
  const edges: number[][] = [];
  for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);
  edges.push([0, n - 1]);
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  for (const list of adj) list.sort((x, y) => x - y);
  return adj;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 0) return false;
  const adj = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let count = 1;
  while (stack.length > 0) {
    const u = stack.pop() as number;
    for (const v of adj[u]) {
      if (!seen[v]) {
        seen[v] = true;
        count++;
        stack.push(v);
      }
    }
  }
  return count === n;
}
