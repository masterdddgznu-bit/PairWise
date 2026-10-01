export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1]);
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    adj[u].push(v);
    adj[v].push(u);
  }
  for (const row of adj) row.sort((a, b) => a - b);
  return adj;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n < 1) return false;
  const adj = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let count = 0;
  while (stack.length > 0) {
    const u = stack.pop() as number;
    count++;
    for (const v of adj[u]) {
      if (!seen[v]) {
        seen[v] = true;
        stack.push(v);
      }
    }
  }
  return count === n;
}

export function isTree(n: number, edges: number[][]): boolean {
  if (n < 1) return false;
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 2) return false;
    const [u, v] = e;
    if (!Number.isInteger(u) || !Number.isInteger(v)) return false;
    if (u === v || u < 0 || v < 0 || u >= n || v >= n) return false;
  }
  return edges.length === n - 1 && isConnected(n, edges);
}

export function orientTree(
  n: number,
  edges: number[][],
  rootId: number,
): { parent: Array<number | null>; children: number[][] } {
  const adj = buildNeighbors(n, edges);
  const parent: Array<number | null> = new Array<number | null>(n).fill(null);
  const children: number[][] = Array.from({ length: n }, () => []);
  const seen = new Array<boolean>(n).fill(false);
  seen[rootId] = true;
  const queue = [rootId];
  while (queue.length > 0) {
    const u = queue.shift() as number;
    for (const v of adj[u]) {
      if (seen[v]) continue;
      seen[v] = true;
      parent[v] = u;
      children[u].push(v);
      queue.push(v);
    }
  }
  return { parent, children };
}
