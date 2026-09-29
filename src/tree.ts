import { InvalidConfigError } from "./errors.js";

/**
 * Star topology rooted at process 0: edges [0, i] for i in 1..n-1.
 */
export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 1; i < n; i++) {
    edges.push([0, i]);
  }
  return edges;
}

/**
 * Undirected adjacency list; each row is sorted ascending.
 * Assumes endpoints have already been validated.
 */
export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    neighbors[u].push(v);
    neighbors[v].push(u);
  }
  for (const row of neighbors) {
    row.sort((a, b) => a - b);
  }
  return neighbors;
}

/**
 * Throws InvalidConfigError unless edges form a connected tree on n nodes:
 * exactly n - 1 well-formed edges, valid distinct endpoints, and no cycle.
 */
export function validateTree(n: number, edges: number[][]): void {
  if (!Array.isArray(edges)) {
    throw new InvalidConfigError("edges must be an array of [u, v] pairs");
  }
  if (edges.length !== n - 1) {
    throw new InvalidConfigError(
      `a tree on ${n} processes requires exactly ${n - 1} edges, got ${edges.length}`,
    );
  }

  const root = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (root[x] !== x) {
      root[x] = root[root[x]];
      x = root[x];
    }
    return x;
  };

  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new InvalidConfigError("each edge must be a [u, v] pair");
    }
    const [u, v] = edge;
    if (
      !Number.isInteger(u) ||
      !Number.isInteger(v) ||
      u < 0 ||
      u >= n ||
      v < 0 ||
      v >= n
    ) {
      throw new InvalidConfigError(`edge endpoint out of range: [${u}, ${v}]`);
    }
    if (u === v) {
      throw new InvalidConfigError(`self loops are not allowed: [${u}, ${v}]`);
    }
    const ru = find(u);
    const rv = find(v);
    if (ru === rv) {
      throw new InvalidConfigError(`edges form a cycle at: [${u}, ${v}]`);
    }
    root[ru] = rv;
  }
}
