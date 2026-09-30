import { InvalidConfigError } from "./errors.js";

export function defaultEdges(n: number): number[][] {
  if (!Number.isInteger(n) || n < 2) {
    throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
  }
  const edges: number[][] = [];
  for (let i = 0; i < n - 1; i++) {
    edges.push([i, i + 1]);
  }
  if (n >= 3) {
    edges.push([0, n - 1]);
  }
  return edges;
}

export function defaultUids(n: number): number[] {
  const uids: number[] = [];
  for (let i = 0; i < n; i++) {
    uids.push(i);
  }
  return uids;
}

export function buildNeighbors(n: number, edges: number[][]): number[][] {
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const edge of edges) {
    const a = edge?.[0];
    const b = edge?.[1];
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a < 0 ||
      b < 0 ||
      a >= n ||
      b >= n
    ) {
      throw new InvalidConfigError(
        `edge endpoints must be integers in [0, ${n - 1}]: ${JSON.stringify(edge)}`,
      );
    }
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  for (const list of neighbors) {
    list.sort((x, y) => x - y);
  }
  return neighbors;
}

export function isConnected(n: number, edges: number[][]): boolean {
  if (!Number.isInteger(n) || n < 1) {
    return false;
  }
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a < 0 ||
      b < 0 ||
      a >= n ||
      b >= n
    ) {
      return false;
    }
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let count = 0;
  while (stack.length > 0) {
    const id = stack.pop() as number;
    count++;
    for (const next of neighbors[id]) {
      if (!seen[next]) {
        seen[next] = true;
        stack.push(next);
      }
    }
  }
  return count === n;
}
