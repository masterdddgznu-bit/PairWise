export function defaultEdges(n: number): number[][] {
  if (n === 2) {
    return [[0, 1]];
  }
  const edges: number[][] = [];
  for (let i = 0; i < n - 1; i += 1) {
    edges.push([i, i + 1]);
  }
  edges.push([0, n - 1]);
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  for (const list of neighbors) {
    list.sort((x, y) => x - y);
  }
  return neighbors;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 1) {
    return true;
  }
  const neighbors = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let count = 1;
  while (stack.length > 0) {
    const node = stack.pop() as number;
    for (const next of neighbors[node]) {
      if (!seen[next]) {
        seen[next] = true;
        count += 1;
        stack.push(next);
      }
    }
  }
  return count === n;
}

export function validateGraph(n: number, edges: number[][]): void {
  if (!Number.isInteger(n) || n < 2) {
    throw new Error("processCount must be an integer >= 2");
  }
  const undirectedPairs = new Set<string>();
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new Error("each edge must be a pair [a, b]");
    }
    const [a, b] = edge;
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new Error("edge endpoints must be integers");
    }
    if (a < 0 || a >= n || b < 0 || b >= n) {
      throw new Error("edge endpoint out of range");
    }
    if (a === b) {
      throw new Error("self loops are not allowed");
    }
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (undirectedPairs.has(key)) {
      throw new Error("duplicate (parallel) edges are not allowed");
    }
    undirectedPairs.add(key);
  }
  if (!isConnected(n, edges)) {
    throw new Error("graph must be connected");
  }
}
