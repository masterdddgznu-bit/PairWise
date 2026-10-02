export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1]);
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

export function maxDegree(neighbors: number[][]): number {
  let d = 0;
  for (const list of neighbors) d = Math.max(d, list.length);
  return d;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n < 1) return false;
  const adj = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let count = 1;
  while (stack.length > 0) {
    const v = stack.pop()!;
    for (const u of adj[v]) {
      if (!seen[u]) {
        seen[u] = true;
        count++;
        stack.push(u);
      }
    }
  }
  return count === n;
}

export function isSimpleUndirected(n: number, edges: number[][]): boolean {
  const seen = new Set<string>();
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 2) return false;
    const [a, b] = e;
    if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
    if (a < 0 || a >= n || b < 0 || b >= n) return false;
    if (a === b) return false;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export function paletteSizeForRound(delta: number, r: number, n: number): number {
  const base = 2 * delta + 1;
  return Math.min(base ** 2 ** r, n * n);
}
