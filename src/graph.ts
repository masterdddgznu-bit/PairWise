import { InvalidConfigError } from "./errors.js";

export function defaultEdges(n: number): number[][] {
  const edges: number[][] = [];
  for (let i = 0; i + 1 < n; i++) {
    edges.push([i, i + 1]);
  }
  return edges;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const sets: Set<number>[] = [];
  for (let i = 0; i < n; i++) {
    sets.push(new Set<number>());
  }
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new InvalidConfigError("edge must be a [u, v] pair");
    }
    const [u, v] = edge;
    if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= n || v >= n) {
      throw new InvalidConfigError(`edge endpoint out of range: [${u}, ${v}]`);
    }
    if (u === v) {
      throw new InvalidConfigError(`self edge not allowed: [${u}, ${v}]`);
    }
    sets[u].add(v);
    sets[v].add(u);
  }
  return sets.map((s) => [...s].sort((a, b) => a - b));
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (n <= 0) {
    return false;
  }
  const neighbors = buildNeighbors(n, edges);
  const seen = new Array<boolean>(n).fill(false);
  const queue: number[] = [0];
  seen[0] = true;
  let count = 1;
  while (queue.length > 0) {
    const cur = queue.pop() as number;
    for (const next of neighbors[cur]) {
      if (!seen[next]) {
        seen[next] = true;
        count += 1;
        queue.push(next);
      }
    }
  }
  return count === n;
}
