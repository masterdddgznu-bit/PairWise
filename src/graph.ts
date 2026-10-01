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

export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 0) return n === 0;
  const adj = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const queue: number[] = [0];
  seen[0] = true;
  let count = 0;
  while (queue.length > 0) {
    const u = queue.shift()!;
    count++;
    for (const v of adj[u]) {
      if (!seen[v]) {
        seen[v] = true;
        queue.push(v);
      }
    }
  }
  return count === n;
}

export function isTree(n: number, edges: number[][]): boolean {
  if (n < 1) return false;
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
  const queue: number[] = [rootId];
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of adj[u]) {
      if (!seen[v]) {
        seen[v] = true;
        parent[v] = u;
        children[u].push(v);
        queue.push(v);
      }
    }
  }
  for (const list of children) list.sort((a, b) => a - b);
  return { parent, children };
}
