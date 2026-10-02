export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i += 1) {
    edges.push([i, i + 1]);
  }
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    neighbors[u].push(v);
    neighbors[v].push(u);
  }
  for (const list of neighbors) {
    list.sort((a, b) => a - b);
  }
  return neighbors;
}

export function maxDegree(neighbors: number[][]): number {
  let max = 0;
  for (const list of neighbors) {
    if (list.length > max) max = list.length;
  }
  return max;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n < 1) return false;
  const neighbors = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const queue: number[] = [0];
  seen[0] = true;
  while (queue.length > 0) {
    const u = queue.shift() as number;
    for (const v of neighbors[u]) {
      if (!seen[v]) {
        seen[v] = true;
        queue.push(v);
      }
    }
  }
  return seen.every(Boolean);
}

export function isSimpleUndirected(n: number, edges: number[][]): boolean {
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.length !== 2) return false;
    const [u, v] = edge;
    if (!Number.isInteger(u) || !Number.isInteger(v)) return false;
    if (u < 0 || u >= n || v < 0 || v >= n) return false;
    if (u === v) return false;
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export function paletteSizeForRound(delta: number, r: number, n: number): number {
  const base = 2 * delta + 1;
  const exp = 2 ** r;
  return Math.min(base ** exp, n * n);
}
