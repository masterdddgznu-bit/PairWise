import { InvalidConfigError } from "./errors.js";

/**
 * Default topology: the ring 0-1-...-(n-1)-0.
 * For n === 4 this is [[0,1],[1,2],[2,3],[0,3]].
 */
export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i++) {
    edges.push([i, i + 1]);
  }
  if (n > 2) {
    edges.push([0, n - 1]);
  }
  return edges;
}

/** Build a sorted undirected adjacency list (each neighbor row ascending). */
export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  for (const row of neighbors) {
    row.sort((x, y) => x - y);
  }
  return neighbors;
}

/** Connectedness over the undirected graph via BFS from node 0. */
export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 1) {
    return true;
  }
  const adjacency: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const [a, b] of edges) {
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      continue;
    }
    if (a < 0 || a >= n || b < 0 || b >= n) {
      continue;
    }
    adjacency[a].add(b);
    adjacency[b].add(a);
  }
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let reached = 1;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const next of adjacency[cur]) {
      if (!seen[next]) {
        seen[next] = true;
        reached += 1;
        stack.push(next);
      }
    }
  }
  return reached === n;
}

/**
 * Validate that edges describe a simple undirected graph on n nodes:
 * integer in-range endpoints, no self loops, no duplicate edges.
 * Throws InvalidConfigError on the first violation.
 */
export function assertSimpleGraph(n: number, edges: number[][]): void {
  if (!Array.isArray(edges)) {
    throw new InvalidConfigError("edges must be an array of [a, b] pairs");
  }
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new InvalidConfigError("each edge must be a pair [a, b]");
    }
    const [a, b] = edge;
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new InvalidConfigError(`edge endpoints must be integers: [${a}, ${b}]`);
    }
    if (a < 0 || a >= n || b < 0 || b >= n) {
      throw new InvalidConfigError(`edge endpoint out of range: [${a}, ${b}]`);
    }
    if (a === b) {
      throw new InvalidConfigError(`self loops are not allowed: [${a}, ${b}]`);
    }
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) {
      throw new InvalidConfigError(`duplicate edge: [${a}, ${b}]`);
    }
    seen.add(key);
  }
}
