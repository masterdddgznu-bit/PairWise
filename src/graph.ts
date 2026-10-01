function halfOf(n: number): number {
  return Math.ceil(n / 2);
}

export function defaultClusterOf(n: number): number[] {
  const half = halfOf(n);
  return Array.from({ length: n }, (_, i) => (i < half ? 0 : 1));
}

export function defaultClusterRoots(n: number): number[] {
  const half = halfOf(n);
  return half < n ? [0, half] : [0];
}

export function defaultTreeEdges(n: number): number[][] {
  const half = halfOf(n);
  const edges: number[][] = [];
  for (let i = 0; i + 1 < half; i++) edges.push([i, i + 1]);
  for (let i = half; i + 1 < n; i++) edges.push([i, i + 1]);
  return edges;
}

export function defaultEdges(n: number): number[][] {
  const half = halfOf(n);
  const edges = defaultTreeEdges(n);
  if (half < n) edges.push([half - 1, half]);
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    if (!adj[u].includes(v)) adj[u].push(v);
    if (!adj[v].includes(u)) adj[v].push(u);
  }
  for (const list of adj) list.sort((a, b) => a - b);
  return adj;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 0) return n === 0;
  const adj = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let count = 0;
  while (stack.length > 0) {
    const u = stack.pop()!;
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
  for (const [u, v] of treeEdges) {
    if (u === v || u < 0 || v < 0 || u >= n || v >= n) return false;
    const ru = find(u);
    const rv = find(v);
    if (ru === rv) return false;
    parent[ru] = rv;
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
  const visited = new Array<boolean>(n).fill(false);
  for (const root of clusterRoots) {
    if (visited[root]) continue;
    visited[root] = true;
    const queue = [root];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const v of adj[u]) {
        if (visited[v]) continue;
        if (clusterOf[v] !== clusterOf[root]) continue;
        visited[v] = true;
        parent[v] = u;
        children[u].push(v);
        queue.push(v);
      }
    }
  }
  for (const list of children) list.sort((a, b) => a - b);
  return { parent, children };
}

export function clusterNeighbors(
  clusterId: number,
  _n: number,
  edges: number[][],
  clusterOf: number[],
): number[] {
  const result = new Set<number>();
  for (const [u, v] of edges) {
    if (clusterOf[u] === clusterId && clusterOf[v] !== clusterId) result.add(clusterOf[v]);
    else if (clusterOf[v] === clusterId && clusterOf[u] !== clusterId) result.add(clusterOf[u]);
  }
  return [...result].sort((a, b) => a - b);
}
