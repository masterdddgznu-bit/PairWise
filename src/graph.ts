export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i++) {
    edges.push([i, i + 1]);
  }
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    adj[u].push(v);
    adj[v].push(u);
  }
  for (const list of adj) {
    list.sort((a, b) => a - b);
  }
  return adj;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n < 1) return false;
  const adj = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const stack: number[] = [0];
  seen[0] = true;
  while (stack.length > 0) {
    const u = stack.pop() as number;
    for (const v of adj[u]) {
      if (!seen[v]) {
        seen[v] = true;
        stack.push(v);
      }
    }
  }
  return seen.every((s) => s);
}

export function isSimpleUndirected(n: number, edges: number[][]): boolean {
  const seen = new Set<string>();
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 2) return false;
    const [u, v] = e;
    if (!Number.isInteger(u) || !Number.isInteger(v)) return false;
    if (u < 0 || u >= n || v < 0 || v >= n) return false;
    if (u === v) return false;
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
