import { InvalidConfigError } from "./errors.js";

/**
 * Default tree: process 0 is the root and every other process is a direct
 * child of it, e.g. defaultEdges(3) -> [[0,1],[0,2]].
 */
export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 1; i < n; i++) {
    edges.push([0, i]);
  }
  return edges;
}

/**
 * Build an adjacency list for `n` processes from the given undirected edges.
 * Each row lists neighbors in ascending order.
 * Throws InvalidConfigError when the edges do not form a connected tree on
 * exactly `n` vertices (n - 1 edges, valid endpoints, no cycles).
 */
export function buildNeighbors(n: number, edges: number[][]): number[][] {
  validateTree(n, edges);
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

function validateTree(n: number, edges: number[][]): void {
  if (!Number.isInteger(n) || n < 2) {
    throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
  }
  if (!Array.isArray(edges) || edges.length !== n - 1) {
    throw new InvalidConfigError(
      `tree on ${n} processes requires exactly ${n - 1} edges, got ${
        Array.isArray(edges) ? edges.length : String(edges)
      }`,
    );
  }

  const seen = new Set<string>();
  for (const edge of edges) {
    if (
      !Array.isArray(edge) ||
      edge.length !== 2 ||
      !Number.isInteger(edge[0]) ||
      !Number.isInteger(edge[1])
    ) {
      throw new InvalidConfigError(`malformed edge: ${JSON.stringify(edge)}`);
    }
    const [a, b] = edge;
    if (a < 0 || a >= n || b < 0 || b >= n) {
      throw new InvalidConfigError(`edge endpoint out of range: [${a}, ${b}]`);
    }
    if (a === b) {
      throw new InvalidConfigError(`self loop is not allowed: [${a}, ${b}]`);
    }
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) {
      throw new InvalidConfigError(`duplicate edge: [${a}, ${b}]`);
    }
    seen.add(key);
  }

  // n - 1 valid edges plus connectivity implies acyclicity; verify reachability.
  const neighbors = Array.from({ length: n }, () => [] as number[]);
  for (const [a, b] of edges) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  const visited = new Array<boolean>(n).fill(false);
  const stack = [0];
  visited[0] = true;
  let count = 0;
  while (stack.length > 0) {
    const node = stack.pop() as number;
    count++;
    for (const next of neighbors[node]) {
      if (!visited[next]) {
        visited[next] = true;
        stack.push(next);
      }
    }
  }
  if (count !== n) {
    throw new InvalidConfigError("edges do not form a connected tree");
  }
}
