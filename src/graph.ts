import { InvalidConfigError } from "./errors.js";

export function defaultEdges(n: number): number[][] {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new InvalidConfigError(`invalid process count: ${String(n)}`);
  }

  const edges: number[][] = [];
  for (let i = 0; i < n - 1; i += 1) {
    edges.push([i, i + 1]);
  }
  if (n >= 3) {
    edges.push([0, n - 1]);
  }
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new InvalidConfigError(`invalid process count: ${String(n)}`);
  }
  if (!Array.isArray(edges)) {
    throw new InvalidConfigError("edges must be an array");
  }

  const neighbors = Array.from({ length: n }, () => [] as number[]);
  const undirectedEdges = new Set<string>();

  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new InvalidConfigError("each edge must contain exactly two endpoints");
    }

    const [a, b] = edge;
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
      throw new InvalidConfigError("edge endpoints must be integers");
    }
    if (a < 0 || a >= n || b < 0 || b >= n) {
      throw new InvalidConfigError(`edge endpoint out of range: [${a}, ${b}]`);
    }
    if (a === b) {
      throw new InvalidConfigError(`self loops are not allowed: ${a}`);
    }

    const left = Math.min(a, b);
    const right = Math.max(a, b);
    const key = `${left}:${right}`;
    if (undirectedEdges.has(key)) {
      throw new InvalidConfigError(`duplicate edge: [${a}, ${b}]`);
    }
    undirectedEdges.add(key);

    neighbors[a].push(b);
    neighbors[b].push(a);
  }

  for (const list of neighbors) {
    list.sort((a, b) => a - b);
  }
  return neighbors;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (!Number.isSafeInteger(n) || n <= 0) {
    return false;
  }

  let neighbors: number[][];
  try {
    neighbors = buildNeighbors(n, edges);
  } catch {
    return false;
  }

  const visited = new Set<number>([0]);
  const stack = [0];

  while (stack.length > 0) {
    const current = stack.pop() as number;
    for (const next of neighbors[current]) {
      if (!visited.has(next)) {
        visited.add(next);
        stack.push(next);
      }
    }
  }

  return visited.size === n;
}
