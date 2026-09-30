import { InvalidConfigError } from "./errors.js";

export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i < n - 1; i++) {
    edges.push([i, i + 1]);
  }
  if (n > 2) {
    edges.push([0, n - 1]);
  }
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
  const neighbors = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let count = 0;
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    count++;
    for (const next of neighbors[cur]) {
      if (!seen[next]) {
        seen[next] = true;
        stack.push(next);
      }
    }
  }
  return count === n;
}

export function validateGraph(n: number, edges: number[][]): void {
  if (n < 2) {
    throw new InvalidConfigError(`processCount must be >= 2, got ${n}`);
  }
  const undirected = new Set<string>();
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new InvalidConfigError(`invalid edge: ${JSON.stringify(edge)}`);
    }
    const [a, b] = edge;
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new InvalidConfigError(`invalid edge endpoints: ${JSON.stringify(edge)}`);
    }
    if (a < 0 || a >= n || b < 0 || b >= n) {
      throw new InvalidConfigError(`edge endpoint out of range: ${JSON.stringify(edge)}`);
    }
    if (a === b) {
      throw new InvalidConfigError(`self loop not allowed: ${JSON.stringify(edge)}`);
    }
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (undirected.has(key)) {
      throw new InvalidConfigError(`duplicate edge: ${JSON.stringify(edge)}`);
    }
    undirected.add(key);
  }
  if (!isConnected(n, edges)) {
    throw new InvalidConfigError("edges do not form a connected graph");
  }
}
