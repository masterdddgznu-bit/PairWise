function half(n: number): number {
  return Math.ceil(n / 2);
}

export function defaultClusterOf(n: number): number[] {
  const h = half(n);
  return Array.from({ length: n }, (_, i) => (i < h ? 0 : 1));
}

export function defaultClusterRoots(n: number): number[] {
  return [0, half(n)];
}

export function defaultTreeEdges(n: number): number[][] {
  const h = half(n);
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i++) {
    if (i + 1 === h) continue;
    edges.push([i, i + 1]);
  }
  return edges;
}

export function defaultEdges(n: number): number[][] {
  const h = half(n);
  const edges = defaultTreeEdges(n);
  if (h < n) edges.push([h - 1, h]);
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
  const queue: number[] = [0];
  seen[0] = true;
  let count = 1;
  while (queue.length > 0) {
    const u = queue.shift() as number;
    for (const v of adj[u]) {
      if (seen[v]) continue;
      seen[v] = true;
      count++;
      queue.push(v);
    }
  }
  return count === n;
}

export function isForest(n: number, treeEdges: number[][]): boolean {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  for (const [a, b] of treeEdges) {
    if (a === b) return false;
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent[ra] = rb;
  }
  return true;
}

export function orientForest(
  n: number,
  treeEdges: number[][],
  clusterOf: number[],
  clusterRoots: number[],
): { parent: Array<number | null>; children: number[][] } {
  const adj = buildNeighbors(n, treeEdges);
  const parent: Array<number | null> = new Array<number | null>(n).fill(null);
  const children: number[][] = Array.from({ length: n }, () => []);
  for (const root of clusterRoots) {
    const cid = clusterOf[root];
    const seen = new Set<number>([root]);
    const queue: number[] = [root];
    while (queue.length > 0) {
      const u = queue.shift() as number;
      for (const v of adj[u]) {
        if (seen.has(v) || clusterOf[v] !== cid) continue;
        seen.add(v);
        parent[v] = u;
        children[u].push(v);
        queue.push(v);
      }
    }
  }
  return { parent, children };
}

export function clusterNeighbors(
  clusterId: number,
  _n: number,
  edges: number[][],
  clusterOf: number[],
): number[] {
  const result = new Set<number>();
  for (const [a, b] of edges) {
    if (clusterOf[a] === clusterId && clusterOf[b] !== clusterId) result.add(clusterOf[b]);
    else if (clusterOf[b] === clusterId && clusterOf[a] !== clusterId) result.add(clusterOf[a]);
  }
  return [...result].sort((x, y) => x - y);
}
