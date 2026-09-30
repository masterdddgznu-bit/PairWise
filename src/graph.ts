export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1]);
  return edges;
}

export function defaultUids(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
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
  if (n === 0) return edges.length === 0;
  const adj = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let count = 0;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    count++;
    for (const nb of adj[cur]) {
      if (!seen[nb]) {
        seen[nb] = true;
        stack.push(nb);
      }
    }
  }
  return count === n;
}

export function isTree(n: number, edges: number[][]): boolean {
  return edges.length === n - 1 && isConnected(n, edges);
}
